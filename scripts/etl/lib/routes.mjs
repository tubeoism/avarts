import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, ensureDir, writeJson } from './paths.mjs';
import { simplifyToCount } from './resample.mjs';

export const ROUTES_PATH = path.join(DATA_DIR, 'routes.json');
const ROUTE_MAX_POINTS = 40;

/** Lightweight overview-map entry for one activity: heavily simplified [lat,lng] pairs only
 * (no ele/hr/cad/t/d — those live in the per-activity stream file, not needed for an overview
 * of ~1700 routes at once). Returns undefined when the activity has no usable GPS fix. */
export function buildRouteEntry(activity, rawPoints) {
  const geo = rawPoints.filter((p) => p.lat !== undefined && p.lng !== undefined);
  if (geo.length < 2) return undefined;
  const sampled = simplifyToCount(geo, ROUTE_MAX_POINTS);
  return {
    id: activity.id,
    date: activity.date,
    type: activity.type,
    distanceKm: activity.distanceKm,
    coords: sampled.map((p) => [p.lat, p.lng]),
  };
}

export function readRoutes() {
  if (!fs.existsSync(ROUTES_PATH)) return [];
  try {
    return JSON.parse(fs.readFileSync(ROUTES_PATH, 'utf8'));
  } catch (err) {
    throw new Error(`Corrupted ${ROUTES_PATH}: ${err.message}`);
  }
}

export function writeRoutes(routes) {
  ensureDir(DATA_DIR);
  writeJson(ROUTES_PATH, routes);
}
