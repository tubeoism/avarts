// EN/VI language toggle - persisted like units.js (unlike theme.js's time-of-day default, there's
// no sensible "recompute from current time" default for language, so it has to survive full page
// navigations, same reasoning as units.js's own top comment).
import { DEFAULT_LANG } from './preferences.js';

export { DEFAULT_LANG };

const LANG_KEY = 'lang';

export function currentLang() {
  const lang = document.documentElement.dataset.lang;
  return lang === 'en' || lang === 'vi' ? lang : DEFAULT_LANG;
}

function persist(lang) {
  try {
    localStorage.setItem(LANG_KEY, lang);
  } catch {
    // localStorage unavailable (private browsing, etc.) - toggle still works for this page view.
  }
}

export function toggleLang() {
  const next = currentLang() === 'en' ? 'vi' : 'en';
  document.documentElement.dataset.lang = next;
  document.documentElement.lang = next;
  persist(next);
  document.dispatchEvent(new CustomEvent('langchange', { detail: { lang: next } }));
  return next;
}

/** Calls `cb` immediately with the current language, then again whenever the toggle fires. */
export function onLangChange(cb) {
  cb(currentLang());
  document.addEventListener('langchange', (e) => cb(e.detail.lang));
}
