import { createHash, randomBytes } from "node:crypto";
import * as QRCode from "qrcode";
import type { KatkeeRequest } from "../../http/router";
import { query, queryOne } from "../../db/psql";
import { config } from "../../config/env";
import { HttpError } from "../../http/errors";
import { RateLimiter, clientIp } from "../../http/rateLimiter";
import { deviceHash, seal, unseal } from "../../shared/crypto";
import { hitSharedLimit } from "../../shared/sharedRateLimit";
import { findUserByEmail, findUserById } from "../users/users.repository";
import { verifyPassword } from "../auth/password";
import { sendEmailSafely } from "../email/email";
import { authorize, type Permission, type Principal } from "./policy";
import { generateBackupCodes, generateTotpSecret, normalizeBackupCode, otpauthUrl, verifyTotp } from "./totp";

export const adminLimiter = new RateLimiter(60000, 60);
const loginLimiter = new RateLimiter(15 * 60000, config.rateLimit.adminLoginPerIp);
export const hash = (value: string): string => createHash("sha256").update(value).digest("hex");
const MAX_CHALLENGE_ATTEMPTS = 5;

export function enabled(): void {
  if (!config.features.admin) throw new HttpError(404, "Not found.");
}
export function sameOrigin(req: KatkeeRequest): void {
  if (req.headers.origin !== config.admin.origin) throw new HttpError(403, "Invalid request origin.");
}

function device(req: KatkeeRequest): { hash: string; userAgent: string | null } {
  const userAgent = (req.headers["user-agent"] as string | undefined)?.slice(0, 300) ?? null;
  return { hash: deviceHash(clientIp(req), userAgent), userAgent };
}

async function audit(actorId: string | null, action: string, targetId: string | null, metadata: Record<string, unknown> = {}): Promise<void> {
  await query(
    `INSERT INTO admin_audit (actor_id, action, target_id, metadata)
     VALUES (NULLIF(:'actor', '')::uuid, :'action', NULLIF(:'target', '')::uuid, :'metadata'::jsonb)`,
    { actor: actorId ?? "", action, target: targetId ?? "", metadata: JSON.stringify(metadata) },
  );
}

/** Records an operational alert and emails every enabled Super Admin. Never throws. */
async function raiseSecurityAlert(kind: string, userId: string | null, metadata: Record<string, unknown>): Promise<void> {
  try {
    await query(`INSERT INTO security_alerts (kind, user_id, metadata) VALUES (:'kind', NULLIF(:'user', '')::uuid, :'metadata'::jsonb)`, {
      kind,
      user: userId ?? "",
      metadata: JSON.stringify(metadata),
    });
    const recipients = await query(
      `SELECT u.email FROM admin_grants g JOIN users u ON u.id = g.user_id
       WHERE g.role = 'SUPER_ADMIN' AND g.enabled AND u.is_active AND u.deleted_at IS NULL AND u.email IS NOT NULL`,
    );
    for (const r of recipients) {
      void sendEmailSafely({
        kind: "admin_security_alert",
        to: r.email as string,
        subject: `Katkee Admin security alert: ${kind.replace(/_/g, " ")}`,
        text: `A Katkee Admin security event needs review: ${kind}.\nOpen the Admin console → Security alerts for details. Time: ${new Date().toISOString()}`,
      });
    }
  } catch (error) {
    console.error(JSON.stringify({ event: "security_alert_failed", kind, error: error instanceof Error ? error.message : "unknown" }));
  }
}

/** The live grant for a user (used by legacy callers that only need role/permissions). */
export async function grant(userId: string): Promise<Principal | null> {
  const row = await queryOne(
    `SELECT g.role, g.permissions FROM admin_grants g JOIN users u ON u.id = g.user_id
     WHERE g.user_id = :'id' AND g.enabled AND NOT g.mfa_required AND u.is_active AND u.deleted_at IS NULL`,
    { id: userId },
  );
  return row ? { userId, role: row.role as Principal["role"], permissions: JSON.parse(row.permissions as string) as string[] } : null;
}

function sessionCookieToken(req: KatkeeRequest): string {
  return (req.headers.cookie ?? "").split(";").map((s) => s.trim()).find((s) => s.startsWith("katkee_admin="))?.slice(13) ?? "";
}

/**
 * Validates the Admin session cookie (idle + absolute expiry, MFA completed when
 * required, live grant), slides the idle timeout, and enforces CSRF/origin on writes,
 * the permission, and recent re-authentication when `recent` is set.
 */
export async function requireAdmin(req: KatkeeRequest, permission?: Permission, superOnly = false, recent = false): Promise<Principal> {
  enabled();
  const token = sessionCookieToken(req);
  if (!/^[a-f0-9]{64}$/.test(token)) throw new HttpError(401, "Admin sign-in required.");
  const tokenHash = hash(token);
  const row = await queryOne(
    `UPDATE admin_sessions s
     SET last_seen_at = now(), expires_at = LEAST(s.absolute_expires_at, now() + make_interval(mins => :'idle'))
     FROM admin_grants g, users u
     WHERE s.token_hash = :'hash' AND g.user_id = s.user_id AND u.id = s.user_id
       AND s.expires_at > now() AND s.absolute_expires_at > now()
       AND (s.mfa_verified OR NOT :'mfa_required'::boolean)
       AND g.enabled AND NOT g.mfa_required AND u.is_active AND u.deleted_at IS NULL
     RETURNING s.user_id, s.csrf_hash, s.reauthenticated_at, s.mfa_verified, g.role, g.permissions`,
    { hash: tokenHash, idle: config.admin.idleTimeoutMinutes, mfa_required: config.admin.mfaRequired },
  );
  if (!row) throw new HttpError(401, "Admin session expired.");
  const principal: Principal = {
    userId: row.user_id as string,
    role: row.role as Principal["role"],
    permissions: JSON.parse(row.permissions as string) as string[],
    sessionHash: tokenHash,
    recent: Date.now() - new Date(row.reauthenticated_at as string).getTime() < config.admin.recentAuthMinutes * 60000,
    mfaVerified: row.mfa_verified === "t",
  };
  if (req.method !== "GET") {
    sameOrigin(req);
    if (hash(String(req.headers["x-csrf-token"] ?? "")) !== row.csrf_hash) throw new HttpError(403, "Invalid CSRF token.");
    adminLimiter.check(principal.userId);
  }
  try {
    if (permission) authorize(principal, permission, superOnly);
    else if (superOnly && principal.role !== "SUPER_ADMIN") throw new HttpError(403, "Permission denied.");
    if (recent && !principal.recent) throw new HttpError(403, "Please reauthenticate before this change.");
  } catch (error) {
    console.warn(JSON.stringify({ event: "admin_authorization_denied", actor: principal.userId, permission }));
    throw error;
  }
  return principal;
}

export type AdminLoginResult =
  | { kind: "session"; token: string; csrf: string; principal: Principal }
  | { kind: "mfa"; challenge: string }
  | { kind: "enroll"; challenge: string };

async function createSession(userId: string, req: KatkeeRequest, mfaVerified: boolean): Promise<{ token: string; csrf: string; principal: Principal }> {
  const principal = await grant(userId);
  if (!principal) throw new HttpError(403, "Admin access unavailable.");
  const token = randomBytes(32).toString("hex"), csrf = randomBytes(32).toString("hex");
  const client = device(req);
  await query(
    `INSERT INTO admin_sessions (token_hash, user_id, csrf_hash, expires_at, absolute_expires_at, device_hash, user_agent, mfa_verified)
     VALUES (:'hash', :'user', :'csrf', now() + make_interval(mins => :'idle'), now() + make_interval(mins => :'absolute'), :'device', NULLIF(:'agent', ''), :'mfa'::boolean)`,
    {
      hash: hash(token), user: userId, csrf: hash(csrf), idle: config.admin.idleTimeoutMinutes,
      absolute: config.admin.absoluteTimeoutMinutes, device: client.hash, agent: client.userAgent ?? "", mfa: mfaVerified,
    },
  );
  const known = await queryOne(
    `SELECT count(*) FILTER (WHERE metadata->>'deviceHash' = :'device') AS same_device, count(*) AS total
     FROM admin_audit WHERE actor_id = :'user' AND action = 'ADMIN_LOGIN'`,
    { user: userId, device: client.hash },
  );
  await audit(userId, "ADMIN_LOGIN", userId, { deviceHash: client.hash, mfa: mfaVerified });
  if (Number(known?.total ?? 0) > 0 && Number(known?.same_device ?? 0) === 0) {
    await audit(userId, "ADMIN_LOGIN_NEW_DEVICE", userId, { deviceHash: client.hash, userAgent: client.userAgent });
    await raiseSecurityAlert("admin_login_new_device", userId, { userAgent: client.userAgent });
  }
  return { token, csrf, principal: { ...principal, mfaVerified } };
}

async function createChallenge(userId: string, purpose: "verify" | "enroll", req: KatkeeRequest): Promise<string> {
  const challenge = randomBytes(32).toString("hex");
  const client = device(req);
  await query(
    `INSERT INTO admin_login_challenges (token_hash, user_id, purpose, device_hash, user_agent)
     VALUES (:'hash', :'user', :'purpose', :'device', NULLIF(:'agent', ''))`,
    { hash: hash(challenge), user: userId, purpose, device: client.hash, agent: client.userAgent ?? "" },
  );
  return challenge;
}

/** Counts an attempt against a live challenge for the same device; returns its user. */
async function useChallenge(challenge: unknown, purpose: "verify" | "enroll", req: KatkeeRequest): Promise<string> {
  if (typeof challenge !== "string" || !/^[a-f0-9]{64}$/.test(challenge)) throw new HttpError(401, "Sign in again to continue.");
  const row = await queryOne(
    `UPDATE admin_login_challenges SET attempts = attempts + 1
     WHERE token_hash = :'hash' AND purpose = :'purpose' AND consumed_at IS NULL AND expires_at > now()
       AND attempts < :'max' AND device_hash = :'device'
     RETURNING user_id, attempts`,
    { hash: hash(challenge), purpose, max: MAX_CHALLENGE_ATTEMPTS, device: device(req).hash },
  );
  if (!row) throw new HttpError(401, "Sign-in expired or too many attempts. Sign in again.");
  if (Number(row.attempts) >= MAX_CHALLENGE_ATTEMPTS) {
    await raiseSecurityAlert("admin_mfa_attempts_exhausted", row.user_id as string, {});
  }
  return row.user_id as string;
}

async function consumeChallenge(challenge: string): Promise<void> {
  await query(`UPDATE admin_login_challenges SET consumed_at = now() WHERE token_hash = :'hash'`, { hash: hash(challenge) });
}

export async function adminLogin(req: KatkeeRequest, email: string, password: string): Promise<AdminLoginResult> {
  enabled();
  sameOrigin(req);
  loginLimiter.check(`ip:${clientIp(req)}`);
  // Shared across API instances: 10 sign-in attempts per account per 15 minutes.
  if ((await hitSharedLimit(`admin-login:${hash(email.toLowerCase())}`, 10, 900)) > 0) {
    throw new HttpError(429, "Too many sign-in attempts. Try again in 15 minutes.");
  }
  const user = await findUserByEmail(email);
  if (!user || !user.isActive || !(await verifyPassword(password, user.passwordHash))) {
    if (user) await audit(user.id, "ADMIN_LOGIN_FAILED", user.id, { deviceHash: device(req).hash, reason: "password" });
    throw new HttpError(401, "Invalid credentials.");
  }
  if (!(await grant(user.id))) throw new HttpError(403, "Admin access unavailable.");
  const mfa = await queryOne(`SELECT confirmed_at FROM admin_mfa WHERE user_id = :'id'`, { id: user.id });
  if (mfa?.confirmed_at) return { kind: "mfa", challenge: await createChallenge(user.id, "verify", req) };
  if (config.admin.mfaRequired) return { kind: "enroll", challenge: await createChallenge(user.id, "enroll", req) };
  return { kind: "session", ...(await createSession(user.id, req, false)) };
}

function mfaAssociatedData(userId: string): string {
  return `admin-totp:${userId}`;
}

async function accountLabel(userId: string): Promise<string> {
  const user = await findUserById(userId);
  return user?.email ?? user?.username ?? userId;
}

/** Step 1 of enrollment: a fresh secret (replacing any unconfirmed one) and its QR code. */
export async function startEnrollment(req: KatkeeRequest, challenge: unknown): Promise<{ secret: string; otpauthUrl: string; qrSvg: string }> {
  enabled();
  sameOrigin(req);
  const userId = await useChallenge(challenge, "enroll", req);
  const secret = generateTotpSecret();
  const updated = await queryOne(
    `INSERT INTO admin_mfa (user_id, secret_ciphertext) VALUES (:'user', :'secret')
     ON CONFLICT (user_id) DO UPDATE SET secret_ciphertext = EXCLUDED.secret_ciphertext, last_used_step = 0, updated_at = now()
     WHERE admin_mfa.confirmed_at IS NULL
     RETURNING user_id`,
    { user: userId, secret: seal(secret, config.admin.mfaEncryptionKey, mfaAssociatedData(userId)) },
  );
  if (!updated) throw new HttpError(409, "Two-step verification is already set up. Sign in again.");
  const url = otpauthUrl(secret, await accountLabel(userId));
  const qrSvg = await QRCode.toString(url, { type: "svg", errorCorrectionLevel: "M", margin: 2 });
  return { secret, otpauthUrl: url, qrSvg };
}

async function storeBackupCodes(userId: string): Promise<string[]> {
  const codes = generateBackupCodes();
  await query(
    `WITH cleared AS (DELETE FROM admin_backup_codes WHERE user_id = :'user')
     INSERT INTO admin_backup_codes (user_id, code_hash)
     SELECT :'user', value FROM jsonb_array_elements_text(:'hashes'::jsonb)`,
    { user: userId, hashes: JSON.stringify(codes.map((c) => hash(`backup:${userId}:${normalizeBackupCode(c)}`))) },
  );
  return codes;
}

async function totpMatches(userId: string, code: string, requireConfirmed: boolean): Promise<boolean> {
  const row = await queryOne(`SELECT secret_ciphertext, last_used_step, confirmed_at FROM admin_mfa WHERE user_id = :'user'`, { user: userId });
  if (!row || (requireConfirmed && !row.confirmed_at)) return false;
  const secret = unseal(row.secret_ciphertext as string, config.admin.mfaEncryptionKey, mfaAssociatedData(userId));
  const step = verifyTotp(secret, code, Number(row.last_used_step));
  if (step === null) return false;
  // Advance the replay guard atomically: two concurrent uses of one code can't both win.
  const advanced = await queryOne(
    `UPDATE admin_mfa SET last_used_step = :'step', updated_at = now() WHERE user_id = :'user' AND last_used_step < :'step' RETURNING user_id`,
    { user: userId, step },
  );
  return advanced !== null;
}

async function backupCodeMatches(userId: string, code: string): Promise<boolean> {
  const normalized = normalizeBackupCode(code);
  if (normalized.length !== 10) return false;
  const used = await queryOne(
    `UPDATE admin_backup_codes SET used_at = now() WHERE user_id = :'user' AND code_hash = :'hash' AND used_at IS NULL RETURNING user_id`,
    { user: userId, hash: hash(`backup:${userId}:${normalized}`) },
  );
  return used !== null;
}

/** Step 2 of enrollment: proves the authenticator works, then signs in and returns one-time backup codes. */
export async function confirmEnrollment(req: KatkeeRequest, challenge: unknown, code: unknown) {
  enabled();
  sameOrigin(req);
  const userId = await useChallenge(challenge, "enroll", req);
  if (typeof code !== "string" || !(await totpMatches(userId, code.trim(), false))) {
    await audit(userId, "ADMIN_MFA_FAILED", userId, { stage: "enroll" });
    throw new HttpError(401, "That code didn't match. Check your authenticator app's time and try again.");
  }
  await query(`UPDATE admin_mfa SET confirmed_at = now(), updated_at = now() WHERE user_id = :'user'`, { user: userId });
  const backupCodes = await storeBackupCodes(userId);
  await consumeChallenge(challenge as string);
  await audit(userId, "ADMIN_MFA_ENROLLED", userId);
  return { ...(await createSession(userId, req, true)), backupCodes };
}

/** Second factor at sign-in: a current TOTP code or one unused backup code. */
export async function verifyLoginMfa(req: KatkeeRequest, challenge: unknown, code: unknown, backupCode: unknown) {
  enabled();
  sameOrigin(req);
  const userId = await useChallenge(challenge, "verify", req);
  let ok = false, usedBackup = false;
  if (typeof code === "string" && code.trim()) ok = await totpMatches(userId, code.trim(), true);
  else if (typeof backupCode === "string" && backupCode.trim()) ok = usedBackup = await backupCodeMatches(userId, backupCode);
  if (!ok) {
    await audit(userId, "ADMIN_MFA_FAILED", userId, { stage: "login" });
    throw new HttpError(401, "That code didn't work. Try the current code from your authenticator app.");
  }
  await consumeChallenge(challenge as string);
  if (usedBackup) {
    const remaining = await queryOne(`SELECT count(*) AS n FROM admin_backup_codes WHERE user_id = :'user' AND used_at IS NULL`, { user: userId });
    await audit(userId, "ADMIN_BACKUP_CODE_USED", userId, { remaining: Number(remaining?.n ?? 0) });
  }
  return createSession(userId, req, true);
}

/** Step-up for critical changes: password, plus the second factor when MFA is set up. */
export async function reauthenticate(principal: Principal, password: string, code: unknown): Promise<void> {
  const user = await findUserById(principal.userId);
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    await audit(principal.userId, "ADMIN_REAUTH_FAILED", principal.userId, { reason: "password" });
    throw new HttpError(401, "Invalid credentials.");
  }
  const mfa = await queryOne(`SELECT confirmed_at FROM admin_mfa WHERE user_id = :'id'`, { id: principal.userId });
  if (mfa?.confirmed_at) {
    const ok = typeof code === "string" && ((await totpMatches(principal.userId, code.trim(), true)) || (await backupCodeMatches(principal.userId, code)));
    if (!ok) {
      await audit(principal.userId, "ADMIN_REAUTH_FAILED", principal.userId, { reason: "mfa" });
      throw new HttpError(401, "Enter the current code from your authenticator app.");
    }
  }
  await query(`UPDATE admin_sessions SET reauthenticated_at = now() WHERE token_hash = :'hash'`, { hash: principal.sessionHash ?? "" });
  await audit(principal.userId, "ADMIN_REAUTHENTICATED", principal.userId);
}

export async function regenerateBackupCodes(principal: Principal): Promise<string[]> {
  const mfa = await queryOne(`SELECT confirmed_at FROM admin_mfa WHERE user_id = :'id'`, { id: principal.userId });
  if (!mfa?.confirmed_at) throw new HttpError(409, "Set up two-step verification first.");
  const codes = await storeBackupCodes(principal.userId);
  await audit(principal.userId, "ADMIN_BACKUP_CODES_REGENERATED", principal.userId);
  return codes;
}

/** Super Admin recovery for another admin who lost their authenticator: they must enroll again. */
export async function resetAdminMfa(principal: Principal, targetUserId: string): Promise<void> {
  if (targetUserId === principal.userId) throw new HttpError(403, "You cannot reset your own two-step verification.");
  const target = await grant(targetUserId);
  if (!target) throw new HttpError(404, "Admin not found.");
  await query(
    `WITH m AS (DELETE FROM admin_mfa WHERE user_id = :'user'), b AS (DELETE FROM admin_backup_codes WHERE user_id = :'user')
     DELETE FROM admin_sessions WHERE user_id = :'user'`,
    { user: targetUserId },
  );
  await audit(principal.userId, "ADMIN_MFA_RESET", targetUserId);
  await raiseSecurityAlert("admin_mfa_reset", targetUserId, { by: principal.userId });
}

/** Absolute lifetime: the server enforces the shorter idle timeout itself. */
export function cookie(token: string, maxAge = config.admin.absoluteTimeoutMinutes * 60): string {
  return `katkee_admin=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${config.admin.origin.startsWith("https:") ? "; Secure" : ""}`;
}
