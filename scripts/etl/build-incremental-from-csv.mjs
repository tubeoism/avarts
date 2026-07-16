import fs from 'node:fs';
import path from 'node:path';
import { parseActivities } from './parse-activities.mjs';
import { parseStreams, DEFAULT_TZ } from './parse-streams.mjs';
import { parseGear } from './parse-gear.mjs';
import { parseEvents } from './parse-events.mjs';
import { parseProfile } from './parse-profile.mjs';
import { computeFitness } from './compute-fitness.mjs';
import { serializeRecords, stateFromExisting as recordsStateFromExisting } from './lib/records.mjs';
import { stateFromExisting as bestEffortsStateFromExisting } from './lib/best-efforts.mjs';
import { readRoutes } from './lib/routes.mjs';
import { readHeatGrid } from './lib/heatgrid.mjs';
import { readCsv, colIndexer, toNum } from './lib/csv.mjs';
import { APP_DIR, SRC_DATA_DIR, writeJsonBoth } from './lib/paths.mjs';

/*
 * Incremental counterpart to run.mjs for the "Build from downloaded data" GitHub Action's
 * `incremental` mode: instead of wiping and reprocessing the entire history (run.mjs's job, used
 * by that action's `full-reset` mode), this only decompresses/folds the activities that are
 * genuinely new - present in download/activities.csv but not yet in retained-raw/activities.csv
 * (the marker for "already went through a full CSV+FIT/GPX parse at some point"). Activities
 * already live in the committed activities.json (added since retained-raw/ was last refreshed, by
 * the nightly MCP routine or strava-api-sync.yml) are skipped too - they're already accounted for,
 * just via a different pipeline with fewer fields (see CLAUDE.md's note on the two pipelines
 * writing shared JSON files).
 *
 * Deliberately does NOT try to upgrade an existing live-synced activity's entry with fuller CSV
 * data (trainingLoad/intensity/elevationLoss/maxGrade/avgGrade/totalSteps, absent from the
 * MCP/REST sync paths) even if this download now has full CSV data for it - out of scope, would
 * need replacing (not appending) an activities.json entry plus unwinding and redoing its records/
 * best-efforts/routes/heatgrid contribution. It's simply left as whatever the live sync produced.
 *
 * Expects STRAVA_EXPORT_DIR to already point at the downloaded export (see run.mjs/package.json's
 * `npm run etl` for the same convention) - the caller (build-from-download.yml) sets it to
 * `download`.
 */

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

/** Activity IDs already present in retained-raw/activities.csv (i.e. already fully processed by a
 * prior full ETL run - run.mjs, either locally or via the `full-reset` mode of this same action),
 * mapped to their raw `Filename` cell - used both to build the "already known" id set and, below,
 * to warn about rows whose raw file never actually made it into retained-raw/activities/ (see
 * warnAboutMissingRawFiles()). */
function retainedRawActivityInfo() {
  const csvPath = path.join(APP_DIR, 'retained-raw', 'activities.csv');
  if (!fs.existsSync(csvPath)) return new Map();
  const { header, data } = readCsv(csvPath);
  const idx = colIndexer(header);
  const idIdx = idx.first('Activity ID');
  const fnIdx = idx.first('Filename');
  if (idIdx < 0) return new Map();
  const map = new Map();
  for (const row of data) {
    const id = toNum(row[idIdx]);
    if (id === undefined) continue;
    map.set(id, fnIdx >= 0 ? row[fnIdx] : undefined);
  }
  return map;
}

/** Pure visibility, no behavior change: a retained-raw/activities.csv row can reference a raw
 * file that was never actually copied into retained-raw/activities/ (this happened historically
 * for every activity whose raw file was a plain uncompressed .fit/.gpx/.tcx - refresh-retained-
 * raw.mjs's allowlist used to only match the gzip-compressed .fit.gz/.gpx.gz/.tcx.gz variants and
 * silently dropped the rest, see CLAUDE.md gotcha for the fix). Such an activity has a CSV row
 * (so this script treats it as "already known", never re-fetched) but no way to ever get GPS
 * without a `mode=full-reset` run against a fresh export - this just surfaces that gap in the log
 * instead of leaving it silent. */
function warnAboutMissingRawFiles(retainedInfo) {
  const activitiesDir = path.join(APP_DIR, 'retained-raw', 'activities');
  let missing = 0;
  for (const filename of retainedInfo.values()) {
    if (!filename) continue;
    const base = path.basename(filename);
    if (!fs.existsSync(path.join(activitiesDir, base)) && !fs.existsSync(path.join(activitiesDir, `${base}.gz`))) {
      missing++;
    }
  }
  if (missing > 0) {
    console.warn(
      `[build-incremental] ${missing} activities have a CSV row in retained-raw/ but no raw file on disk ` +
        '(hasStream stays false for them) - run mode=full-reset with a fresh Strava export to recover',
    );
  }
}

async function main() {
  const downloadActivities = parseActivities();
  const retainedInfo = retainedRawActivityInfo();
  const retainedIds = new Set(retainedInfo.keys());
  warnAboutMissingRawFiles(retainedInfo);

  const existingActivities = readJson(`${SRC_DATA_DIR}/activities.json`, []);
  const existingIds = new Set(existingActivities.map((a) => a.id));

  const candidateIds = new Set();
  const newActivities = [];
  let alreadyInRetainedRaw = 0;
  let alreadyLive = 0;
  for (const a of downloadActivities) {
    if (retainedIds.has(a.id)) {
      alreadyInRetainedRaw++;
      continue;
    }
    if (existingIds.has(a.id)) {
      alreadyLive++;
      continue;
    }
    candidateIds.add(a.id);
    newActivities.push(a);
  }

  console.log(
    `[build-incremental] download/ has ${downloadActivities.length} activities: ` +
      `${alreadyInRetainedRaw} already in retained-raw/, ${alreadyLive} already synced live, ` +
      `${newActivities.length} genuinely new`,
  );

  if (!newActivities.length) {
    console.log('[build-incremental] nothing new to process - activities.json/gear.json/etc left untouched');
    return;
  }

  const existingRecords = readJson(`${SRC_DATA_DIR}/records.json`, []);
  const existingBestEfforts = readJson(`${SRC_DATA_DIR}/best-efforts.json`, {});

  // `downloadActivities` (the FULL set, not just newActivities) is passed through so the
  // shared-raw-file ambiguity check (see CLAUDE.md's Records/Best-effort/Splits note on
  // duplicate GPS files) sees the whole picture; `shouldProcess` is what actually limits
  // decompression/folding to the new ones.
  const { streamedIds, recordsState, timezones } = await parseStreams(downloadActivities, {
    shouldProcess: (a) => candidateIds.has(a.id),
    seedRecordsState: recordsStateFromExisting(existingRecords),
    seedBestEffortState: bestEffortsStateFromExisting(existingBestEfforts),
    seedRoutes: readRoutes(),
    seedHeatGrid: readHeatGrid(),
  });

  for (const a of newActivities) {
    a.hasStream = streamedIds.has(a.id);
    a.timezone = timezones.get(a.id) ?? DEFAULT_TZ;
  }

  const mergedActivities = [...existingActivities, ...newActivities].sort((a, b) => a.date.localeCompare(b.date));
  writeJsonBoth('activities.json', mergedActivities);
  console.log(`[build-incremental] wrote ${mergedActivities.length} activities (${newActivities.length} new)`);

  // records.json/best-efforts.json/routes.json/heatgrid.json are already fully written by
  // parseStreams() above (seeded with the existing data, folded with the new activities only).
  serializeRecords(recordsState, mergedActivities);

  // Gear: rebuild the catalog from THIS download's shoes/bikes/components.csv (fresher than
  // whatever retained-raw/ has) and recompute totals against the full merged activity list -
  // recomputeGearTotals() is a from-scratch scan, so this can't drift regardless of how many
  // activities were actually new this run (see lib/gear.mjs).
  parseGear(mergedActivities);

  // events.csv/profile.csv are full bulk-export snapshots too (not incremental sources), so a
  // full refresh from this download is always safe/correct, same as run.mjs's full pipeline.
  parseEvents();
  parseProfile();

  computeFitness(mergedActivities);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
