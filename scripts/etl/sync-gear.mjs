import fs from 'node:fs';
import { SRC_DATA_DIR, writeJsonBoth } from './lib/paths.mjs';
import { mergeGearCatalog } from './lib/gear.mjs';

/*
 * Merges a raw gear list handed to it by whichever caller resolved it into the EXISTING
 * gear.json (read first, never wiped), then recomputes totals from activities.json. Shared merge
 * step for both live-Strava gear sources, mirroring how sync-strava.mjs is the shared merge step
 * for both activity-sync sources (the nightly Claude Code / Strava MCP routine and the GitHub
 * Actions REST API pipeline) - whichever source resolves the raw data, the actual catalog-merging/
 * total-recomputing logic lives in exactly one place so the two can't drift.
 *
 * Deliberately additive-only (see CLAUDE.md's Gear catalog note): existing entries are updated in
 * place (retired/brand/model/label/kind/kmThreshold refreshed from the fresher source) or new
 * ones are inserted, but an entry already in gear.json that's absent from this run's `rawGear` is
 * always kept. This matters because `GET /athlete` (the REST API pipeline's source, via
 * api/fetch-gear.mjs) does not list retired gear, and the MCP `get_gear` tool result could in
 * principle have the same gap - a full replace here would silently delete retired/missing-from-
 * live entries on every sync run, which is exactly the bug this script used to have. Full,
 * authoritative catalog replacement still happens - by design - but only through the CSV pipeline
 * (parse-gear.mjs, reached via `run.mjs` / "Build from download" / "Restore from retained raw"),
 * i.e. only when a human explicitly wipes/rebuilds from a real export.
 *
 * Input (argv[2]): a JSON file holding an array of raw gear items shaped like:
 * { id, type: 'bike' | 'shoe', name, brand, model, retired }
 * - id: Strava's gear id. Not used by the catalog builder itself, kept for logging/debugging.
 * - name: for bikes, the nickname (used as both `key` and, absent a BIKE_LABELS override,
 *   `label`) - Strava's own "Activity Gear" field on an activity stores this same nickname for
 *   bikes, not "<brand> <model>" (see CLAUDE.md's CSV quirks note on gear naming). For shoes, the
 *   nickname if the caller has one available (see field mapping below) - shoeKey() (lib/gear.mjs)
 *   appends it to "<brand> <model>" when non-blank, matching Strava's "Activity Gear" convention
 *   for shoes with a nickname set. Blank/absent is fine either way.
 * - brand/model: shoe brand/model, combined via shoeKey() into the catalog key. Optional extra
 *   info for bikes.
 * - retired: Strava's own retired flag - authoritative, no per-item hardcoding needed here (unlike
 *   parse-gear.mjs's RETIRED_SHOE_KEYS, a fallback forced by the CSV export having no such column).
 *
 * Exact field mapping from each live source into this shape:
 * - REST API (api/fetch-gear.mjs): DetailedGear via GET /gear/{id} -> { id, type, name:
 *   detail.name (bike nickname, or a shoe's nickname if Strava's API name field carries one -
 *   confirmed by production traffic), brand: brand_name, model: model_name, retired }.
 * - MCP `get_gear` tool: bikes -> { id: gear_id.id, type: 'bike', name, retired }; shoes ->
 *   { id: gear_id.id, type: 'shoe', brand, model: model_name, retired } (no `name`/nickname
 *   passed through for shoes by the current trigger prompt - see CLAUDE.md's nightly MCP sync
 *   note: the live routine prompt still needs a manual update to match the design doc, which now
 *   also includes passing the shoe nickname through once available).
 */

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function main() {
  const inputPath = process.argv[2];
  if (!inputPath) {
    console.error('usage: node sync-gear.mjs <path-to-input.json>');
    process.exit(1);
  }
  const rawGear = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  const activities = readJson(`${SRC_DATA_DIR}/activities.json`, []);
  const existing = readJson(`${SRC_DATA_DIR}/gear.json`, []);

  const items = mergeGearCatalog(existing, rawGear, activities);
  writeJsonBoth('gear.json', items);

  const bikeCount = items.filter((i) => i.kind === 'bike').length;
  console.log(`[sync-gear] wrote ${items.length} gear items (${bikeCount} bikes, ${items.length - bikeCount} shoes)`);
}

main();
