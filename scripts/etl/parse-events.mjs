import { readCsv, colIndexer, toStr, toIso } from './lib/csv.mjs';
import { srcPath, writeJsonBoth } from './lib/paths.mjs';

export function parseEvents() {
  const { header, data } = readCsv(srcPath('events.csv'));
  const idx = colIndexer(header);

  const events = data
    .map((row) => ({
      title: toStr(row[idx.first('Event Title')]),
      description: toStr(row[idx.first('Event Description')]),
      startTime: toIso(row[idx.first('Start Time')]),
    }))
    .filter((e) => e.title)
    .sort((a, b) => (a.startTime ?? '').localeCompare(b.startTime ?? ''));

  writeJsonBoth('events.json', events);
  console.log(`[events] wrote ${events.length} events`);
  return events;
}
