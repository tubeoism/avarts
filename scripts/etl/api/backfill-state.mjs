import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Committed to git (not under public/ or src/data/) so the cursor survives across ephemeral
// GitHub Actions runners between runs.
export const BACKFILL_STATE_PATH = path.join(__dirname, 'backfill-state.json');

// done:true means "nothing to backfill" - the safe default when activities.json already has
// full history (today's reality, populated from the bulk export). run-api-sync.mjs flips this to
// done:false automatically only if it ever finds activities.json empty (cold start / disaster
// recovery), or when a run is explicitly forced into backfill mode.
const DEFAULT_STATE = { done: true, cursorBeforeEpoch: null, lastRunStopReason: null };

export function readBackfillState() {
  if (!fs.existsSync(BACKFILL_STATE_PATH)) return { ...DEFAULT_STATE };
  return { ...DEFAULT_STATE, ...JSON.parse(fs.readFileSync(BACKFILL_STATE_PATH, 'utf8')) };
}

export function writeBackfillState(state) {
  fs.writeFileSync(BACKFILL_STATE_PATH, `${JSON.stringify(state, null, 2)}\n`);
}
