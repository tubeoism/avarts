import { readCsv, colIndexer, toNum, toStr, toBool, toIso } from './lib/csv.mjs';
import { srcPath } from './lib/paths.mjs';
import { normalizeCadence } from './lib/cadence.mjs';
import { normalizeSportType } from './lib/sport-type.mjs';

// [outputKey, csvColumnName, occurrence ('first'|'last'), type]
const FIELD_MAP = [
  ['id', 'Activity ID', 'first', 'num'],
  ['date', 'Activity Date', 'first', 'date'],
  ['name', 'Activity Name', 'first', 'str'],
  ['type', 'Activity Type', 'first', 'str'],
  ['description', 'Activity Description', 'first', 'str'],
  ['gear', 'Activity Gear', 'first', 'str'],
  ['filename', 'Filename', 'first', 'str'],
  ['commute', 'Commute', 'first', 'bool'],
  ['elapsedTimeSec', 'Elapsed Time', 'first', 'num'],
  ['movingTimeSec', 'Moving Time', 'last', 'num'],
  ['distanceKm', 'Distance', 'first', 'num'],
  ['elevationGain', 'Elevation Gain', 'first', 'num'],
  ['elevationLoss', 'Elevation Loss', 'first', 'num'],
  ['maxGrade', 'Max Grade', 'first', 'num'],
  ['avgGrade', 'Average Grade', 'first', 'num'],
  ['maxCadence', 'Max Cadence', 'first', 'num'],
  ['avgCadence', 'Average Cadence', 'first', 'num'],
  ['maxHeartRate', 'Max Heart Rate', 'first', 'num'],
  ['avgHeartRate', 'Average Heart Rate', 'first', 'num'],
  ['calories', 'Calories', 'first', 'num'],
  ['avgTemperature', 'Average Temperature', 'first', 'num'],
  ['relativeEffort', 'Relative Effort', 'first', 'num'],
  ['trainingLoad', 'Training Load', 'first', 'num'],
  ['intensity', 'Intensity', 'first', 'num'],
  ['avgSpeedMs', 'Average Speed', 'last', 'num'],
  ['maxSpeedMs', 'Max Speed', 'first', 'num'],
  // 'Athlete Weight' is deliberately NOT parsed: it's real body-weight PII, activities.json is
  // fetched client-side on the deployed site, and nothing in src/ reads it (weight tracking was
  // removed as a feature). The column's values are also blanked in retained-raw/activities.csv.
  ['totalSteps', 'Total Steps', 'first', 'num'],
  ['perceivedExertion', 'Perceived Exertion', 'first', 'num'],
  ['totalWeightLifted', 'Total Weight Lifted', 'first', 'num'],
  ['totalSets', 'Total Sets', 'first', 'num'],
  ['totalReps', 'Total Reps', 'first', 'num'],
  ['avgWatts', 'Average Watts', 'first', 'num'],
  ['weightedAvgPower', 'Weighted Average Power', 'first', 'num'],
];

const CONVERT = { num: toNum, str: toStr, bool: toBool, date: toIso };

export function parseActivities() {
  const { header, data } = readCsv(srcPath('activities.csv'));
  const idx = colIndexer(header);

  const resolved = FIELD_MAP.map(([key, col, occurrence, type]) => ({
    key,
    i: occurrence === 'last' ? idx.last(col) : idx.first(col),
    type,
  }));

  const activities = data
    .map((row) => {
      const o = {};
      for (const { key, i, type } of resolved) {
        if (i < 0) continue;
        const v = CONVERT[type](row[i]);
        if (v !== undefined) o[key] = v;
      }
      // The CSV bulk-export pipeline used to be the only one of the two activity-sync paths that
      // never ran its raw type through normalizeSportType() (see CLAUDE.md's Sport type note) -
      // a CSV export can carry its own oddball Activity Type value (e.g. "Stair-Stepper") that
      // this app never recognized as anything, instead of folding it into a canonical type like
      // sync-strava.mjs already does for its own API-sourced values. No-op for the canonical CSV
      // type strings already in use elsewhere (none of them match an ALIASES key or contain
      // PascalCase humps).
      o.type = normalizeSportType(o.type);
      o.avgCadence = normalizeCadence(o.avgCadence, o.type);
      o.maxCadence = normalizeCadence(o.maxCadence, o.type);
      // Strava's bulk CSV export stores the "Distance" column in km for every activity type except
      // Swim, which is in meters (confirmed against raw pool-swim rows, e.g. "Distance: 550" next to
      // a ~16min moving time only makes sense as 550m, not 550km - treating it as km inflates every
      // swim's distance ~1000x). This is the systemic fix for what was first patched as a
      // one-off unit correction on a single activity before the root cause was found.
      if (o.type === 'Swim' && o.distanceKm !== undefined) {
        o.distanceKm = o.distanceKm / 1000;
      }
      // derived fields (skip near-zero distances, e.g. an indoor "Workout" logged with 0.01km of GPS
      // noise - dividing by that produces a meaningless multi-hour "pace")
      if (o.distanceKm >= 0.3 && o.movingTimeSec) {
        const speedKmh = o.distanceKm / (o.movingTimeSec / 3600);
        // a handful of source activities have corrupted distance/time (e.g. one "Swim" logged as
        // 28km in 28s); reject anything faster than a bike descent as bad data rather than display it
        if (speedKmh <= 80) {
          o.paceMinPerKm = o.movingTimeSec / 60 / o.distanceKm;
          o.speedKmh = speedKmh;
        }
      }
      return o;
    })
    .filter((a) => a.id && a.date)
    .sort((a, b) => a.date.localeCompare(b.date));

  const typeCounts = {};
  for (const a of activities) typeCounts[a.type] = (typeCounts[a.type] || 0) + 1;

  console.log(`[activities] parsed ${activities.length} activities`);
  console.log('[activities] by type:', typeCounts);

  return activities;
}
