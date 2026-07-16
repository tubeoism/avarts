import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// this file lives at app/scripts/etl/lib/paths.mjs -> app dir is 3 levels up
export const APP_DIR = path.resolve(__dirname, '../../../');

// The raw Strava export (activities.csv, activities/, profile.csv, ...) lives one
// level above the app/ folder, unless overridden via STRAVA_EXPORT_DIR.
export const SOURCE_DIR = process.env.STRAVA_EXPORT_DIR
  ? path.resolve(process.env.STRAVA_EXPORT_DIR)
  : path.resolve(APP_DIR, '..');

// public/data: served as-is by Cloudflare Pages, fetched client-side at runtime
// (also used for the 1728 per-activity stream files, which are only ever fetched, never imported).
export const DATA_DIR = path.join(APP_DIR, 'public', 'data');
export const STREAMS_DIR = path.join(DATA_DIR, 'streams');

// src/data: pages `import` the small aggregate JSON files from here so Vite bundles
// them at build time (also gives JSON shape inference via TS). These are symlinks
// into public/data — there is only one real copy of each "core" file; src/data just
// gives the build-time import path a place to point. (Historically the adapter
// `@astrojs/cloudflare` prerendered in a Workers sandbox with no filesystem, which is
// why these used to be real duplicated files instead of symlinks — see CLAUDE.md's Deploy
// note for why that adapter was removed.)
export const SRC_DATA_DIR = path.join(APP_DIR, 'src', 'data');

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

export function srcPath(...segments) {
  return path.join(SOURCE_DIR, ...segments);
}

export function writeJson(filePath, data) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(data));
}

/**
 * Write a "core" aggregate JSON to public/data (the only real copy, fetched at
 * runtime) and (re)point a src/data symlink at it so build-time `import` resolves
 * to the same file.
 */
export function writeJsonBoth(filename, data) {
  const publicFilePath = path.join(DATA_DIR, filename);
  writeJson(publicFilePath, data);

  ensureDir(SRC_DATA_DIR);
  const linkPath = path.join(SRC_DATA_DIR, filename);
  const target = path.relative(SRC_DATA_DIR, publicFilePath);
  try {
    fs.unlinkSync(linkPath);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  fs.symlinkSync(target, linkPath);
}
