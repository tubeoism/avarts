import { bestEffort } from './resample.mjs';
import { writeJsonBoth } from './paths.mjs';

/** All-time personal-record distance targets for the /records page, split by activity type -
 * mirrors BEST_EFFORT_TARGETS' shape (lib/best-efforts.mjs) but keeps its own list: Run's '1k' has
 * no equivalent in BEST_EFFORT_TARGETS (which uses '1mi' instead), so the two constants can't be
 * merged even though most entries overlap in value. Single shared source of truth for both
 * run.mjs (full pipeline) and sync-strava.mjs (nightly incremental) - previously this list was
 * independently duplicated in both files plus a third copy of labels/meters in compute-records.mjs,
 * the same "two pipelines write one field" bug class as routes.json/best-efforts.json/splitsMi/
 * heatgrid.json (see CLAUDE.md's note on the two pipelines writing shared JSON files). */
export const RECORD_TARGETS = {
  Run: [
    { key: '1k', label: '1 km', meters: 1000 },
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
    { key: '30k', label: '30 km', meters: 30000 },
    { key: '40k', label: '40 km', meters: 40000 },
    { key: '50k', label: '50 km', meters: 50000 },
  ],
};

/** Folds one activity's full-resolution (distance, time) GPS series into `state` (a Map keyed
 * `${type}|${targetKey}` -> {timeSec, activityId, date}), keeping only the fastest all-time. Same
 * sliding-window bestEffort() as lib/best-efforts.mjs's foldBestEfforts, just not scoped by year -
 * this is the single global best per distance, not a per-year one. Callers must skip activities
 * already excluded from best-effort computation (ambiguous shared GPS file, no stream) before
 * calling this, same as best-efforts.json - there's no separate exclusion list here.
 *
 * Requires a real outdoor GPS fix (`lat`/`lng`, same full-resolution arrays `parse-streams.mjs`/
 * `sync-strava.mjs` already have in scope) - `d`/`t` alone aren't enough, since a treadmill run or
 * indoor trainer ride records device/footpod distance and time with NO location at all, and those
 * are not comparable to (and historically inflated past) real outdoor efforts - e.g. every current
 * Ride record before this gate was an indoor trainer session, not a real ride. */
export function foldRecords(state, activity, d, t, lat, lng) {
  const targets = RECORD_TARGETS[activity.type];
  if (!targets || !d.length || d[d.length - 1] <= 0) return;
  if (!lat?.some((v, i) => Number.isFinite(v) && Number.isFinite(lng[i]))) return;
  for (const target of targets) {
    const timeSec = bestEffort(d, t, target.meters);
    if (timeSec === undefined) continue;
    const key = `${activity.type}|${target.key}`;
    const current = state.get(key);
    if (!current || timeSec < current.timeSec) {
      state.set(key, { timeSec: Math.round(timeSec), activityId: activity.id, date: activity.date });
    }
  }
}

/** Rebuilds a fold state (see foldRecords) from a previously-serialized records.json, so
 * incremental syncs (sync-strava.mjs) can patch in new activities without reprocessing the GPS of
 * every activity already accounted for. */
export function stateFromExisting(existingRecords) {
  const state = new Map();
  for (const r of existingRecords || []) {
    state.set(`${r.type}|${r.distanceKey}`, { timeSec: r.timeSec, activityId: r.activityId, date: r.date });
  }
  return state;
}

/** Serializes a fold state into the flat array consumed by /records: one entry per (type,
 * distance) pair that has at least one qualifying effort. */
export function serializeRecords(state, activities) {
  const activityById = new Map(activities.map((a) => [a.id, a]));
  const out = [];
  for (const [type, targets] of Object.entries(RECORD_TARGETS)) {
    for (const target of targets) {
      const entry = state.get(`${type}|${target.key}`);
      if (!entry) continue;
      const a = activityById.get(entry.activityId);
      const km = target.meters / 1000;
      out.push({
        type,
        distanceKey: target.key,
        label: target.label,
        meters: target.meters,
        timeSec: entry.timeSec,
        paceMinPerKm: entry.timeSec / 60 / km,
        speedKmh: km / (entry.timeSec / 3600),
        activityId: entry.activityId,
        activityName: a?.name,
        date: entry.date,
      });
    }
  }
  writeJsonBoth('records.json', out);
  console.log(`[records] wrote ${out.length} personal records`);
  return out;
}
