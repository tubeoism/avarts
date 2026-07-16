// Single hand-edited JSON file (src/config/preferences.json) that lets a personal deployment
// override the app's default language/unit-system/night-mode without touching code. Read once at
// build time and re-exported as the internal-vocabulary constants each consumer already expects
// (lang.js/units.js/format.js/theme.js/Layout.astro), so every baked-in default stays in sync
// from one source instead of being hand-duplicated per-file (the exact bug class CLAUDE.md's
// ETL gotchas repeatedly warn about for other "two places, keep in sync" situations).
import preferences from '../config/preferences.json';

export const DEFAULT_LANG = preferences.language === 'eng' ? 'en' : 'vi';
export const DEFAULT_UNIT_SYSTEM = preferences.units === 'mi' ? 'imperial' : 'metric';
export const DEFAULT_NIGHT_MODE = ['auto', 'dark', 'light'].includes(preferences.nightMode) ? preferences.nightMode : 'auto';
