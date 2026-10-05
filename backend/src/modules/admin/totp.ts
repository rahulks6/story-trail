/**
 * RFC 6238 TOTP (HMAC-SHA1, 30-second steps, 6 digits) — the profile every
 * authenticator app supports. Implemented on node:crypto; verified against the
 * RFC 6238 Appendix B test vectors in test/adminMfa.test.ts.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export const TOTP_STEP_SECONDS = 30;
export const TOTP_DIGITS = 6;

export function base32Encode(data: Buffer): string {
  let bits = 0, value = 0, out = "";
  for (const byte of data) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  const clean = text.toUpperCase().replace(/=+$/, "").replace(/\s+/g, "");
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const index = BASE32.indexOf(char);
    if (index < 0) throw new Error("Invalid base32 secret");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** 160-bit secret, the RFC 4226 recommended length for HMAC-SHA1. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function hotp(secret: Buffer, counter: number, digits = TOTP_DIGITS): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", secret).update(message).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary = (digest.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits;
  return String(binary).padStart(digits, "0");
}

export function totpStep(atMs = Date.now()): number {
  return Math.floor(atMs / 1000 / TOTP_STEP_SECONDS);
}

export function totp(secretBase32: string, atMs = Date.now()): string {
  return hotp(base32Decode(secretBase32), totpStep(atMs));
}

/**
 * Returns the matching time step (to store as last-used and block replay), or null.
 * Accepts one step of clock drift either side. Steps at or before `lastUsedStep`
 * are rejected, so an observed code can't be replayed within its validity window.
 */
export function verifyTotp(secretBase32: string, code: string, lastUsedStep: number, atMs = Date.now()): number | null {
  if (!/^[0-9]{6}$/.test(code)) return null;
  const secret = base32Decode(secretBase32);
  const current = totpStep(atMs);
  const given = Buffer.from(code);
  let matched: number | null = null;
  for (const step of [current - 1, current, current + 1]) {
    const expected = Buffer.from(hotp(secret, step));
    // Compare every candidate (no early exit) so timing doesn't reveal which step matched.
    if (timingSafeEqual(expected, given) && step > lastUsedStep) matched = step;
  }
  return matched;
}

export function otpauthUrl(secretBase32: string, accountLabel: string, issuer = "Katkee Admin"): string {
  const label = encodeURIComponent(`${issuer}:${accountLabel}`);
  return `otpauth://totp/${label}?secret=${secretBase32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${TOTP_STEP_SECONDS}`;
}

/** 10 one-time recovery codes, 10 base32 characters (50 bits) each, shown as XXXXX-XXXXX. */
export function generateBackupCodes(count = 10): string[] {
  return Array.from({ length: count }, () => {
    const raw = base32Encode(randomBytes(7)).slice(0, 10);
    return `${raw.slice(0, 5)}-${raw.slice(5)}`;
  });
}

export function normalizeBackupCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z2-7]/g, "");
}
