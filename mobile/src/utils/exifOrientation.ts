/**
 * The EXIF orientation (1 to 8) of a JPEG, read from its first bytes; 1 when there is none.
 * Phone cameras store the pixels as the sensor saw them and record how to turn them upright here.
 * Android's bitmap decoder ignores it, so utils/filterPhoto.ts turns the pixels itself.
 */
export function exifOrientation(bytes: Uint8Array): number {
  const u16 = (i: number, little: boolean) => (little ? (bytes[i] ?? 0) | ((bytes[i + 1] ?? 0) << 8) : ((bytes[i] ?? 0) << 8) | (bytes[i + 1] ?? 0));
  const u32 = (i: number, little: boolean) => (little ? u16(i, true) + u16(i + 2, true) * 65536 : u16(i, false) * 65536 + u16(i + 2, false));
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return 1;
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return 1;
    const marker = bytes[offset + 1] ?? 0;
    if (marker === 0xda || marker === 0xd9) return 1; // image data starts: no EXIF before it
    const length = u16(offset + 2, false);
    if (marker === 0xe1 && String.fromCharCode(...bytes.slice(offset + 4, offset + 10)) === "Exif\0\0") {
      const tiff = offset + 10;
      const little = bytes[tiff] === 0x49 && bytes[tiff + 1] === 0x49;
      if (!little && !(bytes[tiff] === 0x4d && bytes[tiff + 1] === 0x4d)) return 1;
      const ifd = tiff + u32(tiff + 4, little);
      const entries = u16(ifd, little);
      for (let e = 0; e < entries; e++) {
        const entry = ifd + 2 + e * 12;
        if (entry + 12 > bytes.length) return 1;
        if (u16(entry, little) === 0x0112) {
          const value = u16(entry + 8, little);
          return value >= 1 && value <= 8 ? value : 1;
        }
      }
      return 1;
    }
    offset += 2 + length;
  }
  return 1;
}

/** How to turn pixels upright for an EXIF orientation: mirror first, then rotate clockwise. */
export function uprightSteps(orientation: number): { mirror: boolean; rotate: 0 | 90 | 180 | 270 } {
  switch (orientation) {
    case 2: return { mirror: true, rotate: 0 };
    case 3: return { mirror: false, rotate: 180 };
    case 4: return { mirror: true, rotate: 180 };
    case 5: return { mirror: true, rotate: 270 };
    case 6: return { mirror: false, rotate: 90 };
    case 7: return { mirror: true, rotate: 90 };
    case 8: return { mirror: false, rotate: 270 };
    default: return { mirror: false, rotate: 0 };
  }
}
