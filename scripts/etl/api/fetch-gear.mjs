import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { StravaClient, RateLimitStopError } from './strava-client.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SYNC_GEAR_SCRIPT = path.resolve(__dirname, '../sync-gear.mjs');

/*
 * Network-only half of the REST API pipeline's gear sync: authenticates, calls GET /athlete (this
 * athlete's full bike/shoe id list - independent of activity history, so brand-new gear that
 * hasn't appeared on any synced activity yet is still picked up) then one GET /gear/{id} per item
 * (DetailedGear - has brand_name/model_name/retired, which the SummaryGear shape embedded in
 * /athlete doesn't carry), builds the raw-gear array scripts/etl/sync-gear.mjs expects, and hands
 * off to it - unmodified - for the actual catalog build + write. Mirrors exactly how
 * run-api-sync.mjs fetches raw activities and hands off to sync-strava.mjs.
 *
 * ~1 + N calls total (N = the athlete's gear count) regardless of how many thousands of
 * activities exist - cheap enough to run in full on every scheduled sync. See CLAUDE.md's
 * Gear catalog and Sport type notes.
 */

async function main() {
  const clientId = process.env.STRAVA_CLIENT_ID;
  const clientSecret = process.env.STRAVA_CLIENT_SECRET;
  const refreshToken = process.env.STRAVA_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) {
    console.error('[fetch-gear] missing STRAVA_CLIENT_ID/STRAVA_CLIENT_SECRET/STRAVA_REFRESH_TOKEN');
    process.exit(1);
  }

  const client = new StravaClient({ clientId, clientSecret, refreshToken });
  await client.authenticate();

  const athlete = await client.getAthlete();
  const summaries = [
    ...(athlete.bikes || []).map((g) => ({ id: g.id, type: 'bike' })),
    ...(athlete.shoes || []).map((g) => ({ id: g.id, type: 'shoe' })),
  ];

  const rawGear = [];
  for (const { id, type } of summaries) {
    const detail = await client.getGearDetail(id);
    rawGear.push({
      id,
      type,
      name: detail.name,
      brand: detail.brand_name,
      model: detail.model_name,
      retired: detail.retired,
    });
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'strava-gear-sync-'));
  const tmpFile = path.join(tmpDir, 'gear.json');
  fs.writeFileSync(tmpFile, JSON.stringify(rawGear));

  execFileSync('node', [SYNC_GEAR_SCRIPT, tmpFile], { stdio: 'inherit' });
}

main().catch((err) => {
  // A real Strava rate-limit stop here just means "try again next scheduled run" - sync-gear.mjs
  // never even gets invoked, so gear.json is left untouched, not a hard failure. Anything else
  // (auth/network) should surface loudly like the rest of the pipeline.
  if (err instanceof RateLimitStopError) {
    console.warn(`[fetch-gear] stopped early: ${err.message} - gear.json left unchanged, will retry next run`);
    process.exit(0);
  }
  console.error(err);
  process.exit(1);
});
