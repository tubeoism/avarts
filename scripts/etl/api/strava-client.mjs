import { shoeKey } from '../lib/gear.mjs';

const API_BASE = 'https://www.strava.com/api/v3';
const OAUTH_TOKEN_URL = 'https://www.strava.com/oauth/token';

// Raised from 195 to 350 to 370 (2026-07-13, at the owner's request) to empirically probe the
// real short-term ceiling: Strava's docs say 200 reads/15min, but on 2026-07-12 ~387 reads were
// actually SERVED inside one clock window before the first 429 arrived (see CLAUDE.md gotcha
// #32), so the enforced limit may be higher/laggier than documented. 350 ran clean for 2
// consecutive iterations with no 429s, so this pushes closer to that ~387 ceiling to keep
// narrowing it down. Safe to test because the 429 path stops gracefully (fetched work is kept,
// cursor advances) and every run now logs Strava's own X-ReadRateLimit-Usage/-Limit values as
// its last line - the observed outcome decides whether this stays or comes back down.
export const MAX_READ_CALLS_PER_RUN = 370;
const DAILY_SAFETY_RATIO = 0.9;

/** Thrown when the client refuses to make another call because the per-run budget or the
 * observed daily-usage safety margin has been reached. Callers should catch this, stop fetching,
 * and persist whatever was already collected instead of treating it as a hard failure.
 *
 * `code` distinguishes WHY, because the two cases need opposite handling by the workflow loop in
 * strava-api-sync.yml: 'per-run-budget' means "this one batch is done, sleep and start the next
 * batch" (the expected, routine outcome of every backfill iteration - MAX_READ_CALLS_PER_RUN is
 * an internal pacing knob, not a real Strava limit), while 'daily-quota'/'short-term-429' mean an
 * actual Strava-enforced limit was hit and the whole job should stop for real. Before this
 * distinction existed, the workflow treated every RateLimitStopError as "stop the whole job",
 * which meant the multi-iteration backfill loop never ran past iteration 1 in practice (backfill
 * hits the per-run budget on essentially every iteration by design). */
export class RateLimitStopError extends Error {
  constructor(reason, code) {
    super(`Strava rate limit budget reached: ${reason}`);
    this.name = 'RateLimitStopError';
    this.code = code;
  }
}

/** Recognizes the 2 OAuth misconfiguration error shapes that have already bitten this pipeline's
 * setup once each (see CLAUDE.md's REST API sync note on refresh token scope) and appends a
 * message pointing straight at the fix, instead of leaving just the raw API response in the log.
 * Falls back to the raw text for any other error shape. */
function describeStravaError(status, text) {
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return `${status} ${text}`;
  }
  const errors = Array.isArray(body?.errors) ? body.errors : [];

  const missingScope = errors.find(
    (e) => e.resource === 'AccessToken' && e.code === 'missing' && String(e.field).includes('read_permission'),
  );
  if (missingScope) {
    return (
      `${status} ${text}\n` +
      '-> The refresh token was minted without the activity:read_all scope. Refreshing an access ' +
      "token can't add scope after the fact - re-run the OAuth authorize flow with " +
      'scope=activity:read_all to mint a NEW refresh token, then update the STRAVA_REFRESH_TOKEN ' +
      'secret. See CLAUDE.md for the exact steps.'
    );
  }

  const invalidRefreshToken = errors.find((e) => e.resource === 'RefreshToken' && e.code === 'invalid');
  if (invalidRefreshToken) {
    return (
      `${status} ${text}\n` +
      "-> STRAVA_REFRESH_TOKEN isn't a valid refresh token. Most common cause: pasting the " +
      'one-time "code" from the OAuth redirect URL straight into the secret instead of exchanging ' +
      'it for a refresh_token first (grant_type=authorization_code) - codes are single-use and ' +
      'expire in minutes. Verify locally with grant_type=refresh_token before updating the secret ' +
      'again. See CLAUDE.md for the exact steps.'
    );
  }

  return `${status} ${text}`;
}

export class StravaClient {
  constructor({ clientId, clientSecret, refreshToken }) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.refreshToken = refreshToken;
    this.accessToken = null;
    this.readCallCount = 0;
    this.lastUsage = null; // { shortTermUsage, shortTermLimit, dailyUsage, dailyLimit }
    this.gearCache = new Map();
  }

  /** OAuth token refresh counts against Strava's "overall" bucket, not the read-specific one -
   * deliberately not routed through get()/assertBudget(), which only guard read calls. */
  async authenticate() {
    const res = await fetch(OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        grant_type: 'refresh_token',
        refresh_token: this.refreshToken,
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Strava OAuth refresh failed: ${describeStravaError(res.status, text)}`);
    }
    const body = await res.json();
    this.accessToken = body.access_token;
    return body;
  }

  assertBudget() {
    if (this.readCallCount >= MAX_READ_CALLS_PER_RUN) {
      throw new RateLimitStopError(`hit local per-run cap (${MAX_READ_CALLS_PER_RUN} read calls)`, 'per-run-budget');
    }
    if (this.lastUsage?.dailyLimit && this.lastUsage.dailyUsage >= DAILY_SAFETY_RATIO * this.lastUsage.dailyLimit) {
      throw new RateLimitStopError(
        `daily read usage near cap (${this.lastUsage.dailyUsage}/${this.lastUsage.dailyLimit})`,
        'daily-quota',
      );
    }
  }

  recordUsage(headers) {
    const usage = headers.get('x-readratelimit-usage');
    const limit = headers.get('x-readratelimit-limit');
    if (!usage || !limit) return;
    const [shortTermUsage, dailyUsage] = usage.split(',').map(Number);
    const [shortTermLimit, dailyLimit] = limit.split(',').map(Number);
    this.lastUsage = { shortTermUsage, shortTermLimit, dailyUsage, dailyLimit };
  }

  async get(path, { retry = true } = {}) {
    this.assertBudget();
    const res = await fetch(`${API_BASE}${path}`, {
      headers: { authorization: `Bearer ${this.accessToken}` },
    });
    this.readCallCount++;
    this.recordUsage(res.headers);

    if (res.status === 429) {
      if (!retry) throw new RateLimitStopError('received 429 twice in a row', 'short-term-429');
      const retryAfterSec = Number(res.headers.get('retry-after')) || 60;
      console.warn(`[strava-client] 429 rate limited, backing off ${retryAfterSec}s once`);
      await new Promise((r) => setTimeout(r, retryAfterSec * 1000));
      return this.get(path, { retry: false });
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const err = new Error(`Strava API ${path} failed: ${describeStravaError(res.status, text)}`);
      err.status = res.status;
      throw err;
    }
    return res.json();
  }

  listActivities({ after, before, page = 1, perPage = 100 } = {}) {
    const params = new URLSearchParams({ page: String(page), per_page: String(perPage) });
    if (after != null) params.set('after', String(after));
    if (before != null) params.set('before', String(before));
    return this.get(`/athlete/activities?${params}`);
  }

  getActivityDetail(id) {
    return this.get(`/activities/${id}`);
  }

  getActivityStreams(id) {
    const keys = 'time,distance,latlng,altitude,heartrate,cadence,watts';
    return this.get(`/activities/${id}/streams?keys=${keys}&key_by_type=true`);
  }

  /** DetailedAthlete - used by sync-gear.mjs purely for its `bikes`/`shoes` SummaryGear arrays
   * (id + name), which list every gear id the athlete owns regardless of whether it appears on
   * any synced activity yet. */
  getAthlete() {
    return this.get('/athlete');
  }

  /** DetailedGear for one id - has brand_name/model_name/retired, which SummaryGear (the shape
   * returned inline by /athlete and by activity list/detail responses) does not. */
  getGearDetail(id) {
    return this.get(`/gear/${id}`);
  }

  /** Shoe gear ids start with "g" (key = shoeKey(brand, model, name) - "<brand> <model>", or
   * "<brand> <model> <nickname>" if Strava's `name` field carries a nickname distinct from
   * brand+model - see CLAUDE.md's CSV quirks note on gear naming), bike ids start with "b"
   * (key = nickname) - same convention parse-gear.mjs uses for the CSV-bulk-export pipeline.
   * Whether the live API's `name` field for a shoe is the bare nickname or already includes brand+model is
   * unverified (no live credentials at the time this was written) - shoeKey()'s dedup guard
   * covers either case. Returns undefined if gearId is falsy. */
  async resolveGearKey(gearId) {
    if (!gearId) return undefined;
    if (this.gearCache.has(gearId)) return this.gearCache.get(gearId);
    const gear = await this.get(`/gear/${gearId}`);
    const isShoe = gearId.startsWith('g');
    const key = isShoe ? shoeKey(gear.brand_name, gear.model_name, gear.name) : gear.name;
    this.gearCache.set(gearId, key);
    return key;
  }
}
