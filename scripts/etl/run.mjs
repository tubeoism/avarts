import fs from 'node:fs';
import { parseActivities } from './parse-activities.mjs';
import { parseStreams, DEFAULT_TZ } from './parse-streams.mjs';
import { serializeRecords } from './lib/records.mjs';
import { parseGear } from './parse-gear.mjs';
import { parseEvents } from './parse-events.mjs';
import { parseProfile } from './parse-profile.mjs';
import { computeFitness } from './compute-fitness.mjs';
import { SOURCE_DIR, SRC_DATA_DIR, writeJsonBoth } from './lib/paths.mjs';

async function main() {
  console.log(`[etl] reading Strava export from: ${SOURCE_DIR}`);
  console.time('[etl] total');

  const activities = parseActivities();

  console.time('[etl] streams');
  const { streamedIds, recordsState, timezones } = await parseStreams(activities);
  console.timeEnd('[etl] streams');

  for (const a of activities) {
    a.hasStream = streamedIds.has(a.id);
    a.timezone = timezones.get(a.id) ?? DEFAULT_TZ;
  }
  writeJsonBoth('activities.json', activities);
  console.log(`[activities] wrote ${activities.length} activities -> ${(fs.statSync(`${SRC_DATA_DIR}/activities.json`).size / 1024).toFixed(1)} KB`);

  serializeRecords(recordsState, activities);
  parseGear(activities);
  parseEvents();
  parseProfile();
  computeFitness(activities);

  console.timeEnd('[etl] total');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
