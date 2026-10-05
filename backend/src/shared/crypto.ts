import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { config } from "../config/env";

/** Purpose-separated subkeys derived from the refresh-token secret, so no secret is reused verbatim across uses. */
function subkey(purpose: string): Buffer {
  return Buffer.from(hkdfSync("sha256", config.jwt.refreshSecret, Buffer.alloc(0), `katkee:${purpose}`, 32));
}
const deviceKey = subkey("device-hash");
const codeKey = subkey("one-time-code");

export const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");

/** 256-bit random token, hex. Store only sha256() of it. */
export const opaqueToken = (): string => randomBytes(32).toString("hex");

/** Numeric one-time code (e.g. password reset), uniformly distributed. */
export function numericCode(digits = 6): string {
  return String(randomInt(0, 10 ** digits)).padStart(digits, "0");
}

/** HMAC of a short code, so a leaked table can't be brute-forced offline. */
export const codeHash = (scope: string, code: string): string => createHmac("sha256", codeKey).update(`${scope}|${code}`).digest("hex");

export function safeEqualHex(a: string, b: string): boolean {
  const left = Buffer.from(a, "hex"), right = Buffer.from(b, "hex");
  return left.length === right.length && left.length > 0 && timingSafeEqual(left, right);
}

/**
 * Keyed hash identifying a client "device" (network + user agent) without storing the IP.
 * Used for new-device sign-in alerts; it is not an authentication factor.
 */
export function deviceHash(ip: string, userAgent: string | null | undefined): string {
  // Group IPv4 by /24 and IPv6 by /48 so routine address churn on one network isn't "new".
  const network = ip.includes(":") ? ip.split(":").slice(0, 3).join(":") : ip.split(".").slice(0, 3).join(".");
  const agent = (userAgent ?? "").replace(/\/[\d.]+/g, "").slice(0, 200); // ignore version bumps
  return createHmac("sha256", deviceKey).update(`${network}|${agent}`).digest("hex");
}

export const ipHash = (ip: string): string => createHmac("sha256", deviceKey).update(`ip|${ip}`).digest("hex");

function parseKey(raw: string): Buffer {
  const key = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("Encryption key must be 32 bytes.");
  return key;
}

/** AES-256-GCM. Output: base64(iv[12] | tag[16] | ciphertext). */
export function seal(plaintext: string, rawKey: string, associatedData: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", parseKey(rawKey), iv);
  cipher.setAAD(Buffer.from(associatedData));
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64");
}

export function unseal(sealed: string, rawKey: string, associatedData: string): string {
  const data = Buffer.from(sealed, "base64");
  const decipher = createDecipheriv("aes-256-gcm", parseKey(rawKey), data.subarray(0, 12));
  decipher.setAAD(Buffer.from(associatedData));
  decipher.setAuthTag(data.subarray(12, 28));
  return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString("utf8");
}
