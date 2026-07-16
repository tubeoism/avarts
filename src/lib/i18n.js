// Dictionary + translate helpers for the EN/VI language toggle. Pure logic only - no string
// content lives in this file; every namespace is its own JSON file under src/i18n/<lang>/<ns>.json
// (one file per page/concern, e.g. src/i18n/vi/gear.json + src/i18n/en/gear.json), loaded here via
// Vite's import.meta.glob so adding a namespace (a new page) or a whole new language is a
// data-only change - no edits to this file. Splitting per-namespace (rather than one big JSON per
// language) also means the many pages of this migration never edit the same file, and a human or
// LLM translator can be handed exactly one file at a time.
import { currentLang, DEFAULT_LANG } from './lang.js';

export { DEFAULT_LANG };

const viModules = import.meta.glob('../i18n/vi/*.json', { eager: true, import: 'default' });
const enModules = import.meta.glob('../i18n/en/*.json', { eager: true, import: 'default' });

function buildLocale(modules) {
  const locale = {};
  for (const path in modules) {
    const name = path.match(/([^/]+)\.json$/)[1];
    locale[name] = modules[path];
  }
  return locale;
}

const dict = { vi: buildLocale(viModules), en: buildLocale(enModules) };

function get(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

/** `key` is a dot-path, first segment = namespace = JSON filename (e.g. "gear.title" ->
 * src/i18n/<lang>/gear.json's `title` key). `vars`, if given, fills `{name}` placeholders in the
 * looked-up string with already-formatted display values (dates/numbers stay format.js's job -
 * this function never formats anything itself). Falls back to DEFAULT_LANG, then to the raw key
 * (with a console.warn) so a missed migration is loud and visible instead of a blank string. */
export function t(lang, key, vars) {
  let str = get(dict[lang], key);
  if (str === undefined) str = get(dict[DEFAULT_LANG], key);
  if (str === undefined) {
    console.warn(`[i18n] missing key "${key}"`);
    return key;
  }
  if (!vars) return str;
  return str.replace(/\{(\w+)\}/g, (_, name) => (vars[name] ?? ''));
}

export function activityTypeLabel(lang, type) {
  return t(lang, `activityType.${type}`);
}

export function goalGroupLabel(lang, group) {
  return group === 'Crossfit' ? t(lang, 'goalGroup.crossfit') : activityTypeLabel(lang, group);
}

/** Repaint pass for the handful of things that CAN'T use the zero-flash <T> component (see
 * src/components/T.astro): `<option>` text (2 dropdowns in performance.astro/stats.astro - HTML
 * doesn't reliably support child elements inside <option>, so those still carry a plain
 * `data-i18n="key"` + optional `data-i18n-vars` and get textContent rewritten here), plus
 * attributes that can't hold sibling nodes - `data-i18n-aria-label` / `data-i18n-placeholder` /
 * `data-i18n-title`, and `<title data-i18n-page="key">` (composes a translated value with the
 * fixed "· Avarts Analytics" brand suffix). None of these cause a *visible* page-content flash
 * (option text is hidden inside a closed dropdown at load time, aria-label is non-visual, tab
 * title is barely noticed), so the post-load repaint here is an accepted tradeoff, not a bug.
 * Wired globally in Layout.astro so every page gets this for free. Re-scans the live DOM on every
 * call, so nodes added later are picked up too, no registration step required. */
export function repaintLangNodes(lang = currentLang()) {
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const vars = el.dataset.i18nVars ? JSON.parse(el.dataset.i18nVars) : undefined;
    el.textContent = t(lang, el.dataset.i18n, vars);
  });
  document.querySelectorAll('[data-i18n-aria-label]').forEach((el) => el.setAttribute('aria-label', t(lang, el.dataset.i18nAriaLabel)));
  document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => el.setAttribute('placeholder', t(lang, el.dataset.i18nPlaceholder)));
  document.querySelectorAll('[data-i18n-title]').forEach((el) => el.setAttribute('title', t(lang, el.dataset.i18nTitle)));
  const titleEl = document.querySelector('title[data-i18n-page]');
  if (titleEl) titleEl.textContent = `${t(lang, titleEl.dataset.i18nPage)} · Avarts Analytics`;
}
