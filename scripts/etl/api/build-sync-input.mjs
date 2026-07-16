/** Maps a Strava API stream response (key_by_type=true shape: { time: {data:[...]}, ... }) into
 * the { time, distance, altitude, heartRate, cadence, watts, location } shape sync-strava.mjs
 * expects. Returns null if there's no usable time series (e.g. a manual/indoor entry with no
 * streams at all). */
export function toStreamsPayload(streamsRaw) {
  const time = streamsRaw?.time?.data;
  if (!time?.length) return null;
  return {
    time,
    distance: streamsRaw.distance?.data,
    altitude: streamsRaw.altitude?.data,
    heartRate: streamsRaw.heartrate?.data,
    cadence: streamsRaw.cadence?.data,
    watts: streamsRaw.watts?.data,
    location: streamsRaw.latlng?.data,
  };
}

/** Builds one entry of the raw-activity array sync-strava.mjs reads (see the schema comment atop
 * that file) from a Strava DetailedActivity + raw streams response + a pre-resolved gear key.
 *
 * avgCadence is passed through RAW (single-leg rpm for Run/Walk) - sync-strava.mjs's own
 * normalizeCadence() doubles it for foot sports (see CLAUDE.md's Cadence note), so doubling
 * here too would double-count it. Strava's detail response has no max_cadence field, so it's
 * derived from the cadence stream itself. */
export function buildSyncInputActivity(detail, streamsRaw, gearKey) {
  const cadenceSamples = streamsRaw?.cadence?.data?.filter((v) => v != null) ?? [];
  const maxCadence = cadenceSamples.length ? Math.max(...cadenceSamples) : undefined;

  return {
    id: detail.id,
    name: detail.name,
    sportType: detail.sport_type,
    // Strava's start_date_local is formatted with a trailing "Z" even though it's local
    // wall-clock time, not UTC (a known API quirk) - strip it so localToUtcIso() treats it as
    // the naive local timestamp it actually is.
    startLocal: detail.start_date_local?.replace(/Z$/, ''),
    gear: gearKey,
    isCommute: !!detail.commute,
    distanceMeters: detail.distance,
    movingTimeSec: detail.moving_time,
    elapsedTimeSec: detail.elapsed_time,
    elevationGain: detail.total_elevation_gain,
    avgSpeedMs: detail.average_speed,
    maxSpeedMs: detail.max_speed,
    calories: detail.calories,
    avgCadence: detail.average_cadence,
    maxCadence,
    avgHeartRate: detail.average_heartrate,
    maxHeartRate: detail.max_heartrate,
    avgWatts: detail.average_watts,
    perceivedExertion: detail.perceived_exertion,
    relativeEffort: detail.suffer_score,
    streams: toStreamsPayload(streamsRaw),
  };
}
