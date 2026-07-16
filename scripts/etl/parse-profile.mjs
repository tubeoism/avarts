import fs from 'node:fs';
import { readCsv, colIndexer, toStr } from './lib/csv.mjs';
import { srcPath, writeJsonBoth } from './lib/paths.mjs';

// Deliberately excludes Athlete ID / Email / First Name / Last Name / Weight - only
// location + timezone context is needed for display, nothing personally identifying.
//
// profile.csv is the one ETL-consumed file NEVER committed to retained-raw/ (it's the only one
// with raw PII - see CLAUDE.md "Quyền riêng tư"), so an environment running the ETL against
// retained-raw/ (no real Strava export on disk) won't have it. Skip gracefully instead of
// crashing the whole pipeline - profile.json changes rarely, so leaving the already-committed one
// untouched is the right behavior, not an error.
export function parseProfile() {
  const csvPath = srcPath('profile.csv');
  if (!fs.existsSync(csvPath)) {
    console.log('[profile] profile.csv not found (expected when running against retained-raw/, see CLAUDE.md) - skipping, public/data/profile.json left as-is');
    return undefined;
  }
  const { header, data } = readCsv(csvPath);
  const idx = colIndexer(header);
  const row = data[0] ?? [];

  const profile = {
    city: toStr(row[idx.first('City')]),
    state: toStr(row[idx.first('State')]),
    country: toStr(row[idx.first('Country')]),
    utcOffset: '+07:00',
  };

  writeJsonBoth('profile.json', profile);
  console.log('[profile] wrote location context:', profile);
  return profile;
}
