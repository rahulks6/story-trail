import assert from "node:assert/strict";
import { totp } from "../src/modules/admin/totp";

export const ADMIN_ORIGIN = "http://admin.test";

/** What a real authenticator app would hold, per admin email, after enrollment in a test. */
const enrolled = new Map<string, { secret: string; backupCodes: string[] }>();

async function post(base: string, path: string, body: unknown): Promise<{ status: number; body: any; cookie: string }> {
  const r = await fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json", Origin: ADMIN_ORIGIN }, body: JSON.stringify(body) });
  return { status: r.status, body: r.status === 204 ? null : ((await r.json()) as any), cookie: r.headers.get("set-cookie")?.split(";")[0] ?? "" };
}

export interface AdminHeaders extends Record<string, string> {
  Cookie: string;
  Origin: string;
  "X-CSRF-Token": string;
}

/**
 * Signs an admin in through the real flow: password, then TOTP enrollment the first
 * time, or a second factor afterwards. Repeat sign-ins use one-time backup codes,
 * because replay protection correctly rejects reusing a TOTP code within its 30 s step.
 */
export async function adminSignIn(base: string, email: string, password: string): Promise<AdminHeaders> {
  const first = await post(base, "/api/v1/admin/login", { email, password });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  let session = first;
  if (first.body.mfaEnrollmentRequired) {
    const enroll = await post(base, "/api/v1/admin/mfa/enroll", { challenge: first.body.challenge });
    assert.equal(enroll.status, 200, JSON.stringify(enroll.body));
    assert.match(enroll.body.otpauthUrl, /^otpauth:\/\/totp\/Katkee%20Admin/);
    assert.match(enroll.body.qrSvg, /^<svg/);
    session = await post(base, "/api/v1/admin/mfa/enroll/confirm", { challenge: first.body.challenge, code: totp(enroll.body.secret) });
    assert.equal(session.status, 200, JSON.stringify(session.body));
    assert.equal(session.body.backupCodes.length, 10);
    enrolled.set(email, { secret: enroll.body.secret, backupCodes: [...session.body.backupCodes] });
  } else if (first.body.mfaRequired) {
    const keys = enrolled.get(email);
    assert.ok(keys, "test admin signed in with MFA before enrolling through adminSignIn");
    session = await post(base, "/api/v1/admin/login/mfa", { challenge: first.body.challenge, backupCode: keys.backupCodes.shift() });
    assert.equal(session.status, 200, JSON.stringify(session.body));
  }
  assert.match(session.cookie, /katkee_admin=/);
  return { Cookie: session.cookie, Origin: ADMIN_ORIGIN, "X-CSRF-Token": session.body.csrf as string };
}

/** A fresh second factor for step-up re-authentication (consumes one backup code). */
export function nextSecondFactor(email: string): string {
  const keys = enrolled.get(email);
  assert.ok(keys && keys.backupCodes.length, "no enrolled test admin for " + email);
  return keys.backupCodes.shift()!;
}

export function enrolledSecret(email: string): string {
  const keys = enrolled.get(email);
  assert.ok(keys, "no enrolled test admin for " + email);
  return keys.secret;
}
