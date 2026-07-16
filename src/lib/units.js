// Imperial/Metric toggle - persisted (unlike theme.js's time-of-day default, there's no sensible
// default to recompute per page load) so it survives full page navigations (this app is a static
// multi-page Astro site, so every nav is a fresh load - see theme.js's own note on this). Distance/
// pace/speed convert; elevation and calories never do (product decision - meters and Calories stay
// the same in both systems).
import { formatDistance, formatPace, formatSpeed } from './format.js';
import { DEFAULT_UNIT_SYSTEM } from './preferences.js';

const UNITS_KEY = 'unit-system';

export function currentUnitSystem() {
  const system = document.documentElement.dataset.units;
  return system === 'imperial' || system === 'metric' ? system : DEFAULT_UNIT_SYSTEM;
}

function persist(system) {
  try {
    localStorage.setItem(UNITS_KEY, system);
  } catch {
    // localStorage unavailable (private browsing, etc.) - toggle still works for this page view.
  }
}

export function toggleUnitSystem() {
  const next = currentUnitSystem() === 'imperial' ? 'metric' : 'imperial';
  document.documentElement.dataset.units = next;
  persist(next);
  document.dispatchEvent(new CustomEvent('unitschange', { detail: { system: next } }));
  return next;
}

/** Calls `cb` immediately with the current unit system, then again whenever the toggle fires. */
export function onUnitsChange(cb) {
  cb(currentUnitSystem());
  document.addEventListener('unitschange', (e) => cb(e.detail.system));
}

const KIND_FORMATTERS = {
  distance: (raw, system, digits) => formatDistance(Number(raw), system, digits === undefined ? undefined : Number(digits)),
  pace: (raw, system) => formatPace(Number(raw), system),
  speed: (raw, system, digits) => formatSpeed(Number(raw), system, digits === undefined ? undefined : Number(digits)),
};

/** Generic repaint pass for build-time-rendered (static Astro frontmatter) numbers: any element
 * tagged `data-unit="distance|pace|speed" data-value="<raw metric number>"` (optionally
 * `data-digits`) gets its text content reformatted for the current unit system. Wired globally in
 * Layout.astro so every page gets this for free without per-page script wiring. Pages that already
 * rebuild their own DOM from an in-memory array (log/calendar/activities list, Chart.js canvases)
 * handle their own reformatting instead, since they can just re-run their existing render pass. */
export function repaintUnitNodes(system = currentUnitSystem()) {
  document.querySelectorAll('[data-unit]').forEach((el) => {
    const kind = el.dataset.unit;
    const fmt = KIND_FORMATTERS[kind];
    if (!fmt || el.dataset.value === undefined || el.dataset.value === '') return;
    el.textContent = fmt(el.dataset.value, system, el.dataset.digits);
  });
}
