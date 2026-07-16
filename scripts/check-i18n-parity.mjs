// Fails loudly if src/i18n/vi/<ns>.json and src/i18n/en/<ns>.json ever drift - either a namespace
// file exists in one language but not the other, or a key inside a shared namespace is missing on
// one side. Catches a missed translation at build time instead of only at runtime (i18n.js's t()
// falls back to DEFAULT_LANG + a console.warn, but that only fires if someone actually visits the
// page in devtools - this script is the "make sure nobody has to" check). Run via `npm run build`.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VI_DIR = path.join(__dirname, '..', 'src', 'i18n', 'vi');
const EN_DIR = path.join(__dirname, '..', 'src', 'i18n', 'en');

function flatten(obj, prefix = '') {
  const keys = [];
  for (const [k, v] of Object.entries(obj)) {
    const full = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) keys.push(...flatten(v, full));
    else keys.push(full);
  }
  return keys;
}

function jsonFiles(dir) {
  return new Set(readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, '')));
}

const viFiles = jsonFiles(VI_DIR);
const enFiles = jsonFiles(EN_DIR);
let ok = true;

for (const ns of viFiles) {
  if (!enFiles.has(ns)) {
    console.error(`[i18n-parity] namespace "${ns}" exists in vi/ but not en/`);
    ok = false;
  }
}
for (const ns of enFiles) {
  if (!viFiles.has(ns)) {
    console.error(`[i18n-parity] namespace "${ns}" exists in en/ but not vi/`);
    ok = false;
  }
}

for (const ns of [...viFiles].filter((n) => enFiles.has(n))) {
  const vi = JSON.parse(readFileSync(path.join(VI_DIR, `${ns}.json`), 'utf8'));
  const en = JSON.parse(readFileSync(path.join(EN_DIR, `${ns}.json`), 'utf8'));
  const viKeys = new Set(flatten(vi));
  const enKeys = new Set(flatten(en));
  for (const k of viKeys) {
    if (!enKeys.has(k)) {
      console.error(`[i18n-parity] "${ns}.${k}" exists in vi/${ns}.json but not en/${ns}.json`);
      ok = false;
    }
  }
  for (const k of enKeys) {
    if (!viKeys.has(k)) {
      console.error(`[i18n-parity] "${ns}.${k}" exists in en/${ns}.json but not vi/${ns}.json`);
      ok = false;
    }
  }
}

if (!ok) {
  console.error(`[i18n-parity] FAILED - fix the mismatches above.`);
  process.exit(1);
}
console.log(`[i18n-parity] OK - ${viFiles.size} namespace(s), vi/en in sync.`);
