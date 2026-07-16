/** Evenly-spaced downsample to at most `max` points, always keeping the first and last. */
export function downsample(arr, max = 200) {
  if (arr.length <= max) return arr;
  const out = [];
  const step = (arr.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) {
    out.push(arr[Math.round(i * step)]);
  }
  return out;
}

/** Perpendicular distance in meters from point `points[i]` to the segment `points[a]-points[b]`,
 * via a local equirectangular projection (meters-accurate at the few-km scale of one activity's
 * track - full geodesic precision isn't needed for a line simplified down to ~40 points). */
function segmentDistanceMeters(xy, i, a, b) {
  const [px, py] = xy[i];
  const [ax, ay] = xy[a];
  const [bx, by] = xy[b];
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Ramer-Douglas-Peucker line simplification, bounded by a point budget instead of a distance
 * tolerance: repeatedly splits whichever segment currently deviates most from the original
 * track, until `max` points are picked (always keeps the first/last point). Unlike downsample()
 * above - which keeps one point every N samples regardless of shape - this spends more of the
 * point budget on turns/curves (which need several points to represent) and fewer on straight
 * stretches (which need none), so the simplified line hugs the real path more closely at the
 * same point count. Used for the overview map (routes.json), not the per-activity detail chart,
 * where evenly-spaced-in-time samples are what you actually want. */
export function simplifyToCount(points, max) {
  if (points.length <= max) return points;
  const n = points.length;
  const latRad = (points[0].lat * Math.PI) / 180;
  const mPerDegLat = 111320;
  const mPerDegLng = 111320 * Math.cos(latRad);
  const xy = points.map((p) => [p.lng * mPerDegLng, p.lat * mPerDegLat]);

  const selected = new Set([0, n - 1]);
  const segments = [[0, n - 1]];

  while (selected.size < max && segments.length) {
    let bestSeg = -1;
    let bestIdx = -1;
    let bestDist = -1;
    for (let s = 0; s < segments.length; s++) {
      const [a, b] = segments[s];
      if (b - a < 2) continue;
      for (let i = a + 1; i < b; i++) {
        const d = segmentDistanceMeters(xy, i, a, b);
        if (d > bestDist) {
          bestDist = d;
          bestSeg = s;
          bestIdx = i;
        }
      }
    }
    if (bestSeg === -1) break;
    const [a, b] = segments[bestSeg];
    segments.splice(bestSeg, 1, [a, bestIdx], [bestIdx, b]);
    selected.add(bestIdx);
  }

  return [...selected].sort((x, y) => x - y).map((i) => points[i]);
}

/** Fastest time (seconds) to cover `targetMeters` within a monotonic (distance, time) series. */
export function bestEffort(distArr, timeArr, targetMeters) {
  const n = distArr.length;
  if (n < 2 || distArr[n - 1] - distArr[0] < targetMeters) return undefined;
  let best = Infinity;
  let j = 0;
  for (let i = 0; i < n; i++) {
    if (j < i) j = i;
    while (j < n && distArr[j] - distArr[i] < targetMeters) j++;
    if (j >= n) break;
    const dur = timeArr[j] - timeArr[i];
    if (dur < best) best = dur;
  }
  return Number.isFinite(best) ? best : undefined;
}

/** Cumulative time at every `stepMeters` boundary, linear-interpolated between the two nearest raw
 * samples bracketing that distance - shared step-boundary engine for every splits variant
 * (computeSplits/computeMileSplits/computeFixedSplits below). `extraSeries` (e.g. {hr, watts}) is
 * optional: when given, each split also gets an `avg<Key>` field - the real mean of the raw
 * samples whose index falls inside that split's window (NOT interpolated, unlike time), skipping
 * undefined/null entries (e.g. an activity with GPS+HR but no power meter just gets
 * avgWatts: undefined for every split rather than a fabricated number). */
function splitsAtStep(distArr, timeArr, stepMeters, extraSeries) {
  const splits = [];
  const totalSteps = Math.floor(distArr[distArr.length - 1] / stepMeters);
  const extraKeys = Object.keys(extraSeries || {}).filter((k) => extraSeries[k]);
  let idx = 0;
  let windowStart = 0;
  for (let n = 1; n <= totalSteps; n++) {
    const targetDist = n * stepMeters;
    while (idx < distArr.length - 1 && distArr[idx] < targetDist) idx++;
    const prev = Math.max(idx - 1, 0);
    const d0 = distArr[prev];
    const d1 = distArr[idx];
    const t0 = timeArr[prev];
    const t1 = timeArr[idx];
    const frac = d1 > d0 ? (targetDist - d0) / (d1 - d0) : 0;
    const t = t0 + (t1 - t0) * frac;
    const split = { n, timeSec: Math.round(t) };
    // windowStart normally starts right after the previous split's boundary sample so that
    // sample isn't double-counted into both splits' averages; Math.min guards the rare case
    // where a single sample spans more than one split's worth of distance (sparse sampling),
    // falling back to reusing that one sample rather than producing an empty (undefined) window.
    const windowFrom = Math.min(windowStart, idx);
    for (const key of extraKeys) {
      const arr = extraSeries[key];
      let sum = 0;
      let count = 0;
      for (let i = windowFrom; i <= idx; i++) {
        const v = arr[i];
        if (v !== undefined && v !== null) {
          sum += v;
          count++;
        }
      }
      split[`avg${key[0].toUpperCase()}${key.slice(1)}`] = count ? Math.round((sum / count) * 10) / 10 : undefined;
    }
    splits.push(split);
    windowStart = idx + 1;
  }
  // convert cumulative split time -> per-step duration
  let prevT = 0;
  for (const s of splits) {
    s.durationSec = Math.round(s.timeSec - prevT);
    prevT = s.timeSec;
  }
  return splits;
}

/** Per-kilometer splits from a monotonic distance/time series, optionally with avgHr/avgWatts. */
export function computeSplits(distArr, timeArr, extraSeries) {
  return splitsAtStep(distArr, timeArr, 1000, extraSeries).map(({ n, timeSec, durationSec, ...rest }) => ({ km: n, timeSec, durationSec, ...rest }));
}

// 1 mile in meters (exact, per international definition) - matches KM_PER_MILE in src/lib/format.js.
export const MILE_METERS = 1609.344;

/** Per-mile splits, same interpolation as computeSplits just at mile-length steps - computed
 * directly from the full-resolution stream (before it's downsampled/discarded), so unlike the
 * client-side km-anchor interpolation the activity detail page falls back to for older activities
 * that predate this field, these are exact rather than approximated. */
export function computeMileSplits(distArr, timeArr, extraSeries) {
  return splitsAtStep(distArr, timeArr, MILE_METERS, extraSeries).map(({ n, timeSec, durationSec, ...rest }) => ({ mi: n, timeSec, durationSec, ...rest }));
}

/** Fixed-step splits shown identically regardless of the km/mile display toggle - Ride's 5km
 * chunks, Swim's 250m chunks (see CLAUDE.md: per-km/per-mile granularity like Run is either too
 * dense - a 40km ride would be 40 rows - or meaningless at Swim's scale). `km` on each row is the
 * real cumulative distance at that split's boundary (n * stepMeters/1000), not a step index. */
export function computeFixedSplits(distArr, timeArr, stepMeters, extraSeries) {
  const stepKm = stepMeters / 1000;
  return splitsAtStep(distArr, timeArr, stepMeters, extraSeries).map(({ n, timeSec, durationSec, ...rest }) => ({
    km: Math.round(n * stepKm * 1000) / 1000,
    timeSec,
    durationSec,
    ...rest,
  }));
}

/** Per-activity-type splits table, ready to write into a stream JSON file's `splits`/`splitsMi`
 * fields - shared by parse-streams.mjs (full pipeline) and sync-strava.mjs (nightly incremental)
 * so the two never drift on which type gets which step size (the "two pipelines write one field"
 * bug class CLAUDE.md documents elsewhere for routes.json/best-efforts.json/heatgrid.json). Run
 * keeps the standard per-km + per-mile tables (the unit toggle switches between them); Ride and
 * Swim get one fixed-step table (5km / 250m respectively, see computeFixedSplits) reused for BOTH
 * toggle states. */
export function splitsForType(type, distArr, timeArr, extraSeries) {
  const total = distArr[distArr.length - 1];
  if (type === 'Ride') {
    const fixed = total >= 5000 ? computeFixedSplits(distArr, timeArr, 5000, extraSeries) : [];
    return { splits: fixed, splitsMi: fixed };
  }
  if (type === 'Swim') {
    const fixed = total >= 250 ? computeFixedSplits(distArr, timeArr, 250, extraSeries) : [];
    return { splits: fixed, splitsMi: fixed };
  }
  return {
    splits: total >= 1000 ? computeSplits(distArr, timeArr, extraSeries) : [],
    splitsMi: total >= MILE_METERS ? computeMileSplits(distArr, timeArr, extraSeries) : [],
  };
}
