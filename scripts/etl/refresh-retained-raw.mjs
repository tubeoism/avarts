import fs from 'node:fs';
import path from 'node:path';
import { readCsv, writeCsv } from './lib/csv.mjs';
import { APP_DIR } from './lib/paths.mjs';

/*
 * Refreshes retained-raw/ (see CLAUDE.md "Kiến trúc" + "Quyền riêng tư") from a
 * directory holding a fresh Strava bulk export - used by the "Build from downloaded data"
 * GitHub Action after it runs the full ETL, so retained-raw/ stays in sync with whatever export
 * was just processed (same manual step CLAUDE.md's CSV quirks note describes doing by hand each
 * time a new export replaces retained-raw/, now scripted so the Action doesn't need it done by hand).
 *
 * Deliberately an ALLOWLIST copy, not "copy everything in sourceDir": a real Strava export ZIP
 * contains many files the ETL never reads and retained-raw/ has never kept (orders.csv,
 * logins.csv, messaging.json, media/, contacts.csv, ...). Copying only the exact set below means
 * retained-raw/ - the copy that stays in git long-term - can never end up wider than intended
 * even if a user drops the entire unfiltered export into download/. profile.csv is excluded on
 * purpose (see parse-profile.mjs) - it's the one ETL-consumed file with raw PII (email/name), so
 * it's never persisted to retained-raw/ even though the ETL run itself does read it once from
 * download/ to refresh profile.json.
 */

const CSV_FILES = ['activities.csv', 'shoes.csv', 'bikes.csv', 'components.csv', 'events.csv'];
// Strava's bulk export mixes gzip-compressed (.fit.gz) and plain uncompressed (.fit) raw files in
// the same activities/ folder (confirmed against real export contents) - both must be allowlisted
// or the uncompressed ones are silently dropped and can never be recomputed later.
const ACTIVITY_EXTENSIONS = ['.fit.gz', '.gpx.gz', '.tcx.gz', '.fit', '.gpx', '.tcx'];

// Real body-weight PII (see CLAUDE.md's CSV quirks note) - blanked in the retained-raw copy while
// keeping the column header/position intact so colIndexer() and the duplicate-column handling
// don't need to special-case a missing column. parse-activities.mjs never reads these fields anyway.
const WEIGHT_COLUMNS = ['Athlete Weight', 'Bike Weight'];

function scrubActivitiesCsv(sourcePath, destPath) {
  const { header, data } = readCsv(sourcePath);
  const blankIndexes = new Set();
  header.forEach((name, i) => {
    if (WEIGHT_COLUMNS.includes(name)) blankIndexes.add(i);
  });
  if (blankIndexes.size < WEIGHT_COLUMNS.length) {
    console.error(
      `[refresh-retained-raw] ERROR: expected columns ${WEIGHT_COLUMNS.join(', ')} in activities.csv, ` +
        `only matched ${blankIndexes.size} - refusing to write unscrubbed data (PII risk)`
    );
    process.exit(1);
  }
  const scrubbed = data.map((row) => row.map((v, i) => (blankIndexes.has(i) ? '' : v)));
  writeCsv(destPath, header, scrubbed);
  console.log(`[refresh-retained-raw] scrubbed ${blankIndexes.size} weight column(s) in activities.csv (${scrubbed.length} rows)`);
}

function main() {
  const downloadDir = path.resolve(process.argv[2] ?? path.join(APP_DIR, 'download'));
  const retainedRawDir = path.join(APP_DIR, 'retained-raw');

  for (const file of CSV_FILES) {
    const sourcePath = path.join(downloadDir, file);
    if (!fs.existsSync(sourcePath)) {
      console.error(`[refresh-retained-raw] missing ${file} in ${downloadDir} - not touching retained-raw/`);
      process.exit(1);
    }
  }

  fs.mkdirSync(retainedRawDir, { recursive: true });

  for (const file of CSV_FILES) {
    const sourcePath = path.join(downloadDir, file);
    const destPath = path.join(retainedRawDir, file);
    if (file === 'activities.csv') {
      scrubActivitiesCsv(sourcePath, destPath);
    } else {
      fs.copyFileSync(sourcePath, destPath);
    }
  }

  const sourceActivitiesDir = path.join(downloadDir, 'activities');
  const destActivitiesDir = path.join(retainedRawDir, 'activities');

  let copiedCount = 0;
  if (fs.existsSync(sourceActivitiesDir)) {
    // Only wipe the destination once we know there's a source to repopulate it from - retained-raw/
    // is the durable full-resolution GPS backup this whole architecture depends on (see "Kiến trúc
    // tổng quan"), so an incomplete download/ (e.g. missing the activities/ subfolder) must never
    // leave it emptied with nothing to replace it.
    fs.rmSync(destActivitiesDir, { recursive: true, force: true });
    fs.mkdirSync(destActivitiesDir, { recursive: true });
    for (const entry of fs.readdirSync(sourceActivitiesDir)) {
      if (!ACTIVITY_EXTENSIONS.some((ext) => entry.endsWith(ext))) continue;
      fs.copyFileSync(path.join(sourceActivitiesDir, entry), path.join(destActivitiesDir, entry));
      copiedCount++;
    }
  } else {
    console.error(
      `[refresh-retained-raw] WARNING: ${sourceActivitiesDir} not found - leaving existing retained-raw/activities/ untouched`
    );
  }

  console.log(`[refresh-retained-raw] copied ${CSV_FILES.length} CSV file(s) and ${copiedCount} activity stream file(s) into retained-raw/`);
  console.log('[refresh-retained-raw] profile.csv intentionally NOT copied (PII - see parse-profile.mjs)');
}

main();
