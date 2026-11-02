/**
 * Contacts on Katkee: what leaves the phone. Each email and phone number in the address book is
 * normalised and hashed here, and only the hashes are sent (api/growth.ts). Names, photos, notes,
 * addresses and the numbers themselves never leave the phone.
 *
 * Normalising makes the same contact hash the same way on every phone and on the server: emails
 * are trimmed and lower-cased; phone numbers become E.164 (+<country><number>), with India (+91)
 * assumed for a number saved without a country code, since that's where Katkee launches. A number
 * we can't place (a short code, or a local number from another country with no "+") is skipped
 * rather than guessed.
 *
 * Be honest about what hashing does: the pepper below is fixed and ships in the app, so it is not
 * a secret. It stops these hashes matching other services' tables, but there are few enough phone
 * numbers that anyone holding a hash could find the number by trying them all. That is why the
 * server never keeps them (backend growth/contacts.ts) and only ever answers with accounts.
 */

/** Must equal CONTACT_HASH_PEPPER on the server and contact_match_hash() in migration 0064. */
export const CONTACT_HASH_PEPPER = "katkee-contacts-v1";
/** Where a number without a country code is assumed to be from. */
export const DEFAULT_COUNTRY_CODE = "91";
/** The server takes at most this many hashes per request. */
export const HASH_BATCH_SIZE = 500;

export function normalizeEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase();
  if (email.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return null;
  return email;
}

/** E.164, or null when the number can't be placed. */
export function normalizePhone(raw: string): string | null {
  // "+44 (0) 7700 900123": the "(0)" is a trunk prefix written for people dialling at home.
  const text = raw.trim().replace(/\(0\)/g, "");
  let digits = text.replace(/\D/g, "");
  if (!digits) return null;
  let e164: string;
  if (text.startsWith("+")) e164 = `+${digits}`;
  else if (digits.startsWith("00")) e164 = `+${digits.slice(2)}`;
  else {
    // No country code: an Indian number, written with or without the 0 in front, or with 91.
    if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
    if (digits.length === 10) e164 = `+${DEFAULT_COUNTRY_CODE}${digits}`;
    else if (digits.length === 12 && digits.startsWith(DEFAULT_COUNTRY_CODE)) e164 = `+${digits}`;
    else return null;
  }
  return /^\+[1-9]\d{7,14}$/.test(e164) ? e164 : null;
}

export function contactHash(kind: "email" | "phone", value: string): string {
  return sha256Hex(`${CONTACT_HASH_PEPPER}|${kind}|${value}`);
}

export interface DeviceContact {
  emails: string[];
  phones: string[];
}

/** Every hash for these contacts, each once. */
export function hashesForContacts(contacts: DeviceContact[]): string[] {
  const hashes = new Set<string>();
  for (const contact of contacts) {
    for (const raw of contact.emails) {
      const email = normalizeEmail(raw);
      if (email) hashes.add(contactHash("email", email));
    }
    for (const raw of contact.phones) {
      const phone = normalizePhone(raw);
      if (phone) hashes.add(contactHash("phone", phone));
    }
  }
  return [...hashes];
}

/** Splits a list into the batches the server takes. */
export function batches<T>(items: T[], size = HASH_BATCH_SIZE): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// --- SHA-256 (FIPS 180-4), in plain JavaScript: React Native has no Web Crypto. A few thousand
// short strings take well under a second. ---

const K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

function utf8(text: string): number[] {
  const bytes: number[] = [];
  for (const char of text) {
    const code = char.codePointAt(0)!;
    if (code < 0x80) bytes.push(code);
    else if (code < 0x800) bytes.push(0xc0 | (code >> 6), 0x80 | (code & 63));
    else if (code < 0x10000) bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
    else bytes.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 63), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
  }
  return bytes;
}

export function sha256Hex(text: string): string {
  const bytes = utf8(text);
  const bitLength = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  // Length in bits as a 64-bit big-endian number (the high half is 0 for anything we hash).
  bytes.push(0, 0, 0, 0, (bitLength >>> 24) & 255, (bitLength >>> 16) & 255, (bitLength >>> 8) & 255, bitLength & 255);
  const h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const w = new Array<number>(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let offset = 0; offset < bytes.length; offset += 64) {
    for (let i = 0; i < 16; i++) {
      const j = offset + i * 4;
      w[i] = ((bytes[j]! << 24) | (bytes[j + 1]! << 16) | (bytes[j + 2]! << 8) | bytes[j + 3]!) >>> 0;
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15]!, 7) ^ rotr(w[i - 15]!, 18) ^ (w[i - 15]! >>> 3);
      const s1 = rotr(w[i - 2]!, 17) ^ rotr(w[i - 2]!, 19) ^ (w[i - 2]! >>> 10);
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h as [number, number, number, number, number, number, number, number];
    for (let i = 0; i < 64; i++) {
      const t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i]! + w[i]!) >>> 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h[0] = (h[0]! + a) >>> 0; h[1] = (h[1]! + b) >>> 0; h[2] = (h[2]! + c) >>> 0; h[3] = (h[3]! + d) >>> 0;
    h[4] = (h[4]! + e) >>> 0; h[5] = (h[5]! + f) >>> 0; h[6] = (h[6]! + g) >>> 0; h[7] = (h[7]! + hh) >>> 0;
  }
  return h.map((x) => x.toString(16).padStart(8, "0")).join("");
}
