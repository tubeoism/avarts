// Shared between parse-gear.mjs (CSV bulk-export pipeline) and sync-gear.mjs (both live-Strava
// gear sources - the nightly MCP routine and the GitHub Actions REST API pipeline funnel through
// it) so none of the three ever drift on what "kind"/"kmThreshold"/label a given gear item gets -
// the same class of bug CLAUDE.md's gotchas repeatedly describe for other duplicated constants.

export const SHOE_KM_THRESHOLD = 2500;
export const SANDAL_KM_THRESHOLD = 1500;

// Cosmetic-only override for bike nicknames that don't read well as a label on their own.
// Key = gear.json's `key` (the Strava bike nickname), value = display label.
export const BIKE_LABELS = {
  'Xế Độp': 'Giant Escape',
};

/**
 * Exact-brand match covers the dedicated-brand cases (Luna Sandals, the literal "Barefoot (No
 * Shoes)" brand this app uses); falls back to scanning brand+model+nickname for keyword hints
 * for gear where the signal lives in the model/nickname instead of the brand - e.g. a generic
 * "No name" brand paired with a model like "Chân đất" (Vietnamese for bare feet) or "Xỏ ngón"
 * (toe-strap/huarache-style sandal), where only the model/nickname keywords can distinguish
 * them from a regular shoe (see CLAUDE.md's Gear catalog note).
 */
export function shoeKind(brand, model, nickname) {
  if (brand === 'Barefoot (No Shoes)') return 'barefoot';
  if (brand === 'Luna Sandals') return 'sandal';
  const text = [brand, model, nickname].filter(Boolean).join(' ').toLowerCase();
  if (text.includes('chân đất') || text.includes('barefoot')) return 'barefoot';
  if (text.includes('xỏ ngón') || text.includes('sandal')) return 'sandal';
  return 'shoe';
}

export function kmThresholdForKind(kind) {
  if (kind === 'shoe') return SHOE_KM_THRESHOLD;
  if (kind === 'sandal') return SANDAL_KM_THRESHOLD;
  return null; // barefoot, bike
}

export function labelForShoe(kind, key) {
  return kind === 'barefoot' ? 'Chạy chân đất (không giày)' : key;
}

/**
 * Strava's "Activity Gear" field for a shoe is "<brand> <model>", except when the shoe has a
 * non-blank nickname ("Shoe Name" in the CSV export), in which case it's "<brand> <model>
 * <nickname>" - confirmed against real activities.csv data (see CLAUDE.md's CSV quirks note on
 * gear naming). Single source of truth for this so parse-gear.mjs (CSV), buildGearEntry()
 * (live-Strava catalog), and StravaClient#resolveGearKey (per-activity tagging during sync)
 * can't drift on the formula.
 *
 * Idempotent regardless of whether `nickname` arrives as a bare nickname (the CSV `Shoe Name`
 * column, e.g. "xanh") or as an already-prefixed "<brand> <model> <nickname>" string - confirmed
 * via real production traffic that Strava's live `GET /gear/{id}` `name` field can return the
 * latter, not a bare nickname. Without this, a
 * pre-joined `nickname` gets the "<brand> <model> " prefix appended a second time (e.g. "HOKA
 * arahi 7" + "HOKA arahi 7 xanh" -> "HOKA arahi 7 HOKA arahi 7 xanh"), producing a key that
 * doesn't match the catalog entry built from CSV/other sources - mergeGearCatalog() then inserts
 * it as a brand-new duplicate entry instead of updating the real one (and, as a second symptom,
 * wrongly retires the real entry since its key never shows up in that run's rawGear).
 */
export function shoeKey(brand, model, nickname) {
  const bm = [brand || '', model || ''].filter(Boolean).join(' ').trim();
  let nick = (nickname || '').trim();
  if (!nick || nick.toLowerCase() === bm.toLowerCase()) return bm || nick;
  if (bm && nick.toLowerCase().startsWith(bm.toLowerCase())) {
    nick = nick.slice(bm.length).trim();
    if (!nick) return bm;
  }
  return [bm, nick].filter(Boolean).join(' ').trim();
}

/**
 * Recomputes totalDistanceKm/totalMovingTimeSec/activityCount for every item in `gearItems` from
 * scratch by scanning `activities` (matched on `gear.key` === `activity.gear`), instead of
 * incrementally accumulating deltas. A full recompute can't drift out of sync with
 * activities.json - whatever ran last always produces the same totals for the same inputs.
 * Mutates and returns `gearItems`.
 */
export function recomputeGearTotals(gearItems, activities) {
  const byKey = new Map(gearItems.map((g) => [g.key, g]));
  for (const g of gearItems) {
    g.totalDistanceKm = 0;
    g.totalMovingTimeSec = 0;
    g.activityCount = 0;
  }
  for (const a of activities) {
    if (!a.gear) continue;
    const g = byKey.get(a.gear);
    if (!g) continue;
    g.totalDistanceKm += a.distanceKm || 0;
    g.totalMovingTimeSec += a.movingTimeSec || 0;
    g.activityCount += 1;
  }
  for (const g of gearItems) {
    g.totalDistanceKm = Math.round(g.totalDistanceKm * 10) / 10;
  }
  return gearItems;
}

/**
 * Builds one gear.json catalog entry from a source-agnostic raw gear item:
 * { type: 'bike' | 'shoe', name, brand, model, retired }. Both live-Strava gear sources (REST
 * `DetailedGear` via api/fetch-gear.mjs, and the MCP `get_gear` tool result) get normalized into
 * this same shape before calling mergeGearCatalog() - see sync-gear.mjs's header comment for the
 * exact field mapping from each source.
 */
export function buildGearEntry({ type, name, brand, model, retired }) {
  if (type === 'bike') {
    const key = name;
    return {
      kind: 'bike',
      key,
      label: BIKE_LABELS[key] ?? key,
      brand: brand || undefined,
      model: model || undefined,
      retired: !!retired,
      kmThreshold: null,
      components: [],
      totalDistanceKm: 0,
      totalMovingTimeSec: 0,
      activityCount: 0,
    };
  }
  const b = brand || '';
  const m = model || '';
  // Same shoeKey() convention as parse-gear.mjs (CSV pipeline) and StravaClient#resolveGearKey
  // (the per-activity resolver both activity-sync pipelines use) - see CLAUDE.md's CSV quirks
  // note on gear naming.
  const key = shoeKey(b, m, name);
  const kind = shoeKind(b, m, name);
  return {
    kind,
    key,
    label: labelForShoe(kind, key),
    brand: b,
    model: m,
    retired: !!retired,
    kmThreshold: kmThresholdForKind(kind),
    totalDistanceKm: 0,
    totalMovingTimeSec: 0,
    activityCount: 0,
  };
}

/**
 * Merges a raw gear array into an EXISTING catalog and recomputes totals from `activities` - the
 * whole job of sync-gear.mjs, factored out so it's independently testable. For each item in
 * `rawGear`, either updates the matching existing entry's mutable/authoritative fields (retired,
 * brand, model, label, kind, kmThreshold) in place, or inserts it as new - existing entries not
 * present in `rawGear` are always kept, never dropped (see CLAUDE.md's Gear catalog note:
 * `GET /athlete` does not list retired gear, so a full-replace here silently deleted retired
 * entries on every REST API sync run). Fields the live sources don't carry (components,
 * sportTypes - CSV-only) are left untouched on existing entries.
 *
 * After that pass, any EXISTING entry whose key was NOT seen in this run's `rawGear` is inferred
 * retired (see CLAUDE.md's Gear catalog note): `GET /athlete` (the REST API pipeline's source of
 * `rawGear`, see api/fetch-gear.mjs) only ever lists gear currently in use, so an id that drops
 * out of that list has been retired on Strava - this is the only way the live-sync path can ever
 * detect a NEW retirement (an item is never re-queried via GET /gear/{id} once it's absent from
 * GET /athlete, so its own `retired` flag is never re-observed). Guarded behind a non-empty
 * `rawGear`: a previously observed anomaly where GET /athlete returned a fully empty list would
 * otherwise mark the entire catalog retired from a single bad/transient API response.
 *
 * Mutates and returns a new array (does not mutate `existingItems`).
 */
export function mergeGearCatalog(existingItems, rawGear, activities) {
  const byKey = new Map(existingItems.map((g) => [g.key, { ...g }]));
  const seenKeys = new Set();
  for (const raw of rawGear) {
    const fresh = buildGearEntry(raw);
    seenKeys.add(fresh.key);
    const existing = byKey.get(fresh.key);
    if (existing) {
      existing.retired = fresh.retired;
      existing.label = fresh.label;
      existing.kind = fresh.kind;
      existing.kmThreshold = fresh.kmThreshold;
      if (fresh.brand) existing.brand = fresh.brand;
      if (fresh.model) existing.model = fresh.model;
    } else {
      byKey.set(fresh.key, fresh);
    }
  }
  if (rawGear.length > 0) {
    for (const g of byKey.values()) {
      if (!seenKeys.has(g.key)) g.retired = true;
    }
  }
  const items = [...byKey.values()];
  recomputeGearTotals(items, activities);
  return items;
}
