// Garmin/Strava record raw cadence for foot sports (Run, Walk) as revolutions of a SINGLE leg
// per minute (i.e. strides/min) - both the CSV bulk export and the Strava API preserve this raw
// unit, but Strava's own app/website double it before display to show steps/min ("For foot
// sports, Strava uses two steps for one unit of cadence in the API" - Strava developer forum).
// Cycling cadence has no such split: one crank revolution already involves both legs, so Ride
// values are already the RPM Strava displays and must NOT be doubled.
const FOOT_SPORT_TYPES = new Set(['Run', 'Walk']);

export function normalizeCadence(value, type) {
  if (value == null) return value;
  return FOOT_SPORT_TYPES.has(type) ? value * 2 : value;
}
