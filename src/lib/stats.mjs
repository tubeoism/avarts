import { toVnDate, vnMidnightUtc } from './format.js';

// vnRef is the reference instant already shifted via toVnDate(), so its UTC getters read as
// Vietnam-local calendar fields. startOfWeek returns a real UTC instant (via vnMidnightUtc)
// representing the correct GMT+7 boundary, so it compares directly against activities' plain
// (unshifted) date instants.
function startOfWeek(vnRef) {
  const day = (vnRef.getUTCDay() + 6) % 7; // Monday = 0
  return vnMidnightUtc(vnRef.getUTCFullYear(), vnRef.getUTCMonth(), vnRef.getUTCDate() - day);
}

function startOfMonth(vnRef) {
  return vnMidnightUtc(vnRef.getUTCFullYear(), vnRef.getUTCMonth(), 1);
}

function startOfQuarter(vnRef) {
  return vnMidnightUtc(vnRef.getUTCFullYear(), Math.floor(vnRef.getUTCMonth() / 3) * 3, 1);
}

function startOfYear(vnRef) {
  return vnMidnightUtc(vnRef.getUTCFullYear(), 0, 1);
}

/** Start/end boundaries (real UTC instants) for the current and immediately preceding
 * week/month/quarter, plus a year-to-date window a year back, all anchored at referenceDate
 * in Vietnam-local calendar terms. vnMidnightUtc rolls over out-of-range month/day values
 * correctly, so month-1/quarter-3 at a year boundary lands in the previous year unaided. */
export function periodBounds(referenceDate) {
  const vnRef = toVnDate(referenceDate);
  const farFuture = new Date(Date.UTC(9999, 0, 1));
  const weekStart = startOfWeek(vnRef);
  const monthStart = startOfMonth(vnRef);
  const quarterStart = startOfQuarter(vnRef);
  const yearStart = startOfYear(vnRef);
  return {
    week: { start: weekStart, end: farFuture },
    month: { start: monthStart, end: farFuture },
    quarter: { start: quarterStart, end: farFuture },
    year: { start: yearStart, end: farFuture },
    prevWeek: { start: new Date(weekStart.getTime() - 7 * 86400000), end: weekStart },
    prevMonth: { start: vnMidnightUtc(vnRef.getUTCFullYear(), vnRef.getUTCMonth() - 1, 1), end: monthStart },
    prevQuarter: {
      start: vnMidnightUtc(vnRef.getUTCFullYear(), Math.floor(vnRef.getUTCMonth() / 3) * 3 - 3, 1),
      end: quarterStart,
    },
    prevYearYtd: {
      start: vnMidnightUtc(vnRef.getUTCFullYear() - 1, 0, 1),
      end: vnMidnightUtc(vnRef.getUTCFullYear() - 1, vnRef.getUTCMonth(), vnRef.getUTCDate() + 1),
    },
  };
}

export function sumTotals(activities) {
  return activities.reduce(
    (acc, a) => {
      acc.km += a.distanceKm || 0;
      acc.movingTimeSec += a.movingTimeSec || 0;
      acc.elevationGain += a.elevationGain || 0;
      acc.calories += a.calories || 0;
      acc.count += 1;
      return acc;
    },
    { km: 0, movingTimeSec: 0, elevationGain: 0, calories: 0, count: 0 },
  );
}

export function inRange(activities, start, end) {
  return activities.filter((a) => {
    const d = new Date(a.date);
    return d >= start && d < end;
  });
}

export function periodTotals(activities, referenceDate) {
  const b = periodBounds(referenceDate);
  return {
    week: sumTotals(inRange(activities, b.week.start, b.week.end)),
    month: sumTotals(inRange(activities, b.month.start, b.month.end)),
    quarter: sumTotals(inRange(activities, b.quarter.start, b.quarter.end)),
    year: sumTotals(inRange(activities, b.year.start, b.year.end)),
    allTime: sumTotals(activities),
    prevWeek: sumTotals(inRange(activities, b.prevWeek.start, b.prevWeek.end)),
    prevMonth: sumTotals(inRange(activities, b.prevMonth.start, b.prevMonth.end)),
    prevQuarter: sumTotals(inRange(activities, b.prevQuarter.start, b.prevQuarter.end)),
    prevYearYtd: sumTotals(inRange(activities, b.prevYearYtd.start, b.prevYearYtd.end)),
  };
}

/** Monday-Sunday weekly distance/time/calories/per-type buckets for the `weeksCount` most recent
 * weeks up to (and including) the current week - the Dashboard's volume combo chart. Time and
 * calories are summed unconditionally across every activity type in each bucket, same principle
 * as monthlyTypeBuckets/dailyTypeBuckets/yearlyTypeBreakdown below (not calendarTotals's
 * distance-having-types gate - km is likewise summed unconditionally since distanceKm is already
 * 0, not missing, for types like Weight Training). */
export function recentWeeklyBuckets(activities, referenceDate, weeksCount = 30) {
  const vnRef = toVnDate(referenceDate);
  const currentWeekStart = startOfWeek(vnRef);
  const firstWeekStart = new Date(currentWeekStart.getTime() - (weeksCount - 1) * 7 * 86400000);

  const buckets = [];
  for (let start = firstWeekStart; start <= currentWeekStart; start = new Date(start.getTime() + 7 * 86400000)) {
    const end = new Date(start.getTime() + 7 * 86400000);
    buckets.push({ weekStart: toVnDate(start).toISOString().slice(0, 10), start, end, km: 0, movingTimeSec: 0, calories: 0, count: 0, byType: new Map() });
  }
  for (const a of activities) {
    const d = new Date(a.date);
    if (d < buckets[0].start || d >= buckets[buckets.length - 1].end) continue;
    for (const b of buckets) {
      if (d >= b.start && d < b.end) {
        b.km += a.distanceKm || 0;
        b.movingTimeSec += a.movingTimeSec || 0;
        b.calories += a.calories || 0;
        b.count += 1;
        const prevType = b.byType.get(a.type) || { km: 0, movingTimeSec: 0, calories: 0 };
        b.byType.set(a.type, {
          km: prevType.km + (a.distanceKm || 0),
          movingTimeSec: prevType.movingTimeSec + (a.movingTimeSec || 0),
          calories: prevType.calories + (a.calories || 0),
        });
        break;
      }
    }
  }
  return buckets.map(({ start, end, byType, ...rest }) => ({
    ...rest,
    types: [...byType.entries()].map(([type, v]) => ({ type, ...v })),
  }));
}

/** All Monday-Sunday weeks (Vietnam-local, see CLAUDE.md's timezone note) that contain at least one
 * activity, oldest first, each broken down into its own 7 days (per-day activities + running
 * week totals) - source for the Training Log's endless-scroll molecule visualization, which
 * needs per-day detail rather than the aggregated per-week numbers recentWeeklyBuckets produces. */
export function weeklyLogBuckets(activities) {
  const byWeek = new Map();
  for (const a of activities) {
    const vn = toVnDate(a.date);
    const weekStartUtc = startOfWeek(vn);
    const key = toVnDate(weekStartUtc).toISOString().slice(0, 10);
    if (!byWeek.has(key)) {
      const days = Array.from({ length: 7 }, (_, i) => {
        const dayUtc = new Date(weekStartUtc.getTime() + i * 86400000);
        return { date: toVnDate(dayUtc).toISOString().slice(0, 10), activities: [] };
      });
      byWeek.set(key, { weekStart: key, weekEnd: days[6].date, km: 0, movingTimeSec: 0, calories: 0, count: 0, days });
    }
    const bucket = byWeek.get(key);
    const dow = (vn.getUTCDay() + 6) % 7; // Monday = 0, matches startOfWeek's convention
    bucket.days[dow].activities.push({
      id: a.id,
      name: a.name,
      type: a.type,
      date: a.date,
      timezone: a.timezone,
      distanceKm: a.distanceKm,
      movingTimeSec: a.movingTimeSec,
      calories: a.calories,
    });
    bucket.km += a.distanceKm || 0;
    bucket.movingTimeSec += a.movingTimeSec || 0;
    bucket.calories += a.calories || 0;
    bucket.count += 1;
  }
  return [...byWeek.values()].sort((a, b) => a.weekStart.localeCompare(b.weekStart));
}

export function typeBreakdown(activities) {
  const map = new Map();
  for (const a of activities) {
    if (!map.has(a.type)) map.set(a.type, { type: a.type, km: 0, movingTimeSec: 0, calories: 0, count: 0 });
    const b = map.get(a.type);
    b.km += a.distanceKm || 0;
    b.movingTimeSec += a.movingTimeSec || 0;
    b.calories += a.calories || 0;
    b.count += 1;
  }
  return [...map.values()].sort((a, b) => b.count - a.count);
}

/** typeBreakdown restricted to activities within [start, end) - powers the Stats page's
 * activity-type pie chart, which can be viewed for this month/quarter/year (YTD). */
export function typeBreakdownForRange(activities, start, end) {
  return typeBreakdown(inRange(activities, start, end));
}

/** All activities bucketed into Vietnam-local calendar months ('YYYY-MM'), oldest first,
 * with sums (km/time/elevation) and averages of whichever physiological fields are present
 * on each activity (pace/HR/cadence/watts/speed/relative effort). Callers filter `activities`
 * by type first (e.g. only Run) to get type-specific trends out of one shared bucketing pass. */
export function monthlyBuckets(activities) {
  const map = new Map();
  for (const a of activities) {
    const vn = toVnDate(a.date);
    const key = `${vn.getUTCFullYear()}-${String(vn.getUTCMonth() + 1).padStart(2, '0')}`;
    if (!map.has(key)) {
      map.set(key, {
        month: key, km: 0, movingTimeSec: 0, elevationGain: 0, calories: 0, count: 0,
        paceSum: 0, paceCount: 0, hrSum: 0, hrCount: 0, cadSum: 0, cadCount: 0,
        wattsSum: 0, wattsCount: 0, speedSum: 0, speedCount: 0, effortSum: 0, effortCount: 0,
      });
    }
    const b = map.get(key);
    b.km += a.distanceKm || 0;
    b.movingTimeSec += a.movingTimeSec || 0;
    b.elevationGain += a.elevationGain || 0;
    b.calories += a.calories || 0;
    b.count += 1;
    if (a.paceMinPerKm) { b.paceSum += a.paceMinPerKm; b.paceCount++; }
    if (a.avgHeartRate) { b.hrSum += a.avgHeartRate; b.hrCount++; }
    if (a.avgCadence) { b.cadSum += a.avgCadence; b.cadCount++; }
    if (a.avgWatts) { b.wattsSum += a.avgWatts; b.wattsCount++; }
    if (a.speedKmh) { b.speedSum += a.speedKmh; b.speedCount++; }
    if (a.relativeEffort) { b.effortSum += a.relativeEffort; b.effortCount++; }
  }
  return [...map.values()]
    .sort((a, b) => a.month.localeCompare(b.month))
    .map((b) => ({
      month: b.month,
      km: b.km,
      movingTimeSec: b.movingTimeSec,
      elevationGain: b.elevationGain,
      calories: b.calories,
      count: b.count,
      avgPace: b.paceCount ? b.paceSum / b.paceCount : null,
      avgHeartRate: b.hrCount ? b.hrSum / b.hrCount : null,
      avgCadence: b.cadCount ? b.cadSum / b.cadCount : null,
      avgWatts: b.wattsCount ? b.wattsSum / b.wattsCount : null,
      avgSpeedKmh: b.speedCount ? b.speedSum / b.speedCount : null,
      avgEffort: b.effortCount ? b.effortSum / b.effortCount : null,
    }));
}

/** Continuous monthly buckets across ALL history ('YYYY-MM' key + numeric year, oldest first),
 * with a per-activity-type km/time/calories breakdown - source for the Stats page's monthly
 * volume combo chart, which shows one unbroken timeline rather than comparing years side by side
 * (contrast with yearlyTypeBreakdown below, which intentionally does compare years). The
 * per-type breakdown (not just an overall total) lets the chart recompute its time/calories
 * lines when a type is toggled off via the legend. Mirrors recentWeeklyBuckets's byType-Map-per-
 * bucket pattern, but monthly and unbounded (not clipped to a trailing window). */
export function monthlyTypeBuckets(activities) {
  const map = new Map();
  for (const a of activities) {
    const vn = toVnDate(a.date);
    const year = vn.getUTCFullYear();
    const key = `${year}-${String(vn.getUTCMonth() + 1).padStart(2, '0')}`;
    if (!map.has(key)) {
      map.set(key, { month: key, year, km: 0, movingTimeSec: 0, calories: 0, count: 0, byType: new Map() });
    }
    const b = map.get(key);
    b.km += a.distanceKm || 0;
    b.movingTimeSec += a.movingTimeSec || 0;
    b.calories += a.calories || 0;
    b.count += 1;
    if (!b.byType.has(a.type)) b.byType.set(a.type, { km: 0, movingTimeSec: 0, calories: 0 });
    const t = b.byType.get(a.type);
    t.km += a.distanceKm || 0;
    t.movingTimeSec += a.movingTimeSec || 0;
    t.calories += a.calories || 0;
  }
  return [...map.values()]
    .sort((a, b) => a.month.localeCompare(b.month))
    .map(({ byType, ...rest }) => ({ ...rest, types: [...byType.entries()].map(([type, v]) => ({ type, ...v })) }));
}

/** Continuous daily buckets across ALL history ('YYYY-MM-DD' key + numeric year, oldest first,
 * only days with at least one activity - same sparse-but-ordered convention as monthlyTypeBuckets
 * above), with a per-activity-type km/time/calories breakdown - the day-granularity option for
 * the Stats page's volume chart. */
export function dailyTypeBuckets(activities) {
  const map = new Map();
  for (const a of activities) {
    const vn = toVnDate(a.date);
    const year = vn.getUTCFullYear();
    const key = vn.toISOString().slice(0, 10);
    if (!map.has(key)) {
      map.set(key, { date: key, year, km: 0, movingTimeSec: 0, calories: 0, count: 0, byType: new Map() });
    }
    const b = map.get(key);
    b.km += a.distanceKm || 0;
    b.movingTimeSec += a.movingTimeSec || 0;
    b.calories += a.calories || 0;
    b.count += 1;
    if (!b.byType.has(a.type)) b.byType.set(a.type, { km: 0, movingTimeSec: 0, calories: 0 });
    const t = b.byType.get(a.type);
    t.km += a.distanceKm || 0;
    t.movingTimeSec += a.movingTimeSec || 0;
    t.calories += a.calories || 0;
  }
  return [...map.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(({ byType, ...rest }) => ({ ...rest, types: [...byType.entries()].map(([type, v]) => ({ type, ...v })) }));
}

/** Per Vietnam-local calendar year, totals broken down by activity type - for a stacked bar
 * comparing how the training mix (Run/Ride/Weight Training/...) shifted year to year. */
export function yearlyTypeBreakdown(activities) {
  const byYear = new Map();
  for (const a of activities) {
    const year = toVnDate(a.date).getUTCFullYear();
    if (!byYear.has(year)) byYear.set(year, new Map());
    const byType = byYear.get(year);
    if (!byType.has(a.type)) byType.set(a.type, { km: 0, movingTimeSec: 0, calories: 0, count: 0 });
    const b = byType.get(a.type);
    b.km += a.distanceKm || 0;
    b.movingTimeSec += a.movingTimeSec || 0;
    b.calories += a.calories || 0;
    b.count += 1;
  }
  return [...byYear.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([year, byType]) => ({
      year,
      types: [...byType.entries()].map(([type, v]) => ({ type, ...v })),
    }));
}

/** Activity types folded into each of the app's 5 goal-tracking groups - Crossfit has no
 * distance so its goal target is a duration (hours), not km (see goal-targets.json). Shared
 * with the Stats page's own per-type grouping (src/pages/stats.astro's STAT_GROUPS), which
 * groups the same way but keeps its own local copy since it also needs a metric ('km' vs
 * 'calories') per group that goal-tracking doesn't care about. */
export const GOAL_GROUPS = {
  Run: ['Run'],
  Ride: ['Ride'],
  Swim: ['Swim'],
  Walk: ['Walk'],
  Crossfit: ['Weight Training', 'Workout', 'Yoga'],
};

/** km + hours totals per goal group for a set of activities (already filtered to whatever
 * period the caller cares about). Both units are always computed; the caller picks whichever
 * one a given group's target is denominated in (goal-targets.json's `unit` field). */
export function goalGroupTotals(activities) {
  const out = {};
  for (const [label, types] of Object.entries(GOAL_GROUPS)) {
    const t = sumTotals(activities.filter((a) => types.includes(a.type)));
    out[label] = { km: t.km, hours: t.movingTimeSec / 3600 };
  }
  return out;
}

/** goalGroupTotals broken out per Vietnam-local calendar year, newest first - source for the
 * Goals page's annual progress table (one row per year). */
export function yearlyGoalTotals(activities) {
  const years = [...new Set(activities.map((a) => toVnDate(a.date).getUTCFullYear()))].sort((a, b) => b - a);
  return years.map((year) => ({
    year,
    groups: goalGroupTotals(inRange(activities, vnMidnightUtc(year, 0, 1), vnMidnightUtc(year + 1, 0, 1))),
  }));
}

/** One point per activity - real hour of day (0-23, fractional - e.g. 6.25 = 6:15) x day of
 * week (0=Monday..6=Sunday), both Vietnam wall-clock/calendar (GMT+7 fixed offset, no DST, so
 * toVnDate's shifted UTC getters already read as local) - for the habit scatter chart (hour x
 * weekday), same per-point-with-year principle as runHrPacePoints so both charts share one
 * visual language. Hour is left un-rounded so activities spread across the x-axis by their
 * actual start time instead of stacking into 24 rigid columns. */
export function habitScatterPoints(activities) {
  return activities.map((a) => {
    const vn = toVnDate(a.date);
    return {
      hour: vn.getUTCHours() + vn.getUTCMinutes() / 60,
      dow: (vn.getUTCDay() + 6) % 7,
      year: vn.getUTCFullYear(),
    };
  });
}

/** Per-activity points for the Stats page's Run/Ride metric-vs-time heatmap - one row per
 * activity of `type`, carrying its date plus every metric the heatmap's X-axis can bin on.
 * Binning (both the metric bins and the time buckets) happens client-side since the viewer
 * picks both axes interactively, so this just passes through the raw fields rather than
 * pre-aggregating like monthlyBuckets does. */
export function heatmapActivityPoints(activities, type) {
  return activities
    .filter((a) => a.type === type)
    .map((a) => ({
      date: a.date,
      distanceKm: a.distanceKm ?? null,
      paceMinPerKm: a.paceMinPerKm ?? null,
      speedKmh: a.speedKmh ?? null,
      avgHeartRate: a.avgHeartRate ?? null,
      avgWatts: a.avgWatts ?? null,
      avgCadence: a.avgCadence ?? null,
      elevationGain: a.elevationGain ?? null,
    }));
}

/** Daily activity volume (km) for the last `days` days, for a calendar heatmap. Buckets by
 * Vietnam-local calendar day so a run just after midnight GMT+7 lands on the right day. */
export function dailyHeatmap(activities, referenceDate, days = 371) {
  const vnRef = toVnDate(referenceDate);
  const now = vnMidnightUtc(vnRef.getUTCFullYear(), vnRef.getUTCMonth(), vnRef.getUTCDate());
  const start = new Date(now.getTime() - (days - 1) * 86400000);

  const byDay = new Map();
  for (const a of activities) {
    const d = new Date(a.date);
    if (d < start || d >= new Date(now.getTime() + 86400000)) continue;
    const day = toVnDate(a.date).toISOString().slice(0, 10);
    if (!byDay.has(day)) byDay.set(day, { date: day, km: 0, movingTimeSec: 0, count: 0 });
    const b = byDay.get(day);
    b.km += a.distanceKm || 0;
    b.movingTimeSec += a.movingTimeSec || 0;
    b.count += 1;
  }

  const out = [];
  for (let d = new Date(start); d <= now; d = new Date(d.getTime() + 86400000)) {
    const key = toVnDate(d).toISOString().slice(0, 10);
    out.push(byDay.get(key) || { date: key, km: 0, movingTimeSec: 0, count: 0 });
  }
  return out;
}

/** Activity types with a meaningful distance - the /calendar page's per-type dot tooltips show
 * km only for these (Crossfit-style activities have no distance, so folding them in would
 * understate or misrepresent "km"), while hours/calories still cover every activity type. */
export const CALENDAR_DISTANCE_TYPES = new Set(['Run', 'Ride', 'Swim', 'Walk']);

function emptyTotals() {
  return { km: 0, movingTimeSec: 0, calories: 0, count: 0 };
}

function addTotals(acc, a) {
  if (CALENDAR_DISTANCE_TYPES.has(a.type)) acc.km += a.distanceKm || 0;
  acc.movingTimeSec += a.movingTimeSec || 0;
  acc.calories += a.calories || 0;
  acc.count += 1;
}

function addTypeTotals(byType, a) {
  if (!byType.has(a.type)) byType.set(a.type, emptyTotals());
  addTotals(byType.get(a.type), a);
}

/** Nested year -> month(1-12) -> day(1-31) totals (Vietnam-local calendar, see CLAUDE.md's
 * timezone note) - source for the /calendar page's year -> month -> day drill-down grid. Each level
 * carries both `total` (combined { km, movingTimeSec, calories, count } across every type in the
 * period - written out as text in the cell) and `byType` (a Map<type, { km, movingTimeSec,
 * calories, count }>, one entry per activity type present - one colored dot per entry, so a day
 * with both a Run and a Ride gets two dots alongside the combined text). Returned as Maps: unlike
 * this module's other bucketing functions, this only ever runs client-side against the
 * already-fetched activities array, so there's no JSON-serialization boundary to flatten for. */
export function calendarTotals(activities) {
  const years = new Map();
  for (const a of activities) {
    const vn = toVnDate(a.date);
    const year = vn.getUTCFullYear();
    const month = vn.getUTCMonth() + 1;
    const day = vn.getUTCDate();
    if (!years.has(year)) years.set(year, { total: emptyTotals(), byType: new Map(), months: new Map() });
    const yearBucket = years.get(year);
    addTotals(yearBucket.total, a);
    addTypeTotals(yearBucket.byType, a);
    if (!yearBucket.months.has(month)) yearBucket.months.set(month, { total: emptyTotals(), byType: new Map(), days: new Map() });
    const monthBucket = yearBucket.months.get(month);
    addTotals(monthBucket.total, a);
    addTypeTotals(monthBucket.byType, a);
    if (!monthBucket.days.has(day)) monthBucket.days.set(day, { total: emptyTotals(), byType: new Map() });
    const dayBucket = monthBucket.days.get(day);
    addTotals(dayBucket.total, a);
    addTypeTotals(dayBucket.byType, a);
  }
  return years;
}
