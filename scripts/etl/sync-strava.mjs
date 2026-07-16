import fs from 'node:fs';
import { find as findTimezone } from 'geo-tz';
import { DEFAULT_TZ } from './parse-streams.mjs';
import { computeFitness } from './compute-fitness.mjs';
import { haversine } from './lib/geo.mjs';
import { downsample, splitsForType } from './lib/resample.mjs';
import { localToUtcIso } from './lib/tz.mjs';
import { buildRouteEntry, readRoutes, writeRoutes } from './lib/routes.mjs';
import { activityCells, addActivityToGrid, readHeatGrid, writeHeatGrid } from './lib/heatgrid.mjs';
import { SRC_DATA_DIR, STREAMS_DIR, writeJson, writeJsonBoth } from './lib/paths.mjs';
import { normalizeCadence } from './lib/cadence.mjs';
import { normalizeSportType } from './lib/sport-type.mjs';
import { foldBestEfforts, writeBestEfforts, stateFromExisting as bestEffortsStateFromExisting } from './lib/best-efforts.mjs';
import { foldRecords, serializeRecords, stateFromExisting as recordsStateFromExisting } from './lib/records.mjs';

/*
 * Incremental counterpart to `run.mjs` for activities pulled live from the Strava MCP connector,
 * used by the nightly sync routine (this environment has no access to the raw bulk-export
 * directory that `run.mjs` reads from, only the JSON already committed to the repo).
 *
 * Input (argv[2]): a JSON file holding an array of activities shaped like:
 * {
 *   id, name, sportType (Strava's raw ActivityType/SportType string, e.g. "TrailRun" or
 *   "WeightTraining" - buildActivityEntry() runs it through normalizeSportType() to collapse it
 *   onto this app's CSV-bulk-export vocabulary, see lib/sport-type.mjs), startLocal
 *   ("2026-07-05T06:12:39", no offset), gear (resolved key
 *   string matching gear.json's `key`, or null), isCommute,
 *   distanceMeters, movingTimeSec, elapsedTimeSec, elevationGain, avgSpeedMs, maxSpeedMs,
 *   calories, avgCadence, maxCadence, avgHeartRate, maxHeartRate, avgWatts,
 *   perceivedExertion, relativeEffort,
 *   streams: { time:[], distance:[], altitude:[], heartRate:[], cadence:[], watts:[], location:[[lat,lng],...] } | null
 * }
 * Fields with no Strava-API equivalent (elevationLoss, maxGrade/avgGrade, trainingLoad,
 * intensity, totalSteps, totalWeightLifted/totalSets/totalReps,
 * weightedAvgPower) are simply omitted, same as parse-activities.mjs does for blank CSV cells.
 * (athleteWeight is not a field at all anymore - see the PII note in parse-activities.mjs.)
 */

function readJson(path, fallback) {
  if (!fs.existsSync(path)) return fallback;
  return JSON.parse(fs.readFileSync(path, 'utf8'));
}

function detectTimezone(lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return DEFAULT_TZ;
  try {
    return findTimezone(lat, lng)?.[0] ?? DEFAULT_TZ;
  } catch {
    return DEFAULT_TZ;
  }
}

/** Builds full-resolution (t, d, ele, hr, cad, watts, lat, lng) arrays from the MCP streams
 * payload, falling back to haversine distance from GPS when Strava's own distance stream is
 * missing. */
function buildSeries(streams) {
  if (!streams?.time?.length || streams.time.length < 2) return null;
  const n = streams.time.length;
  const loc = streams.location ?? [];
  const hasDeviceDistance = Array.isArray(streams.distance) && streams.distance.length === n;

  const t = [];
  const d = [];
  const ele = [];
  const hr = [];
  const cad = [];
  const watts = [];
  const lat = [];
  const lng = [];
  let cumDist = 0;
  let lastD = 0;
  for (let i = 0; i < n; i++) {
    const p = loc[i];
    const plat = Number(p?.[0]);
    const plng = Number(p?.[1]);
    if (!hasDeviceDistance && i > 0) {
      const prev = loc[i - 1];
      const prevLat = Number(prev?.[0]);
      const prevLng = Number(prev?.[1]);
      if (Number.isFinite(plat) && Number.isFinite(plng) && Number.isFinite(prevLat) && Number.isFinite(prevLng)) {
        cumDist += haversine(prevLat, prevLng, plat, plng);
      }
    }
    const dist = hasDeviceDistance ? streams.distance[i] : cumDist;
    lastD = typeof dist === 'number' && dist >= lastD ? dist : lastD;
    t.push(streams.time[i]);
    d.push(lastD);
    ele.push(streams.altitude?.[i]);
    hr.push(streams.heartRate?.[i]);
    cad.push(streams.cadence?.[i]);
    watts.push(streams.watts?.[i]);
    lat.push(plat);
    lng.push(plng);
  }
  if (t.some((v) => v === undefined || v === null)) return null;
  return { t, d, ele, hr, cad, watts, lat, lng };
}

function guardPace(distanceKm, movingTimeSec) {
  if (!(distanceKm >= 0.3) || !movingTimeSec) return {};
  const speedKmh = distanceKm / (movingTimeSec / 3600);
  if (speedKmh > 80) return {};
  return { paceMinPerKm: movingTimeSec / 60 / distanceKm, speedKmh };
}

function buildActivityEntry(raw, timezone) {
  const distanceKm = raw.distanceMeters != null ? raw.distanceMeters / 1000 : undefined;
  const type = normalizeSportType(raw.sportType);
  const o = {
    id: Number(raw.id),
    date: localToUtcIso(raw.startLocal, timezone),
    name: raw.name,
    type,
    gear: raw.gear ?? undefined,
    commute: !!raw.isCommute,
    elapsedTimeSec: raw.elapsedTimeSec,
    movingTimeSec: raw.movingTimeSec,
    distanceKm,
    elevationGain: raw.elevationGain,
    avgCadence: normalizeCadence(raw.avgCadence, type),
    maxCadence: normalizeCadence(raw.maxCadence, type),
    avgHeartRate: raw.avgHeartRate,
    maxHeartRate: raw.maxHeartRate,
    calories: raw.calories,
    relativeEffort: raw.relativeEffort,
    avgSpeedMs: raw.avgSpeedMs,
    maxSpeedMs: raw.maxSpeedMs,
    perceivedExertion: raw.perceivedExertion,
    avgWatts: raw.avgWatts,
  };
  for (const k of Object.keys(o)) if (o[k] === undefined || o[k] === null) delete o[k];
  Object.assign(o, guardPace(distanceKm, raw.movingTimeSec));
  return o;
}

function applyGearDelta(gearItems, newActivities) {
  const byKey = new Map(gearItems.map((g) => [g.key, g]));
  for (const a of newActivities) {
    if (!a.gear) continue;
    const g = byKey.get(a.gear);
    if (!g) continue;
    g.totalDistanceKm = Math.round(((g.totalDistanceKm || 0) + (a.distanceKm || 0)) * 10) / 10;
    g.totalMovingTimeSec = (g.totalMovingTimeSec || 0) + (a.movingTimeSec || 0);
    g.activityCount = (g.activityCount || 0) + 1;
  }
  return gearItems;
}

async function main() {
  const inputPath = process.argv[2];
  if (!inputPath) {
    console.error('usage: node sync-strava.mjs <path-to-input.json>');
    process.exit(1);
  }
  const rawActivities = JSON.parse(fs.readFileSync(inputPath, 'utf8'));

  const activities = readJson(`${SRC_DATA_DIR}/activities.json`, []);
  const existingIds = new Set(activities.map((a) => a.id));
  const gearItems = readJson(`${SRC_DATA_DIR}/gear.json`, []);
  const existingRecords = readJson(`${SRC_DATA_DIR}/records.json`, []);
  const existingBestEfforts = readJson(`${SRC_DATA_DIR}/best-efforts.json`, {});

  const recordsState = recordsStateFromExisting(existingRecords);
  const bestEffortState = bestEffortsStateFromExisting(existingBestEfforts);
  const routes = readRoutes();
  const heatGrid = readHeatGrid();
  const newActivities = [];
  let skipped = 0;

  for (const raw of rawActivities) {
    if (existingIds.has(Number(raw.id))) {
      skipped++;
      continue;
    }

    const series = buildSeries(raw.streams);
    const firstFixIdx = series ? series.lat.findIndex((v) => Number.isFinite(v)) : -1;
    const timezone = firstFixIdx >= 0 ? detectTimezone(series.lat[firstFixIdx], series.lng[firstFixIdx]) : DEFAULT_TZ;

    const entry = buildActivityEntry(raw, timezone);
    entry.hasStream = !!series;
    entry.timezone = timezone;

    if (series) {
      const { t, d, ele, hr, cad, watts, lat, lng } = series;

      foldRecords(recordsState, entry, d, t, lat, lng);
      foldBestEfforts(bestEffortState, entry, d, t, lat, lng);

      const extraSeries = entry.type === 'Swim' ? { hr } : { hr, watts };
      const { splits, splitsMi } = splitsForType(entry.type, d, t, extraSeries);
      const rawPoints = t.map((_, i) => ({
        t: Math.round(t[i]),
        d: Math.round(d[i]),
        ele: ele[i] !== undefined && ele[i] !== null ? Math.round(ele[i] * 10) / 10 : undefined,
        hr: hr[i] || undefined,
        cad: normalizeCadence(cad[i], entry.type) || undefined,
        watts: watts[i] || undefined,
        lat: Number.isFinite(lat[i]) ? Math.round(lat[i] * 1e5) / 1e5 : undefined,
        lng: Number.isFinite(lng[i]) ? Math.round(lng[i] * 1e5) / 1e5 : undefined,
      }));
      const points = downsample(rawPoints, 200);
      const year = new Date(entry.date).getUTCFullYear();
      writeJson(`${STREAMS_DIR}/${year}/${entry.id}.json`, { points, splits, splitsMi });

      const route = buildRouteEntry(entry, rawPoints);
      if (route) routes.push(route);
      addActivityToGrid(heatGrid, activityCells(rawPoints), entry.type);
    }

    activities.push(entry);
    newActivities.push(entry);
  }

  if (!newActivities.length) {
    console.log(`[sync-strava] no new activities (${skipped} already present)`);
    return;
  }

  activities.sort((a, b) => a.date.localeCompare(b.date));
  writeJsonBoth('activities.json', activities);
  writeRoutes(routes);
  writeHeatGrid(heatGrid);

  serializeRecords(recordsState, activities);
  writeBestEfforts(bestEffortState);
  applyGearDelta(gearItems, newActivities);
  writeJsonBoth('gear.json', gearItems);
  computeFitness(activities);

  console.log(`[sync-strava] merged ${newActivities.length} new activities (${skipped} already present)`);
  console.log(`[sync-strava] date range: ${newActivities[0].date} .. ${newActivities[newActivities.length - 1].date}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
