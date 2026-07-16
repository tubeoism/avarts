// Most activities happened in Vietnam (GMT+7), but a handful were recorded abroad (e.g. a trip to
// Myanmar) - each activity carries its own GPS-derived IANA zone (see scripts/etl/parse-streams.mjs),
// falling back to Vietnam's zone when there's no GPS fix (indoor activities). Dates get formatted at
// build time (on Cloudflare's build server, likely UTC) and at runtime in the browser (whatever the
// visitor's local TZ is) - pinning an explicit zone per activity keeps the displayed time correct either way.
import { DEFAULT_UNIT_SYSTEM } from './preferences.js';

export const DISPLAY_TZ = 'Asia/Ho_Chi_Minh';

const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

/** Shifts a UTC instant by Vietnam's fixed +7:00 offset so its UTC getters
 * (getUTCFullYear/getUTCMonth/getUTCDate/getUTCDay) read as Vietnam-local calendar fields.
 * Used for day/week/month/year bucketing (weekly chart, calendar heatmap, dashboard totals). */
export function toVnDate(iso) {
  return new Date(new Date(iso).getTime() + VN_OFFSET_MS);
}

/** The real UTC instant of midnight GMT+7 on the given Vietnam-local calendar date
 * (month is 0-indexed, like Date.UTC - out-of-range values roll over correctly). */
export function vnMidnightUtc(year, month, day) {
  return new Date(Date.UTC(year, month, day) - VN_OFFSET_MS);
}

const dateFmtCache = new Map();
const timeFmtCache = new Map();

function getDateFmt(tz) {
  if (!dateFmtCache.has(tz)) {
    dateFmtCache.set(tz, new Intl.DateTimeFormat('en-GB', { timeZone: tz, day: '2-digit', month: '2-digit', year: 'numeric' }));
  }
  return dateFmtCache.get(tz);
}

function getTimeFmt(tz) {
  if (!timeFmtCache.has(tz)) {
    timeFmtCache.set(tz, new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }));
  }
  return timeFmtCache.get(tz);
}

export function formatDate(iso, tz = DISPLAY_TZ) {
  if (!iso) return '';
  return getDateFmt(tz).format(new Date(iso));
}

export function formatDateTime(iso, tz = DISPLAY_TZ) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${getDateFmt(tz).format(d)} ${getTimeFmt(tz).format(d)}`;
}

/** Returns { year, month } (month = 1-12) for the activity's date, in its own local time - used for month/year filtering. */
export function dateParts(iso, tz = DISPLAY_TZ) {
  const [dd, mm, yyyy] = formatDate(iso, tz).split('/');
  return { year: Number(yyyy), month: Number(mm) };
}

/**
 * UTC offset (in minutes) of `tz` at the given instant. Used to detect a genuinely different
 * timezone rather than comparing IANA zone name strings - geo-tz's dataset merges zones that
 * share identical rules (e.g. it returns "Asia/Jakarta" rather than "Asia/Ho_Chi_Minh" for
 * Hanoi), so two different zone names can still mean the exact same wall-clock time.
 */
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

/** Whether `tz` observes a different UTC offset than Vietnam at the given instant. */
export function isForeignTimezone(iso, tz) {
  if (!tz || tz === DISPLAY_TZ) return false;
  return utcOffsetMinutes(iso, tz) !== utcOffsetMinutes(iso, DISPLAY_TZ);
}

export function formatDuration(totalSec) {
  if (totalSec === undefined || totalSec === null) return '-';
  const sec = Math.round(totalSec);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// 1 mile in km (exact, per international definition) - the single conversion constant shared by
// every distance/pace/speed display so the Imperial/Metric toggle (see lib/units.js) converts
// consistently everywhere. Elevation is intentionally NEVER converted (stays meters in both unit
// systems, per product decision - there's no "imperial elevation" toggle).
export const KM_PER_MILE = 1.609344;

export function toMiles(km) {
  return km / KM_PER_MILE;
}

// Default parameter (not a hardcoded literal) so every call site that omits `system` - the vast
// majority, including build-time Astro frontmatter - automatically bakes the configured unit
// system (src/config/preferences.json) instead of always assuming metric.
export function formatPace(minPerKm, system = DEFAULT_UNIT_SYSTEM) {
  if (!minPerKm || !Number.isFinite(minPerKm)) return '-';
  const perUnit = system === 'imperial' ? minPerKm * KM_PER_MILE : minPerKm;
  const totalSec = Math.round(perUnit * 60);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, '0')}/${system === 'imperial' ? 'mi' : 'km'}`;
}

export function formatDistance(km, system = DEFAULT_UNIT_SYSTEM, digits = 2) {
  if (km === undefined || km === null) return '-';
  if (system === 'imperial') return `${toMiles(km).toFixed(digits)} mi`;
  return `${km.toFixed(digits)} km`;
}

export function formatSpeed(kmh, system = DEFAULT_UNIT_SYSTEM, digits = 1) {
  if (!kmh || !Number.isFinite(kmh)) return '-';
  if (system === 'imperial') return `${toMiles(kmh).toFixed(digits)} mph`;
  return `${kmh.toFixed(digits)} km/h`;
}

export function formatNumber(n, digits = 0) {
  if (n === undefined || n === null) return '-';
  return n.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

// Darkened from Strava's original brand hues so white badge text clears WCAG AA
// (4.5:1) against every fill - the originals (e.g. #fc4c02, #0ea5e9) only hit ~2.8-3.7:1.
export const ACTIVITY_COLORS = {
  Run: '#d44002',
  Walk: '#5a7c7d',
  Ride: '#1878cd',
  'Weight Training': '#8e44ad',
  Workout: '#b25e14',
  Yoga: '#12856f',
  Swim: '#0b7caf',
};

export function activityColor(type) {
  return ACTIVITY_COLORS[type] || '#767676';
}
