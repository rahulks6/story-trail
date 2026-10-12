/**
 * Geohash cells for people's approximate areas (Phase 9, nearby reach). The app works out the
 * cell on the phone and sends only the cell, never coordinates. A 4-character cell is about
 * 39 x 20 km; its first 3 characters name the surrounding area of about 156 x 156 km.
 * Neighbouring cells are included when matching, so two people on either side of a cell edge
 * still count as near each other.
 */
const BASE32 = "0123456789bcdefghjkmnpqrstuvwxyz";

/** The cell length the app sends and the server keeps. */
export const AREA_CELL_LENGTH = 4;
export const AREA_CELL_RE = /^[0-9b-hjkmnp-z]{4}$/;

export function encodeGeohash(latitude: number, longitude: number, precision: number): string {
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

/** The centre of a cell and half its height and width, in degrees. */
export function decodeGeohash(cell: string): { latitude: number; longitude: number; latitudeError: number; longitudeError: number } {
  let latMin = -90, latMax = 90, lngMin = -180, lngMax = 180, evenBit = true;
  for (const char of cell) {
    const index = BASE32.indexOf(char);
    if (index < 0) throw new Error(`Not a geohash: ${cell}`);
    for (let bit = 4; bit >= 0; bit--) {
      const on = (index >> bit) & 1;
      if (evenBit) {
        const mid = (lngMin + lngMax) / 2;
        if (on) lngMin = mid; else lngMax = mid;
      } else {
        const mid = (latMin + latMax) / 2;
        if (on) latMin = mid; else latMax = mid;
      }
      evenBit = !evenBit;
    }
  }
  return {
    latitude: (latMin + latMax) / 2,
    longitude: (lngMin + lngMax) / 2,
    latitudeError: (latMax - latMin) / 2,
    longitudeError: (lngMax - lngMin) / 2,
  };
}

/** The cell and the up to 8 cells around it (fewer at the poles), same length. */
export function cellsAround(cell: string): string[] {
  const { latitude, longitude, latitudeError, longitudeError } = decodeGeohash(cell);
  const cells = new Set<string>();
  for (const dLat of [-1, 0, 1]) {
    const lat = latitude + dLat * latitudeError * 2;
    if (lat > 90 || lat < -90) continue;
    for (const dLng of [-1, 0, 1]) {
      let lng = longitude + dLng * longitudeError * 2;
      if (lng >= 180) lng -= 360;
      if (lng < -180) lng += 360;
      cells.add(encodeGeohash(lat, lng, cell.length));
    }
  }
  return [...cells];
}
