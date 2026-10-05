const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const LOOKUP = new Int16Array(128).fill(-1);
for (let i = 0; i < ALPHABET.length; i++) LOOKUP[ALPHABET.charCodeAt(i)] = i;

/**
 * Decodes standard base64 (as returned by RNFS.read) into bytes, so a file can be
 * uploaded in parts without ever holding the whole file in memory.
 */
export function base64ToBytes(input: string): Uint8Array {
  const clean = input.replace(/[\r\n\s]/g, "");
  if (clean.length % 4 !== 0) throw new Error("Invalid base64 length.");
  const padding = clean.endsWith("==") ? 2 : clean.endsWith("=") ? 1 : 0;
  const out = new Uint8Array((clean.length / 4) * 3 - padding);
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const a = LOOKUP[clean.charCodeAt(i)] ?? -1;
    const b = LOOKUP[clean.charCodeAt(i + 1)] ?? -1;
    const c = clean[i + 2] === "=" ? 0 : (LOOKUP[clean.charCodeAt(i + 2)] ?? -1);
    const d = clean[i + 3] === "=" ? 0 : (LOOKUP[clean.charCodeAt(i + 3)] ?? -1);
    if (a < 0 || b < 0 || c < 0 || d < 0) throw new Error("Invalid base64 character.");
    const n = (a << 18) | (b << 12) | (c << 6) | d;
    if (o < out.length) out[o++] = (n >> 16) & 0xff;
    if (o < out.length) out[o++] = (n >> 8) & 0xff;
    if (o < out.length) out[o++] = n & 0xff;
  }
  return out;
}
