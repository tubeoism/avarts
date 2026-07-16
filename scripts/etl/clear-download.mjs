import fs from 'node:fs';
import path from 'node:path';
import { APP_DIR } from './lib/paths.mjs';

/*
 * Empties download/ after "Build from downloaded data" has processed it, WITHOUT deleting the
 * directory itself - keeps .gitkeep (so an empty dir still tracks in git) and README.md (so the
 * folder still explains its own purpose to whoever looks next time) in place, removes everything
 * else including nested directories like download/activities/.
 */

const KEEP = new Set(['.gitkeep', 'README.md']);

function main() {
  const downloadDir = path.resolve(process.argv[2] ?? path.join(APP_DIR, 'download'));
  if (!fs.existsSync(downloadDir)) {
    console.log(`[clear-download] ${downloadDir} does not exist, nothing to clear`);
    return;
  }

  let removed = 0;
  for (const entry of fs.readdirSync(downloadDir)) {
    if (KEEP.has(entry)) continue;
    fs.rmSync(path.join(downloadDir, entry), { recursive: true, force: true });
    removed++;
  }
  console.log(`[clear-download] removed ${removed} entr${removed === 1 ? 'y' : 'ies'} from ${downloadDir}, kept ${[...KEEP].join(', ')}`);
}

main();
