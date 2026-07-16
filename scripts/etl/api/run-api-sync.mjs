import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { StravaClient, RateLimitStopError } from './strava-client.mjs';
import { buildSyncInputActivity } from './build-sync-input.mjs';
import { readBackfillState, writeBackfillState } from './backfill-state.mjs';
import { SRC_DATA_DIR } from '../lib/paths.mjs';

/*
 * Backup sync path for when the Claude Code / Strava MCP nightly routine isn't available: calls
 * the Strava REST API directly (OAuth refresh token flow), builds the same raw-activity JSON
 * shape sync-strava.mjs already expects (see the schema comment atop that file), and hands off to
 * it unmodified for all the merge/write logic (records, best-efforts, splits, routes, heatgrid,
 * gear km, fitness).
 *
 * Two passes, both optional depending on SYNC_MODE (env var: 'auto' | 'forward-only' | 'backfill',
 * default 'auto'):
 *  - forward: catches up activities newer than the latest one already in activities.json. Runs
 *    every time except when explicitly in 'backfill' mode.
 *  - backfill: walks activity history backward (newest-first, via a persisted `before` cursor in
 *    backfill-state.json) a bounded batch at a time, for the case where activities.json doesn't
 *    have full history to begin with (e.g. it was ever lost, or this pipeline is bootstrapped on
 *    a fork with no bulk-export data). Auto-activates only when activities.json is empty; a no-op
 *    otherwise (backfill-state.json ships with done:true).
 *
 * Every Strava read call is routed through StravaClient, which stops (RateLimitStopError) once a
 * conservative per-run call budget or the observed daily-usage header nears Strava's cap, rather
 * than sleeping mid-run - whatever wasn't fetched this run is simply picked up on the next
 * scheduled/manual run.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SYNC_STRAVA_SCRIPT = path.resolve(__dirname, '../sync-strava.mjs');

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`[run-api-sync] missing required env var ${name}`);
    process.exit(1);
  }
  return value;
}

/** Fetches detail + streams for one activity id and resolves its gear key. Returns the raw
 * object shaped for sync-strava.mjs. A 404 on the streams call means the activity genuinely has
 * no stream data (e.g. a manual entry) rather than an error - treated as streams: null. */
async function fetchActivity(client, id) {
  const detail = await client.getActivityDetail(id);
  const streamsRaw = await client.getActivityStreams(id).catch((err) => {
    if (err.status === 404) return null;
    throw err;
  });
  const gearKey = await client.resolveGearKey(detail.gear_id);
  return buildSyncInputActivity(detail, streamsRaw, gearKey);
}

/** Paginates GET /athlete/activities (Strava always returns newest-first regardless of the
 * after/before filter used) and fetches full detail+streams for every id not already in
 * existingIds, stopping early without throwing once the client's rate-limit budget is exhausted.
 */
async function collectActivities(client, { after, before, existingIds }) {
  const entries = [];
  let page = 1;
  let oldestEpoch = null;
  let stopReason = null;
  let reachedEnd = false;

  outer: while (true) {
    let batch;
    try {
      batch = await client.listActivities({ after, before, page, perPage: 100 });
    } catch (err) {
      if (err instanceof RateLimitStopError) {
        stopReason = err.code;
        break;
      }
      throw err;
    }
    if (!batch.length) {
      reachedEnd = true;
      break;
    }

    for (const summary of batch) {
      const epoch = Math.floor(new Date(summary.start_date).getTime() / 1000);
      // oldestEpoch must only advance past a summary once it's actually been handled (already
      // synced, or freshly fetched this run) - NOT just because it was the next one iterated to.
      // Updating it unconditionally here (before knowing whether fetchActivity() below succeeds)
      // was the bug: if the budget ran out on exactly this summary's fetch, its own epoch still
      // became the cutoff for the next run's `before` cursor, permanently excluding it even
      // though it was never actually fetched. See CLAUDE.md's backfill cursor note.
      if (existingIds.has(summary.id)) {
        if (oldestEpoch === null || epoch < oldestEpoch) oldestEpoch = epoch;
        continue;
      }
      try {
        entries.push(await fetchActivity(client, summary.id));
      } catch (err) {
        if (err instanceof RateLimitStopError) {
          stopReason = err.code;
          break outer;
        }
        throw err;
      }
      if (oldestEpoch === null || epoch < oldestEpoch) oldestEpoch = epoch;
    }

    if (batch.length < 100) {
      reachedEnd = true;
      break;
    }
    page++;
  }

  return { entries, oldestEpoch, stopReason, reachedEnd };
}

async function runForwardPass(client, activities, existingIds) {
  const latest = activities.reduce((max, a) => (a.date > max ? a.date : max), '');
  const after = latest ? Math.floor(new Date(latest).getTime() / 1000) : undefined;
  const { entries, stopReason } = await collectActivities(client, { after, existingIds });
  console.log(
    `[run-api-sync] forward pass: ${entries.length} new activities${stopReason ? ` (stopped early: ${stopReason})` : ''}`,
  );
  return entries;
}

async function runBackfillPass(client, state, existingIds) {
  const { entries, oldestEpoch, stopReason, reachedEnd } = await collectActivities(client, {
    before: state.cursorBeforeEpoch,
    existingIds,
  });

  // No "- 1" here: Strava's `before` filter is exclusive (epoch < before, confirmed empirically -
  // every sync-strava.mjs merge log across this whole backfill reports "0 already present", i.e.
  // the boundary activity is never re-returned by the next page). Subtracting 1 second used to
  // also exclude whatever activity happened to sit at exactly that next second, which is exactly
  // how activities used to get silently dropped at backfill boundaries before this fix (see
  // CLAUDE.md's backfill cursor note) - each boundary would drop exactly 1 activity.
  const nextState = reachedEnd
    ? { done: true, cursorBeforeEpoch: null, lastRunStopReason: null }
    : {
        done: false,
        cursorBeforeEpoch: oldestEpoch !== null ? oldestEpoch : state.cursorBeforeEpoch,
        lastRunStopReason: stopReason,
      };

  if (reachedEnd) console.log('[run-api-sync] backfill reached the start of activity history - done');
  console.log(
    `[run-api-sync] backfill pass: ${entries.length} new activities${stopReason ? ` (stopped early: ${stopReason})` : ''}, next cursor: ${nextState.cursorBeforeEpoch ?? 'n/a (done)'}`,
  );

  return { entries, nextState };
}

async function main() {
  const clientId = requireEnv('STRAVA_CLIENT_ID');
  const clientSecret = requireEnv('STRAVA_CLIENT_SECRET');
  const refreshToken = requireEnv('STRAVA_REFRESH_TOKEN');
  const mode = process.env.SYNC_MODE || 'auto';

  const client = new StravaClient({ clientId, clientSecret, refreshToken });
  await client.authenticate();

  const activities = readJson(`${SRC_DATA_DIR}/activities.json`, []);
  const existingIds = new Set(activities.map((a) => a.id));
  let backfillState = readBackfillState();
  const coldStart = activities.length === 0 && backfillState.done;

  const allEntries = [];
  const collect = (entries) => {
    for (const e of entries) existingIds.add(e.id);
    allEntries.push(...entries);
  };

  if (mode === 'forward-only') {
    collect(await runForwardPass(client, activities, existingIds));
  } else if (mode === 'backfill') {
    if (backfillState.done) backfillState = { done: false, cursorBeforeEpoch: Math.floor(Date.now() / 1000) };
    const { entries, nextState } = await runBackfillPass(client, backfillState, existingIds);
    collect(entries);
    writeBackfillState(nextState);
  } else {
    // auto
    if (coldStart) {
      console.log('[run-api-sync] activities.json is empty - starting backfill from now instead of a forward pass');
      backfillState = { done: false, cursorBeforeEpoch: Math.floor(Date.now() / 1000) };
    } else {
      collect(await runForwardPass(client, activities, existingIds));
    }
    if (!backfillState.done) {
      const { entries, nextState } = await runBackfillPass(client, backfillState, existingIds);
      collect(entries);
      writeBackfillState(nextState);
    }
  }

  if (client.lastUsage) {
    const { shortTermUsage, shortTermLimit, dailyUsage, dailyLimit } = client.lastUsage;
    console.log(
      `[run-api-sync] Strava-reported rate-limit usage as of the last call this run: ${shortTermUsage}/${shortTermLimit} per 15min, ${dailyUsage}/${dailyLimit} today (this process made ${client.readCallCount} raw HTTP calls)`,
    );
  }

  if (!allEntries.length) {
    console.log('[run-api-sync] nothing new to sync');
    return;
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'strava-api-sync-'));
  const tmpFile = path.join(tmpDir, 'activities.json');
  fs.writeFileSync(tmpFile, JSON.stringify(allEntries));

  execFileSync('node', [SYNC_STRAVA_SCRIPT, tmpFile], { stdio: 'inherit' });
}

main().catch((err) => {
  // A RateLimitStopError can also come from client.authenticate() itself, outside the
  // collectActivities()/runForwardPass()/runBackfillPass() call chain that already handles it
  // gracefully - treat it the same way fetch-gear.mjs does for its own authenticate() call:
  // nothing was written yet, so just retry next scheduled run instead of going red.
  if (err instanceof RateLimitStopError) {
    console.warn(`[run-api-sync] stopped early: ${err.message} - will retry next run`);
    process.exit(0);
  }
  console.error(err);
  process.exit(1);
});
