import fs from 'node:fs';
import path from 'node:path';
import { APP_DIR, DATA_DIR, STREAMS_DIR, SRC_DATA_DIR } from './lib/paths.mjs';

/*
 * Deletes ALL generated activity data so the next sync/build starts from a completely clean
 * slate - used by the "Wipe data" GitHub Action (.github/workflows/wipe-data.yml). Reproduces as
 * a repeatable script what used to be a manual one-off cleanup (see CLAUDE.md's Gear catalog
 * note).
 *
 * Removes:
 *  - every public/data/*.json file (activities/gear/records/best-efforts/events/fitness/profile -
 *    the "core" set writeJsonBoth() writes - plus routes.json/heatgrid.json, which only ever exist
 *    in public/data/)
 *  - public/data/streams/ (per-activity GPS/HR/cadence/power streams) entirely
 *  - the src/data/*.json symlinks pointing at the files above
 *  - retained-raw/ (raw CSV/FIT export kept in git for full-resolution recompute - see CLAUDE.md
 *    "Kiến trúc"), if present
 *
 * Deliberately leaves alone:
 *  - src/data/goal-targets.json - a real hand-maintained file, not ETL output (see CLAUDE.md's
 *    Goal system note)
 *  - download/ - unrelated, that's where a *new* export gets dropped in after this runs
 *  - scripts/etl/api/backfill-state.json - already ships done:true; run-api-sync.mjs auto-detects
 *    the cold start once activities.json is gone and backfills from scratch on its own (see its
 *    `coldStart` check), so there is nothing to reset here
 *
 * `--keep-retained-raw` skips the retained-raw/ deletion - used by the "Restore from retained
 * raw" GitHub Action, which needs generated data wiped but retained-raw/ itself left in place
 * (it's the source the subsequent ETL run reads from, not something being replaced this time).
 * It also implies keeping public/data/profile.json (+ its src/data/ symlink): retained-raw/
 * deliberately never has profile.csv (the one ETL-consumed file with raw PII, see "Quyền riêng
 * tư"), so parseProfile() can't regenerate it from retained-raw/ alone - deleting it here would
 * leave data.mjs's build-time `import` of profile.json unresolvable with no way for a
 * retained-raw-only ETL run to fix it (confirmed by actually hitting this build failure while
 * testing the Restore action). A plain full wipe (no flag) still deletes it as documented above,
 * since that path is normally followed by a real download/ export that DOES have profile.csv.
 */

const KEEP_SRC_DATA = new Set(['goal-targets.json']);
const keepRetainedRaw = process.argv.includes('--keep-retained-raw');
if (keepRetainedRaw) KEEP_SRC_DATA.add('profile.json');
const KEEP_DATA = keepRetainedRaw ? new Set(['profile.json']) : new Set();

function listEntries(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir);
}

function main() {
  let removed = 0;

  // public/data/*.json - filtering by extension naturally skips the streams/ directory (handled
  // separately below), no need to stat each entry to tell files from directories.
  for (const entry of listEntries(DATA_DIR)) {
    if (KEEP_DATA.has(entry) || !entry.endsWith('.json')) continue;
    fs.rmSync(path.join(DATA_DIR, entry), { force: true });
    removed++;
  }

  if (fs.existsSync(STREAMS_DIR)) {
    fs.rmSync(STREAMS_DIR, { recursive: true, force: true });
    removed++;
  }

  // src/data/*.json symlinks. rmSync on a symlink path removes the link itself (not its target),
  // so this works even though the targets above are already gone by this point.
  for (const entry of listEntries(SRC_DATA_DIR)) {
    if (KEEP_SRC_DATA.has(entry) || !entry.endsWith('.json')) continue;
    fs.rmSync(path.join(SRC_DATA_DIR, entry), { force: true });
    removed++;
  }

  const retainedRawDir = path.join(APP_DIR, 'retained-raw');
  if (!keepRetainedRaw && fs.existsSync(retainedRawDir)) {
    fs.rmSync(retainedRawDir, { recursive: true, force: true });
    removed++;
  }

  console.log(
    `[wipe-data] removed ${removed} top-level entr${removed === 1 ? 'y' : 'ies'}: public/data/*.json${keepRetainedRaw ? ' (except profile.json)' : ''}, public/data/streams/, src/data/*.json symlinks${keepRetainedRaw ? '' : ', retained-raw/'}`,
  );
  console.log(
    `[wipe-data] kept as-is: src/data/goal-targets.json, download/, scripts/etl/api/backfill-state.json${keepRetainedRaw ? ', retained-raw/ + public/data/profile.json (--keep-retained-raw)' : ''}`,
  );
}

main();
