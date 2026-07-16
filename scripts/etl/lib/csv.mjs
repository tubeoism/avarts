import fs from 'node:fs';

/** Minimal RFC4180 CSV parser: handles quoted fields, embedded commas/newlines, escaped quotes ("") */
export function parseCsvText(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const n = text[i + 1];
    if (inQuotes) {
      if (c === '"' && n === '"') { field += '"'; i++; }
      else if (c === '"') { inQuotes = false; }
      else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (c === '\r') {
      // skip
    } else {
      field += c;
    }
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** RFC4180 serializer, inverse of parseCsvText: quotes a field only when it contains a comma,
 * quote, or newline (matches how Strava's own export is formatted - unquoted fields stay
 * unquoted), doubling any embedded quotes. */
function csvField(value) {
  const s = value ?? '';
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function writeCsv(filePath, header, rows) {
  const lines = [header, ...rows].map((row) => row.map(csvField).join(','));
  fs.writeFileSync(filePath, `${lines.join('\r\n')}\r\n`);
}

export function readCsv(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const rows = parseCsvText(text);
  const header = rows[0] ?? [];
  const overLong = rows.slice(1).filter((r) => r.length > header.length).length;
  if (overLong > 0) {
    console.warn(`[csv] ${filePath}: dropping ${overLong} row(s) with more fields than the header (${header.length})`);
  }
  const data = rows
    .slice(1)
    // Strava sometimes drops the trailing comma(s) when the last column(s) are empty,
    // so rows can come out shorter than the header - pad them back out.
    .filter((r) => r.length <= header.length && r.some((v) => v !== ''))
    .map((r) => (r.length === header.length ? r : [...r, ...Array(header.length - r.length).fill('')]));
  return { header, data };
}

/** Helper for headers with duplicate column names (Strava export quirk). */
export function colIndexer(header) {
  return {
    first: (name) => header.indexOf(name),
    last: (name) => header.lastIndexOf(name),
  };
}

export function toNum(v) {
  if (v === undefined || v === null || v === '') return undefined;
  const n = Number(v);
  return Number.isNaN(n) ? undefined : n;
}

export function toStr(v) {
  if (v === undefined || v === null || v === '') return undefined;
  return v;
}

export function toBool(v) {
  return v === 'true' || v === 'True' || v === '1';
}

const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
const STRAVA_DATE_RE = /^([A-Za-z]{3}) (\d{1,2}), (\d{4}), (\d{1,2}):(\d{2}):(\d{2}) (AM|PM)$/;

/**
 * Strava's exported date strings (e.g. "Jul 3, 2026, 11:02:32 PM") are UTC, not local time -
 * confirmed by cross-checking against activity names (an activity timestamped "11:02:32 PM" is
 * named "Morning Run", which only makes sense if that's 11:02 PM UTC = ~6am Vietnam time).
 * `new Date(dateStr)` would parse this ambiguous string using the *executing machine's* local
 * timezone instead, silently shifting every timestamp by however many hours that machine happens
 * to differ from UTC - so this parses the known Strava format explicitly as UTC.
 */
export function toIso(dateStr) {
  if (!dateStr) return undefined;
  const m = STRAVA_DATE_RE.exec(dateStr.trim());
  if (m) {
    const [, mon, day, year, hh, mm, ss, ampm] = m;
    const month = MONTHS[mon];
    if (month === undefined) return undefined;
    let hour = Number(hh) % 12;
    if (ampm.toUpperCase() === 'PM') hour += 12;
    const d = new Date(Date.UTC(Number(year), month, Number(day), hour, Number(mm), Number(ss)));
    return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
  }
  // fallback for any format that doesn't match the expected Strava pattern
  const d = new Date(dateStr);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}
