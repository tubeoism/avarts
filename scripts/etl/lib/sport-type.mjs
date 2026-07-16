// Strava's SportType enum (granular - used by the REST API's `sport_type` field and the MCP
// connector) is a superset of the older ActivityType enum (coarse - used by the CSV bulk
// export's "Activity Type" column that parse-activities.mjs reads). Values only SportType has -
// e.g. TrailRun, VirtualRun, Badminton, MountainBikeRide - never existed as their own
// ActivityType, so Strava's own CSV export already folded them into the nearest coarse type for
// avarts-analytics's data (never anything but Run/Ride/Swim/Walk/"Weight Training"/Workout/Yoga).
// A CSV export can still have its own oddball values, e.g. "Stair-Stepper" seen in one export -
// unlike the others it's the CSV's OWN vocabulary, not a SportType artifact. Without this
// normalization, activities synced via the API (nightly MCP routine or the GitHub Actions REST
// API backfill, both of which funnel through buildActivityEntry() in sync-strava.mjs) would
// silently split into `type` values the rest of the app - goal groups, stat groups,
// ACTIVITY_COLORS, records/best-efforts eligibility (RECORD_TARGETS/BEST_EFFORT_TARGETS are keyed
// by type) - has never heard of.
const ALIASES = {
  TrailRun: 'Run',
  VirtualRun: 'Run',
  VirtualRide: 'Ride',
  MountainBikeRide: 'Ride',
  GravelRide: 'Ride',
  EMountainBikeRide: 'Ride',
  EBikeRide: 'Ride',
  Badminton: 'Workout',
  StairStepper: 'Workout',
  'Stair-Stepper': 'Workout',
};

/** ActivityType/SportType values are PascalCase machine identifiers ("WeightTraining"), while
 * the CSV bulk export's "Activity Type" column already contains Strava's human-readable spaced
 * form ("Weight Training") - insert the same spacing so both sources produce identical strings.
 * Applied after ALIASES so an aliased result ("Ride") passes through unchanged, and applied to
 * anything not in ALIASES too, so a future Strava sport type this table doesn't know about yet
 * still renders as spaced words instead of raw PascalCase. */
function spaceWords(value) {
  return value.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
}

export function normalizeSportType(rawType) {
  if (!rawType) return rawType;
  return spaceWords(ALIASES[rawType] ?? rawType);
}
