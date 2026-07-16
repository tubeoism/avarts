// Light/dark theme is never persisted (no localStorage/cookie) - every full page load
// (this app is a static multi-page Astro site, so every nav is a fresh load) recomputes
// the default from the current time. Vietnam has no DST, so a fixed +7h offset is exact
// (same reasoning as toVnDate() in format.js/scripts/etl/lib/tz.mjs).
import { DEFAULT_NIGHT_MODE } from './preferences.js';

const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

export function isDarkHours(date = new Date()) {
  const vnHour = new Date(date.getTime() + VN_OFFSET_MS).getUTCHours();
  return vnHour >= 19 || vnHour < 6;
}

/** Resolves the default theme for a fresh page load: 'dark'/'light' night-mode config forces a
 * fixed theme, 'auto' (the default) keeps the time-of-day formula above. Mirrored as raw JS in
 * Layout.astro's pre-paint bootstrap script (which can't import this module) - keep both in sync. */
export function computeDefaultTheme(date = new Date(), nightMode = DEFAULT_NIGHT_MODE) {
  if (nightMode === 'dark') return 'dark';
  if (nightMode === 'light') return 'light';
  return isDarkHours(date) ? 'dark' : 'light';
}

export function currentTheme() {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

/** Flips the in-memory theme for this page view only and notifies listeners (e.g. charts). */
export function toggleTheme() {
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  document.dispatchEvent(new CustomEvent('themechange', { detail: { theme: next } }));
  return next;
}

/** Reads the live M3 color tokens from CSS so canvas-based charts (Chart.js) can match the page theme. */
export function themeColors() {
  const style = getComputedStyle(document.documentElement);
  const v = (name) => style.getPropertyValue(name).trim();
  return {
    surface: v('--md-surface'),
    onSurface: v('--md-on-surface'),
    onSurfaceVariant: v('--md-on-surface-variant'),
    outlineVariant: v('--md-outline-variant'),
    primary: v('--md-primary'),
    secondary: v('--md-secondary'),
    tertiary: v('--md-tertiary'),
    error: v('--md-error'),
  };
}

/** Calls `cb` immediately with the current colors, then again whenever the toggle fires. */
export function onThemeChange(cb) {
  cb(themeColors());
  document.addEventListener('themechange', () => cb(themeColors()));
}
