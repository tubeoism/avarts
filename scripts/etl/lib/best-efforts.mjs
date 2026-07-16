import { bestEffort } from './resample.mjs';
import { toVnDate } from './tz.mjs';
import { writeJsonBoth } from './paths.mjs';

/** Extended "best effort by year" distance targets for the Stats page's Run/Ride chart -
 * broader than RECORD_TARGETS (parse-streams.mjs/sync-strava.mjs), which only tracks the
 * classic all-time PR distances shown on /records. Keys are unique within each type but not
 * necessarily across types (e.g. both reuse '5k'/'10k'). */
export const BEST_EFFORT_TARGETS = {
  Run: [
    { key: '1mi', label: '1 mile', meters: 1609.344 },
    { key: '5k', label: '5 km', meters: 5000 },
    { key: '10k', label: '10 km', meters: 10000 },
    { key: '15k', label: '15 km', meters: 15000 },
    { key: '10mi', label: '10 miles', meters: 16093.44 },
    { key: 'half', label: 'Half Marathon', meters: 21097.5 },
    { key: '15mi', label: '15 miles', meters: 24140.16 },
    { key: '30k', label: '30 km', meters: 30000 },
    { key: '20mi', label: '20 miles', meters: 32186.88 },
    { key: 'marathon', label: 'Marathon', meters: 42195 },
  ],
  Ride: [
    { key: '5k', label: '5 km', meters: 5000 },
    { key: '10k', label: '10 km', meters: 10000 },
    { key: '25k', label: '25 km', meters: 25000 },
    { key: '15mi', label: '15 miles', meters: 24140.16 },
    { key: '30k', label: '30 km', meters: 30000 },
    { key: '40k', label: '40 km', meters: 40000 },
    { key: '50k', label: '50 km', meters: 50000 },
  ],
};

/** Folds one activity's full-resolution (distance, time) GPS series into `state` (a Map keyed
 * `${type}|${year}|${targetKey}` -> {timeSec, activityId, date}), keeping only the fastest time
 * per Vietnam-local calendar year per target distance - same sliding-window bestEffort() used for
 * the all-time PRs in records.json, just scoped per year and across both Run and Ride target
 * sets instead of a single all-time Run-only winner. Callers must skip activities already
 * excluded from PR computation (ambiguous shared GPS file, no stream) before calling this, same
 * as records.json - there's no separate exclusion list here.
 *
 * Same outdoor-GPS-only requirement as lib/records.mjs#foldRecords - see its docstring. */
export function foldBestEfforts(state, activity, d, t, lat, lng) {
  const targets = BEST_EFFORT_TARGETS[activity.type];
  if (!targets || !d.length || d[d.length - 1] <= 0) return;
  if (!lat?.some((v, i) => Number.isFinite(v) && Number.isFinite(lng[i]))) return;
  const year = toVnDate(activity.date).getUTCFullYear();
  for (const target of targets) {
    const timeSec = bestEffort(d, t, target.meters);
    if (timeSec === undefined) continue;
    const key = `${activity.type}|${year}|${target.key}`;
    const current = state.get(key);
    if (!current || timeSec < current.timeSec) {
      state.set(key, { timeSec: Math.round(timeSec), activityId: activity.id, date: activity.date });
    }
  }
}

/** Rebuilds a fold state (see foldBestEfforts) from a previously-serialized best-efforts.json,
 * so incremental syncs (sync-strava.mjs) can patch in new activities without reprocessing the
 * GPS of every activity already accounted for. */
export function stateFromExisting(existing) {
  const state = new Map();
  for (const [type, targets] of Object.entries(existing || {})) {
    for (const target of targets) {
      for (const entry of target.byYear || []) {
        state.set(`${type}|${entry.year}|${target.key}`, {
          timeSec: entry.timeSec,
          activityId: entry.activityId,
          date: entry.date,
        });
      }
    }
  }
  return state;
}

/** Serializes a fold state into the shape consumed by the Stats page: one entry per type, each
 * target distance carrying its own year-ordered array (only years with a qualifying effort). */
export function serializeBestEfforts(state) {
  const out = {};
  for (const [type, targets] of Object.entries(BEST_EFFORT_TARGETS)) {
    out[type] = targets.map((target) => {
      const byYear = [];
      for (const [key, entry] of state) {
        const [entryType, entryYear, entryKey] = key.split('|');
        if (entryType !== type || entryKey !== target.key) continue;
        byYear.push({ year: Number(entryYear), ...entry });
      }
      byYear.sort((a, b) => a.year - b.year);
      return { key: target.key, label: target.label, meters: target.meters, byYear };
    });
  }
  return out;
}

export function writeBestEfforts(state) {
  const serialized = serializeBestEfforts(state);
  writeJsonBoth('best-efforts.json', serialized);
  return serialized;
}
