import { readCsv, colIndexer, toStr } from './lib/csv.mjs';
import { srcPath, writeJsonBoth } from './lib/paths.mjs';
import { shoeKind, shoeKey, kmThresholdForKind, labelForShoe, BIKE_LABELS, recomputeGearTotals } from './lib/gear.mjs';

// Strava's bulk CSV export has no shoe-retirement column (verified against a real export -
// shoes.csv only has Name/Brand/Model/Default Sport Types), so this list is a manually maintained
// fallback for the CSV pipeline only. The Strava API's own `retired` field (used by
// api/sync-gear.mjs) is authoritative and doesn't need this.
const RETIRED_SHOE_KEYS = new Set([
  'Adidas alphabounce rc2',
  'Adidas Mana Bounce 2',
  'Adidas adizero Boston 8 M',
  'Adidas Solar Glide M',
]);

export function parseGear(activities) {
  const shoes = readCsv(srcPath('shoes.csv'));
  const bikes = readCsv(srcPath('bikes.csv'));
  const components = readCsv(srcPath('components.csv'));

  const shoeIdx = colIndexer(shoes.header);
  const bikeIdx = colIndexer(bikes.header);
  const compIdx = colIndexer(components.header);

  const items = [];

  // Shoes: the Strava "Activity Gear" field stores "<Brand> <Model>" for shoes, or "<Brand>
  // <Model> <Shoe Name>" when the shoe has a non-blank nickname ("Shoe Name" column) - confirmed
  // against real activities.csv data (see CLAUDE.md's CSV quirks note on gear naming; the Shoe
  // Name column happens to be blank for every shoe in this repo's export, but is NOT universally
  // blank - see shoeKey()).
  for (const row of shoes.data) {
    const brand = toStr(row[shoeIdx.first('Shoe Brand')]);
    const model = toStr(row[shoeIdx.first('Shoe Model')]);
    const nickname = toStr(row[shoeIdx.first('Shoe Name')]);
    const sportTypes = toStr(row[shoeIdx.first('Shoe Default Sport Types')]);
    const key = shoeKey(brand, model, nickname);
    if (!key) continue;

    const kind = shoeKind(brand, model, nickname);
    items.push({
      kind,
      key,
      label: labelForShoe(kind, key),
      brand,
      model,
      sportTypes,
      retired: RETIRED_SHOE_KEYS.has(key),
      kmThreshold: kmThresholdForKind(kind),
      totalDistanceKm: 0,
      totalMovingTimeSec: 0,
      activityCount: 0,
    });
  }

  // Bikes: unlike shoes, the Strava "Activity Gear" field stores the Bike Name (nickname),
  // not "<Brand> <Model>" - so bikes must match on name instead.
  for (const row of bikes.data) {
    const name = toStr(row[bikeIdx.first('Bike Name')]);
    const brand = toStr(row[bikeIdx.first('Bike Brand')]);
    const model = toStr(row[bikeIdx.first('Bike Model')]);
    const sportTypes = toStr(row[bikeIdx.first('Bike Default Sport Types')]);
    if (!name) continue;
    const comps = components.data
      .filter((r) => toStr(r[compIdx.first('Bike Name')]) === name)
      .map((r) => ({
        type: toStr(r[compIdx.first('Component Type')]),
        brand: toStr(r[compIdx.first('Component Brand')]),
        model: toStr(r[compIdx.first('Component Model')]),
      }));
    items.push({
      kind: 'bike',
      key: name,
      label: BIKE_LABELS[name] ?? name,
      brand,
      model,
      sportTypes,
      retired: false,
      kmThreshold: null,
      components: comps,
      totalDistanceKm: 0,
      totalMovingTimeSec: 0,
      activityCount: 0,
    });
  }

  recomputeGearTotals(items, activities);

  writeJsonBoth('gear.json', items);
  console.log(`[gear] wrote ${items.length} gear items`);
  return items;
}
