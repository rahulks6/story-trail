/**
 * Nearby Stories (Phase 9): the phone turns a location reading into a 4-character geohash cell
 * (about 39 x 20 km) and only that cell ever leaves the device, never coordinates. The same
 * encoding as the server's (backend/src/modules/recommendations/geohash.ts).
 */
const BASE32 = "0123456789bcdefghjkmnpqrstuvwxyz";

/** The cell length the server accepts. */
export const AREA_CELL_LENGTH = 4;

export function encodeGeohash(latitude: number, longitude: number, precision: number = AREA_CELL_LENGTH): string {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
    throw new RangeError("Not a location on Earth.");
  }
  let latMin = -90, latMax = 90, lngMin = -180, lngMax = 180;
  let hash = "", bits = 0, value = 0, evenBit = true;
  while (hash.length < precision) {
    if (evenBit) {
      const mid = (lngMin + lngMax) / 2;
      if (longitude >= mid) { value = value * 2 + 1; lngMin = mid; } else { value *= 2; lngMax = mid; }
    } else {
      const mid = (latMin + latMax) / 2;
      if (latitude >= mid) { value = value * 2 + 1; latMin = mid; } else { value *= 2; latMax = mid; }
    }
    evenBit = !evenBit;
    if (++bits === 5) {
      hash += BASE32[value];
      bits = 0;
      value = 0;
    }
  }
  return hash;
}
