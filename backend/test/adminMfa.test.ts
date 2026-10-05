import "./admin-env";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { buildApp } from "../src/app";
import { query, queryOne } from "../src/db/psql";
import { base32Decode, base32Encode, hotp, totp, totpStep, verifyTotp } from "../src/modules/admin/totp";
import { emailProvider, MemoryEmailProvider } from "../src/modules/email/email";
import { ADMIN_ORIGIN, adminSignIn, enrolledSecret, nextSecondFactor } from "./adminSession";

const server = buildApp();
let base = "";
const outbox = (emailProvider as MemoryEmailProvider).outbox;

before(async () => {
  await new Promise<void>((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const r = await fetch(base + path, { method, headers: { "Content-Type": "application/json", ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const text = await r.text();
  return { status: r.status, body: text ? JSON.parse(text) : undefined, cookie: r.headers.get("set-cookie")?.split(";")[0] ?? "" };
}

async function account(role?: "ADMIN" | "SUPER_ADMIN", permissions: string[] = ["reports.read", "audit.read"]) {
  const tag = randomUUID().slice(0, 8);
  const input = { email: `mfa_${tag}@example.com`, username: `mfa_${tag}`, password: "correcthorsebattery", displayName: "Operator" };
  const r = await call("POST", "/api/v1/auth/signup", input);
  assert.equal(r.status, 201);
  if (role) await query(`INSERT INTO admin_grants(user_id, role, permissions) VALUES (:'id', :'role', :'p'::jsonb)`, { id: r.body.user.id, role, p: JSON.stringify(permissions) });
  return { id: r.body.user.id as string, input };
}

const origin = { Origin: ADMIN_ORIGIN };

describe("TOTP (RFC 6238)", () => {
  it("matches the RFC 6238 Appendix B SHA-1 test vectors", () => {
    const secret = Buffer.from("12345678901234567890");
    const vectors: Array<[number, string]> = [
      [59, "94287082"], [1111111109, "07081804"], [1111111111, "14050471"],
      [1234567890, "89005924"], [2000000000, "69279037"], [20000000000, "65353130"],
    ];
    for (const [seconds, expected] of vectors) assert.equal(hotp(secret, Math.floor(seconds / 30), 8), expected, `T=${seconds}`);
  });

  it("round-trips base32 and accepts one step of drift but never a replayed step", () => {
    const secret = base32Encode(Buffer.from("katkee-totp-secret!!"));
    assert.equal(base32Decode(secret).toString(), "katkee-totp-secret!!");
    const now = Date.now();
    const code = totp(secret, now);
    const step = totpStep(now);
    assert.equal(verifyTotp(secret, code, 0, now), step);
    assert.equal(verifyTotp(secret, totp(secret, now - 30000), 0, now), step - 1, "previous step accepted");
    assert.equal(verifyTotp(secret, totp(secret, now - 90000), 0, now), null, "older codes rejected");
    assert.equal(verifyTotp(secret, code, step, now), null, "replay of the last used step rejected");
    assert.equal(verifyTotp(secret, "12345", 0, now), null);
  });
});

describe("admin sign-in with two-step verification", () => {
  it("issues no session until an authenticator is enrolled and proven", async () => {
    const admin = await account("ADMIN");
    const login = await call("POST", "/api/v1/admin/login", { email: admin.input.email, password: admin.input.password }, origin);
    assert.equal(login.status, 200);
    assert.equal(login.body.mfaEnrollmentRequired, true);
    assert.equal(login.cookie, "", "no session cookie before the second factor");
    const enroll = await call("POST", "/api/v1/admin/mfa/enroll", { challenge: login.body.challenge }, origin);
    assert.equal(enroll.status, 200);
    assert.match(enroll.body.qrSvg, /^<svg/);
    const stored = await queryOne(`SELECT secret_ciphertext FROM admin_mfa WHERE user_id = :'id'`, { id: admin.id });
    assert.ok(stored && !stored.secret_ciphertext!.includes(enroll.body.secret), "the secret is encrypted at rest");
    const wrong = await call("POST", "/api/v1/admin/mfa/enroll/confirm", { challenge: login.body.challenge, code: "000000" === totp(enroll.body.secret) ? "111111" : "000000" }, origin);
    assert.equal(wrong.status, 401);
    const confirmed = await call("POST", "/api/v1/admin/mfa/enroll/confirm", { challenge: login.body.challenge, code: totp(enroll.body.secret) }, origin);
    assert.equal(confirmed.status, 200);
    assert.equal(confirmed.body.backupCodes.length, 10);
    assert.match(confirmed.cookie, /katkee_admin=/);
    const headers = { Cookie: confirmed.cookie, ...origin, "X-CSRF-Token": confirmed.body.csrf };
    const session = await call("GET", "/api/v1/admin/session", undefined, headers);
    assert.equal(session.status, 200);
    assert.equal(session.body.principal.mfaVerified, true);
    // A reused enrollment challenge is dead.
    assert.equal((await call("POST", "/api/v1/admin/mfa/enroll", { challenge: login.body.challenge }, origin)).status, 401);
  });

  it("requires a fresh code on later sign-ins; backup codes work exactly once", async () => {
    const admin = await account("ADMIN");
    await adminSignIn(base, admin.input.email, admin.input.password);
    const secret = enrolledSecret(admin.input.email);
    const second = await call("POST", "/api/v1/admin/login", { email: admin.input.email, password: admin.input.password }, origin);
    assert.equal(second.body.mfaRequired, true);
    // The enrollment already used the current step: replaying it fails.
    const replay = await call("POST", "/api/v1/admin/login/mfa", { challenge: second.body.challenge, code: totp(secret) }, origin);
    assert.equal(replay.status, 401, "a TOTP code can't be used twice");
    const backup = nextSecondFactor(admin.input.email);
    assert.equal((await call("POST", "/api/v1/admin/login/mfa", { challenge: second.body.challenge, backupCode: backup }, origin)).status, 200);
    const third = await call("POST", "/api/v1/admin/login", { email: admin.input.email, password: admin.input.password }, origin);
    assert.equal((await call("POST", "/api/v1/admin/login/mfa", { challenge: third.body.challenge, backupCode: backup }, origin)).status, 401, "backup codes are single-use");
    const audit = await queryOne(`SELECT count(*) AS n FROM admin_audit WHERE actor_id = :'id' AND action = 'ADMIN_BACKUP_CODE_USED'`, { id: admin.id });
    assert.equal(audit?.n, "1");
  });

  it("binds a challenge to the device and stops after 5 attempts with an alert", async () => {
    const admin = await account("ADMIN");
    await adminSignIn(base, admin.input.email, admin.input.password);
    const login = await call("POST", "/api/v1/admin/login", { email: admin.input.email, password: admin.input.password }, { ...origin, "User-Agent": "Browser A" });
    const elsewhere = await call("POST", "/api/v1/admin/login/mfa", { challenge: login.body.challenge, backupCode: "AAAAA-AAAAA" }, { ...origin, "User-Agent": "Browser B" });
    assert.equal(elsewhere.status, 401, "a stolen challenge is useless on another device");
    for (let i = 0; i < 5; i++) {
      await call("POST", "/api/v1/admin/login/mfa", { challenge: login.body.challenge, backupCode: "AAAAA-AAAAA" }, { ...origin, "User-Agent": "Browser A" });
    }
    const valid = nextSecondFactor(admin.input.email);
    const afterLock = await call("POST", "/api/v1/admin/login/mfa", { challenge: login.body.challenge, backupCode: valid }, { ...origin, "User-Agent": "Browser A" });
    assert.equal(afterLock.status, 401, "the challenge is exhausted even for a valid code");
    const alert = await queryOne(`SELECT count(*) AS n FROM security_alerts WHERE user_id = :'id' AND kind = 'admin_mfa_attempts_exhausted'`, { id: admin.id });
    assert.equal(alert?.n, "1");
  });

  it("enforces idle and absolute session expiry", async () => {
    const admin = await account("ADMIN");
    const headers = await adminSignIn(base, admin.input.email, admin.input.password);
    assert.equal((await call("GET", "/api/v1/admin/session", undefined, headers)).status, 200);
    await query(`UPDATE admin_sessions SET expires_at = now() - interval '1 second' WHERE user_id = :'id'`, { id: admin.id });
    assert.equal((await call("GET", "/api/v1/admin/session", undefined, headers)).status, 401, "idle timeout");
    const fresh = await adminSignIn(base, admin.input.email, admin.input.password);
    await query(`UPDATE admin_sessions SET absolute_expires_at = now() - interval '1 second' WHERE user_id = :'id'`, { id: admin.id });
    assert.equal((await call("GET", "/api/v1/admin/session", undefined, fresh)).status, 401, "absolute lifetime");
  });

  it("step-up re-authentication needs password and second factor", async () => {
    const admin = await account("ADMIN");
    const headers = await adminSignIn(base, admin.input.email, admin.input.password);
    await query(`UPDATE admin_sessions SET reauthenticated_at = now() - interval '1 hour' WHERE user_id = :'id'`, { id: admin.id });
    const moderate = await call("POST", "/api/v1/admin/moderate", { targetType: "user", targetId: randomUUID(), action: "restrict", reason: "test", confirmed: true }, headers);
    assert.equal(moderate.status, 403, "critical actions need recent re-authentication");
    assert.equal((await call("POST", "/api/v1/admin/reauthenticate", { password: admin.input.password }, headers)).status, 401);
    assert.equal((await call("POST", "/api/v1/admin/reauthenticate", { password: "wrong password!", code: nextSecondFactor(admin.input.email) }, headers)).status, 401);
    assert.equal((await call("POST", "/api/v1/admin/reauthenticate", { password: admin.input.password, code: nextSecondFactor(admin.input.email) }, headers)).status, 204);
  });

  it("a Super Admin can reset another admin's MFA (forcing re-enrollment) but not their own; admins cannot", async () => {
    const superAdmin = await account("SUPER_ADMIN", []);
    const admin = await account("ADMIN", ["reports.read", "admins.update"]);
    const sh = await adminSignIn(base, superAdmin.input.email, superAdmin.input.password);
    const ah = await adminSignIn(base, admin.input.email, admin.input.password);
    assert.equal((await call("POST", `/api/v1/admin/admins/${superAdmin.id}/mfa-reset`, { confirmed: true }, ah)).status, 403);
    assert.equal((await call("POST", `/api/v1/admin/admins/${superAdmin.id}/mfa-reset`, { confirmed: true }, sh)).status, 403, "not your own");
    assert.equal((await call("POST", `/api/v1/admin/admins/${admin.id}/mfa-reset`, { confirmed: true }, sh)).status, 204);
    assert.equal((await call("GET", "/api/v1/admin/session", undefined, ah)).status, 401, "their sessions end");
    const again = await call("POST", "/api/v1/admin/login", { email: admin.input.email, password: admin.input.password }, origin);
    assert.equal(again.body.mfaEnrollmentRequired, true);
  });

  it("raises a Super Admin alert and email for a new-device admin sign-in", async () => {
    const superAdmin = await account("SUPER_ADMIN", []);
    const admin = await account("ADMIN");
    const sh = await adminSignIn(base, superAdmin.input.email, superAdmin.input.password);
    await adminSignIn(base, admin.input.email, admin.input.password);
    const before = outbox.filter((m) => m.kind === "admin_security_alert" && m.to === superAdmin.input.email).length;
    const login = await call("POST", "/api/v1/admin/login", { email: admin.input.email, password: admin.input.password }, { ...origin, "User-Agent": "Unfamiliar Browser" });
    const signedIn = await call("POST", "/api/v1/admin/login/mfa", { challenge: login.body.challenge, backupCode: nextSecondFactor(admin.input.email) }, { ...origin, "User-Agent": "Unfamiliar Browser" });
    assert.equal(signedIn.status, 200);
    assert.ok(outbox.filter((m) => m.kind === "admin_security_alert" && m.to === superAdmin.input.email).length > before);
    const alerts = await call("GET", "/api/v1/admin/security-alerts", undefined, sh);
    const alert = alerts.body.items.find((a: any) => a.kind === "admin_login_new_device" && a.user_id === admin.id);
    assert.ok(alert);
    assert.equal((await call("POST", `/api/v1/admin/security-alerts/${alert.id}/acknowledge`, { confirmed: true }, sh)).status, 200);
    const plainAdmin = await adminSignIn(base, admin.input.email, admin.input.password);
    assert.equal((await call("GET", "/api/v1/admin/security-alerts", undefined, plainAdmin)).status, 403, "needs security.alerts.read");
  });
});

describe("audit log", () => {
  it("filters by action prefix and actor", async () => {
    const admin = await account("ADMIN");
    const headers = await adminSignIn(base, admin.input.email, admin.input.password);
    const byActor = await call("GET", `/api/v1/admin/audit?actor=${admin.id}`, undefined, headers);
    assert.equal(byActor.status, 200);
    assert.ok(byActor.body.items.length >= 2);
    assert.ok(byActor.body.items.every((i: any) => i.actor_id === admin.id));
    const enrolled = await call("GET", `/api/v1/admin/audit?actor=${admin.id}&action=ADMIN_MFA`, undefined, headers);
    assert.deepEqual(enrolled.body.items.map((i: any) => i.action), ["ADMIN_MFA_ENROLLED"]);
    assert.equal((await call("GET", "/api/v1/admin/audit?action=drop%20table", undefined, headers)).status, 422);
  });

  it("is append-only, hash-chained, and detects tampering", async () => {
    const admin = await account("ADMIN");
    const headers = await adminSignIn(base, admin.input.email, admin.input.password);
    await assert.rejects(query(`UPDATE admin_audit SET action = action WHERE false`));
    await assert.rejects(query(`DELETE FROM admin_audit WHERE false`));
    await assert.rejects(query(`TRUNCATE admin_audit`));
    const intact = await call("GET", "/api/v1/admin/audit/verify", undefined, headers);
    assert.equal(intact.status, 200);
    assert.equal(intact.body.intact, true, JSON.stringify(intact.body));
    assert.match(intact.body.headHash, /^[0-9a-f]{64}$/);

    // Simulate a privileged attacker who can bypass the trigger (the schema owner).
    const victim = await queryOne(`SELECT id FROM admin_audit WHERE actor_id = :'id' ORDER BY chain_seq LIMIT 1`, { id: admin.id });
    await query(`ALTER TABLE admin_audit DISABLE TRIGGER admin_audit_immutable`);
    try {
      await query(`UPDATE admin_audit SET metadata = '{"edited":true}' WHERE id = :'id'`, { id: victim!.id! });
    } finally {
      await query(`ALTER TABLE admin_audit ENABLE TRIGGER admin_audit_immutable`);
    }
    const tampered = await call("GET", "/api/v1/admin/audit/verify", undefined, headers);
    assert.equal(tampered.body.intact, false);
    assert.equal(tampered.body.firstProblem.id, victim!.id);
    assert.equal(tampered.body.firstProblem.problem, "row content changed");
  });
});
