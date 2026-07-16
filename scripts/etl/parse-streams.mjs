import fs from 'node:fs';
import zlib from 'node:zlib';
import { XMLParser } from 'fast-xml-parser';
import FitParser from 'fit-file-parser';
import { find as findTimezone } from 'geo-tz';
import path from 'node:path';
import { srcPath, SOURCE_DIR, STREAMS_DIR, ensureDir, writeJson } from './lib/paths.mjs';
import { asArray } from './lib/xml.mjs';
import { haversine } from './lib/geo.mjs';
import { downsample, splitsForType } from './lib/resample.mjs';
import { buildRouteEntry, writeRoutes } from './lib/routes.mjs';
import { activityCells, addActivityToGrid, writeHeatGrid, CELL_METERS } from './lib/heatgrid.mjs';
import { normalizeCadence } from './lib/cadence.mjs';
import { foldBestEfforts, writeBestEfforts } from './lib/best-efforts.mjs';
import { foldRecords } from './lib/records.mjs';

export const DEFAULT_TZ = 'Asia/Ho_Chi_Minh';

/** Offline (no API calls) timezone lookup from the activity's first GPS fix - falls back to
 * Vietnam's zone when there's no GPS data (indoor activities like Weight Training). */
function detectTimezone(lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return DEFAULT_TZ;
  try {
    const zones = findTimezone(lat, lng);
    return zones?.[0] ?? DEFAULT_TZ;
  } catch {
    return DEFAULT_TZ;
  }
}

const xmlParser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });

const fitParser = new FitParser({
  force: true,
  speedUnit: 'm/s',
  lengthUnit: 'm',
  temperatureUnit: 'celsius',
  elapsedRecordField: true,
  mode: 'list',
});

function parseFit(buf) {
  return new Promise((resolve) => {
    fitParser.parse(buf, (error, data) => {
      if (error || !data?.records?.length) {
        resolve(null);
        return;
      }
      const records = data.records;
      const t = [];
      const d = [];
      const ele = [];
      const hr = [];
      const cad = [];
      const watts = [];
      const lat = [];
      const lng = [];
      let lastD = 0;
      for (const r of records) {
        t.push(r.elapsed_time ?? undefined);
        const dist = r.distance;
        lastD = typeof dist === 'number' && dist >= lastD ? dist : lastD;
        d.push(lastD);
        ele.push(r.enhanced_altitude ?? r.altitude);
        hr.push(r.heart_rate);
        cad.push(r.cadence);
        // Cycling power meters populate `power`; a running-power device instead writes
        // `RP_Power` - no activity has both.
        watts.push(r.power ?? r.RP_Power);
        lat.push(r.position_lat);
        lng.push(r.position_long);
      }
      resolve({ t, d, ele, hr, cad, watts, lat, lng });
    });
  });
}

function parseGpx(xmlText) {
  const xml = xmlParser.parse(xmlText);
  const tracks = asArray(xml?.gpx?.trk);
  const points = [];
  for (const trk of tracks) {
    for (const seg of asArray(trk.trkseg)) {
      for (const pt of asArray(seg.trkpt)) {
        const ext = pt.extensions?.['gpxtpx:TrackPointExtension'] ?? {};
        // Garmin's TrackPointExtension schema has no power field; some exports (Wahoo/Zwift-style
        // tools) instead put a bare <power> element directly under <extensions> - read it
        // defensively since no file in this dataset's history has been confirmed to carry it.
        const power = pt.extensions?.power;
        points.push({
          lat: Number(pt['@_lat']),
          lng: Number(pt['@_lon']),
          ele: pt.ele !== undefined ? Number(pt.ele) : undefined,
          time: pt.time,
          hr: ext['gpxtpx:hr'] !== undefined ? Number(ext['gpxtpx:hr']) : undefined,
          cad: ext['gpxtpx:cad'] !== undefined ? Number(ext['gpxtpx:cad']) : undefined,
          watts: power !== undefined ? Number(power) : undefined,
        });
      }
    }
  }
  if (points.length < 2) return null;

  const t0 = new Date(points[0].time).getTime();
  const t = [];
  const d = [];
  const ele = [];
  const hr = [];
  const cad = [];
  const watts = [];
  const lat = [];
  const lng = [];
  let cumDist = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (i > 0) {
      const prev = points[i - 1];
      if (Number.isFinite(p.lat) && Number.isFinite(p.lng) && Number.isFinite(prev.lat) && Number.isFinite(prev.lng)) {
        cumDist += haversine(prev.lat, prev.lng, p.lat, p.lng);
      }
    }
    t.push(p.time ? (new Date(p.time).getTime() - t0) / 1000 : undefined);
    d.push(cumDist);
    ele.push(p.ele);
    hr.push(p.hr);
    cad.push(p.cad);
    watts.push(p.watts);
    lat.push(p.lat);
    lng.push(p.lng);
  }
  return { t, d, ele, hr, cad, watts, lat, lng };
}

function parseTcx(xmlText) {
  const xml = xmlParser.parse(xmlText);
  const activities = asArray(xml?.TrainingCenterDatabase?.Activities?.Activity);
  const points = [];
  for (const act of activities) {
    for (const lap of asArray(act.Lap)) {
      for (const tp of asArray(lap.Track?.Trackpoint)) {
        points.push({
          time: tp.Time,
          dist: tp.DistanceMeters !== undefined ? Number(tp.DistanceMeters) : undefined,
          ele: tp.AltitudeMeters !== undefined ? Number(tp.AltitudeMeters) : undefined,
          hr: tp.HeartRateBpm?.Value !== undefined ? Number(tp.HeartRateBpm.Value) : undefined,
          cad: tp.Cadence !== undefined ? Number(tp.Cadence) : undefined,
          // Garmin's TCX TPX extension carries Watts on some power-meter exports - read
          // defensively, same caveat as parseGpx above.
          watts: tp.Extensions?.TPX?.Watts !== undefined ? Number(tp.Extensions.TPX.Watts) : undefined,
          lat: tp.Position?.LatitudeDegrees !== undefined ? Number(tp.Position.LatitudeDegrees) : undefined,
          lng: tp.Position?.LongitudeDegrees !== undefined ? Number(tp.Position.LongitudeDegrees) : undefined,
        });
      }
    }
  }
  if (points.length < 2) return null;

  const t0 = new Date(points[0].time).getTime();
  const t = [];
  const d = [];
  const ele = [];
  const hr = [];
  const cad = [];
  const watts = [];
  const lat = [];
  const lng = [];
  let lastD = 0;
  let cumDistFallback = 0;
  const hasDeviceDistance = points.some((p) => Number.isFinite(p.dist));
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (!hasDeviceDistance && i > 0) {
      const prev = points[i - 1];
      if (Number.isFinite(p.lat) && Number.isFinite(p.lng) && Number.isFinite(prev.lat) && Number.isFinite(prev.lng)) {
        cumDistFallback += haversine(prev.lat, prev.lng, p.lat, p.lng);
      }
    }
    const dist = hasDeviceDistance ? p.dist : cumDistFallback;
    lastD = typeof dist === 'number' && dist >= lastD ? dist : lastD;
    t.push(p.time ? (new Date(p.time).getTime() - t0) / 1000 : undefined);
    d.push(lastD);
    ele.push(p.ele);
    hr.push(p.hr);
    cad.push(p.cad);
    watts.push(p.watts);
    lat.push(p.lat);
    lng.push(p.lng);
  }
  return { t, d, ele, hr, cad, watts, lat, lng };
}

async function loadRawSeries(filename) {
  const absPath = srcPath(filename);
  // Filename comes straight from the CSV's Filename column with no sanitization - path.join
  // alone doesn't guard against a `../`-style value escaping SOURCE_DIR, so check containment
  // explicitly (treat an escape the same as any other malformed input: a parse failure).
  if (path.relative(SOURCE_DIR, absPath).startsWith('..')) return null;
  if (!fs.existsSync(absPath)) return null;
  // Strava's bulk export mixes gzip-compressed (<id>.fit.gz) and plain uncompressed (<id>.fit)
  // raw files in the same activities/ folder - only gunzip when the name says it's actually
  // compressed, otherwise read the bytes as-is. Previously this always gunzipped unconditionally,
  // which throws on a genuinely uncompressed file (silently counted as a parse failure by the
  // caller) - and even had it not thrown, none of the extension checks below ever matched a bare
  // filename anyway.
  const isGz = filename.endsWith('.gz');
  const raw = fs.readFileSync(absPath);
  const buf = isGz ? zlib.gunzipSync(raw) : raw;
  const bareName = isGz ? filename.slice(0, -'.gz'.length) : filename;
  if (bareName.endsWith('.fit')) return parseFit(buf);
  if (bareName.endsWith('.gpx')) return parseGpx(buf.toString('utf8'));
  if (bareName.endsWith('.tcx')) return parseTcx(buf.toString('utf8'));
  return null;
}

function isValidSeries(series) {
  return series && series.t.length >= 2 && series.t.every((v) => Number.isFinite(v));
}

/**
 * @param {object} [options]
 * @param {(activity: object) => boolean} [options.shouldProcess] - gate on top of the existing
 *   filename/ambiguity checks below; defaults to "process everything" (full ETL's run.mjs use).
 *   The incremental CSV path (build-incremental-from-csv.mjs) passes one that's only true for
 *   activities missing from retained-raw/, so re-downloading/re-parsing raw files already covered
 *   by a prior full ETL run is skipped - `activities` itself must still be the FULL set either way,
 *   since the shared-filename ambiguity check (see CLAUDE.md's Records/Best-effort/Splits note
 *   on duplicate GPS files) needs to see every activity to detect a collision, not just the ones
 *   actually being processed.
 * @param {Map} [options.seedRecordsState] - fold state to extend instead of starting empty, same
 *   idea as sync-strava.mjs's recordsStateFromExisting() seeding an incremental sync.
 * @param {Map} [options.seedBestEffortState] - see seedRecordsState.
 * @param {Array} [options.seedRoutes] - routes.json entries to extend instead of starting empty.
 * @param {Map} [options.seedHeatGrid] - heatgrid.json cells to extend instead of starting empty.
 */
export async function parseStreams(activities, options = {}) {
  const {
    shouldProcess = () => true,
    seedRecordsState = new Map(),
    seedBestEffortState = new Map(),
    seedRoutes = [],
    seedHeatGrid = new Map(),
  } = options;

  ensureDir(STREAMS_DIR);
  const streamedIds = new Set();
  const timezones = new Map(); // activityId -> IANA zone, only for activities with real GPS
  const recordsState = seedRecordsState; // `${type}|${targetKey}` -> {timeSec, activityId, date}, see lib/records.mjs
  const bestEffortState = seedBestEffortState; // `${type}|${year}|${targetKey}` -> {timeSec, activityId, date}, see lib/best-efforts.mjs

  // Strava's export occasionally links the same raw GPS file to 2+ activities (e.g. a run
  // paused mid-recording that Strava split into separate activities in the CSV but kept as one
  // physical file) - the file then holds GPS/time data spanning ALL of those activities merged
  // together, so there's no reliable way to tell which portion belongs to which activity id.
  // Skip streams/records/splits for these rather than risk attributing one activity's distance
  // and pace to another (e.g. a 0.23km activity inheriting a 13km best-effort from the other
  // half of the shared file).
  const filenameCounts = new Map();
  for (const a of activities) {
    if (a.filename) filenameCounts.set(a.filename, (filenameCounts.get(a.filename) || 0) + 1);
  }

  let ok = 0;
  let failed = 0;
  let ambiguous = 0;
  let skippedAlreadyKnown = 0;
  const routes = seedRoutes;
  const heatGrid = seedHeatGrid;

  for (const a of activities) {
    if (!a.filename) continue;
    if (filenameCounts.get(a.filename) > 1) {
      ambiguous++;
      continue;
    }
    if (!shouldProcess(a)) {
      skippedAlreadyKnown++;
      continue;
    }
    let series;
    try {
      series = await loadRawSeries(a.filename);
    } catch (err) {
      console.warn(`[streams] failed to parse ${a.filename}: ${err.message}`);
      failed++;
      continue;
    }
    if (!isValidSeries(series)) {
      failed++;
      continue;
    }
    const { t, d, ele, hr, cad, watts, lat, lng } = series;

    const firstFixIdx = lat.findIndex((v) => Number.isFinite(v));
    if (firstFixIdx >= 0) {
      timezones.set(a.id, detectTimezone(lat[firstFixIdx], lng[firstFixIdx]));
    }

    foldRecords(recordsState, a, d, t, lat, lng);
    foldBestEfforts(bestEffortState, a, d, t, lat, lng);

    const extraSeries = a.type === 'Swim' ? { hr } : { hr, watts };
    const { splits, splitsMi } = splitsForType(a.type, d, t, extraSeries);

    const rawPoints = t.map((_, i) => ({
      t: Math.round(t[i]),
      d: Math.round(d[i]),
      ele: ele[i] !== undefined && ele[i] !== null ? Math.round(ele[i] * 10) / 10 : undefined,
      hr: hr[i] || undefined,
      cad: normalizeCadence(cad[i], a.type) || undefined,
      watts: watts[i] || undefined,
      lat: Number.isFinite(lat[i]) ? Math.round(lat[i] * 1e5) / 1e5 : undefined,
      lng: Number.isFinite(lng[i]) ? Math.round(lng[i] * 1e5) / 1e5 : undefined,
    }));
    const points = downsample(rawPoints, 200);

    // sharded by year so no single directory holds more than ~a few hundred files
    // (GitHub's web UI truncates directory listings past 1,000 entries)
    const year = new Date(a.date).getUTCFullYear();
    writeJson(`${STREAMS_DIR}/${year}/${a.id}.json`, { points, splits, splitsMi });
    streamedIds.add(a.id);
    ok++;

    const route = buildRouteEntry(a, rawPoints);
    if (route) routes.push(route);
    addActivityToGrid(heatGrid, activityCells(rawPoints), a.type);
  }

  writeRoutes(routes);
  writeHeatGrid(heatGrid);
  writeBestEfforts(bestEffortState);
  console.log(`[streams] parsed ${ok} activity streams (${failed} skipped/failed, ${ambiguous} skipped for sharing a raw file with another activity, ${skippedAlreadyKnown} skipped as already known)`);
  console.log(`[streams] wrote ${routes.length} routes to routes.json (overview map)`);
  console.log(`[streams] wrote ${heatGrid.size} cells to heatgrid.json (overview heatmap, ${CELL_METERS}m grid)`);
  console.log(`[streams] personal records: ${recordsState.size} distance/type pairs`);
  console.log('[streams] wrote best-efforts.json (per-year Run/Ride best efforts)');

  const nonDefaultTz = [...timezones.entries()].filter(([, tz]) => tz !== DEFAULT_TZ);
  console.log(`[streams] detected ${nonDefaultTz.length} activities outside the default timezone (${DEFAULT_TZ}):`, Object.fromEntries(nonDefaultTz));

  return { streamedIds, recordsState, timezones };
}
