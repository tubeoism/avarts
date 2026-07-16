import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, ensureDir, writeJson } from './paths.mjs';

export const HEATGRID_PATH = path.join(DATA_DIR, 'heatgrid.json');

export const CELL_METERS = 30;
const METERS_PER_DEG_LAT = 111320;

/** Deterministic ~CELL_METERS grid cell for a lat/lng - same real-world spot always resolves to
 * the same key (pure function of lat/lng + the constant above), which is what lets
 * sync-strava.mjs add weight into the existing grid without recomputing history from scratch.
 * Longitude width is corrected by cos(latitude) so cells stay roughly square instead of
 * stretching east-west. */
function cellOf(lat, lng) {
  const latCellDeg = CELL_METERS / METERS_PER_DEG_LAT;
  const latIndex = Math.floor(lat / latCellDeg);
  const latCenter = (latIndex + 0.5) * latCellDeg;
  const lngCellDeg = CELL_METERS / (METERS_PER_DEG_LAT * Math.cos((latCenter * Math.PI) / 180));
  const lngIndex = Math.floor(lng / lngCellDeg);
  return { key: `${latIndex}:${lngIndex}`, lat: latCenter, lng: (lngIndex + 0.5) * lngCellDeg };
}

/** Grid cells one activity's GPS track passes through, deduped so idling (red light, GPS drift
 * while stopped) doesn't add more weight to a cell than a fast segment passing through once -
 * a cell's eventual weight means "number of activities that passed here", not "number of GPS
 * samples that landed here". */
export function activityCells(points) {
  const cells = new Map();
  for (const p of points) {
    if (p.lat === undefined || p.lng === undefined) continue;
    const c = cellOf(p.lat, p.lng);
    if (!cells.has(c.key)) cells.set(c.key, c);
  }
  return cells;
}

export function readHeatGrid() {
  const grid = new Map();
  if (!fs.existsSync(HEATGRID_PATH)) return grid;
  let arr;
  try {
    arr = JSON.parse(fs.readFileSync(HEATGRID_PATH, 'utf8'));
  } catch (err) {
    throw new Error(`Corrupted ${HEATGRID_PATH}: ${err.message}`);
  }
  for (const { lat, lng, ...w } of arr) grid.set(cellOf(lat, lng).key, { lat, lng, w });
  return grid;
}

/** Add one activity's cells into the accumulated grid, +1 to that activity type's weight in
 * each cell it touches (kept per-type so the client can still filter the heatmap by type,
 * same as the routes-line layer). */
export function addActivityToGrid(grid, cells, type) {
  for (const [key, c] of cells) {
    let entry = grid.get(key);
    if (!entry) {
      entry = { lat: c.lat, lng: c.lng, w: {} };
      grid.set(key, entry);
    }
    entry.w[type] = (entry.w[type] || 0) + 1;
  }
}

export function writeHeatGrid(grid) {
  ensureDir(DATA_DIR);
  writeJson(HEATGRID_PATH, [...grid.values()].map(({ lat, lng, w }) => ({ lat, lng, ...w })));
}
