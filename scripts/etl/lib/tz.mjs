const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

/**
 * Shifts a UTC instant by Vietnam's fixed +7:00 offset so that reading the result with the
 * UTC getters (getUTCFullYear/getUTCMonth/getUTCDate/getUTCDay) yields Vietnam's local calendar
 * fields. Used for day/week/month/year bucketing (dashboard totals, fitness load, goal periods)
 * so a run just after midnight GMT+7 doesn't get counted against the previous UTC day.
 */
export function toVnDate(iso) {
  return new Date(new Date(iso).getTime() + VN_OFFSET_MS);
}

/** Vietnam-local calendar day as "YYYY-MM-DD". */
export function vnDateKey(iso) {
  return toVnDate(iso).toISOString().slice(0, 10);
}

/** The real UTC instant of midnight GMT+7 on the given Vietnam-local calendar date
 * (month is 0-indexed, like Date.UTC - out-of-range values roll over correctly). */
export function vnMidnightUtc(year, month, day) {
  return new Date(Date.UTC(year, month, day) - VN_OFFSET_MS);
}

/** UTC offset (minutes) that `tz` observes at the instant `iso`. Mirrors src/lib/format.js's
 * copy (see CLAUDE.md note on the two separate module trees) since ETL scripts can't import
 * from src/. */
export function utcOffsetMinutes(iso, tz) {
  const date = new Date(iso);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(date).reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {});
  const asUTC = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return Math.round((asUTC - date.getTime()) / 60000);
}

/** Converts a timezone-less wall-clock string (e.g. Strava's `start_local`, "2026-07-05T06:12:39")
 * into the true UTC instant it represents in `tz`. Two passes handles DST-transition edge cases
 * (the offset at the naive guess may differ from the offset actually in effect). */
export function localToUtcIso(localIso, tz) {
  const naiveUtcMs = new Date(`${localIso}Z`).getTime();
  let guessMs = naiveUtcMs;
  for (let i = 0; i < 2; i++) {
    const offsetMin = utcOffsetMinutes(new Date(guessMs).toISOString(), tz);
    guessMs = naiveUtcMs - offsetMin * 60000;
  }
  return new Date(guessMs).toISOString();
}
