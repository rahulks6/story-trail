import { query, queryOne } from "../../db/psql";
import { config } from "../../config/env";
import { codeHash, deviceHash, numericCode, safeEqualHex } from "../../shared/crypto";
import { hitSharedLimit } from "../../shared/sharedRateLimit";
import { sendEmailSafely } from "../email/email";
import { HttpError } from "../../http/errors";

export type SecurityEventKind =
  | "login_succeeded"
  | "login_failed"
  | "login_new_device"
  | "login_locked"
  | "password_reset_requested"
  | "password_reset_completed"
  | "password_changed"
  | "session_revoked"
  | "sessions_revoked";

export interface ClientContext {
  ip: string;
  userAgent: string | null;
}

export async function recordSecurityEvent(userId: string, kind: SecurityEventKind, client?: ClientContext): Promise<void> {
  await query(
    `INSERT INTO auth_security_events (user_id, kind, device_hash, user_agent)
     VALUES (:'user_id', :'kind', NULLIF(:'device', ''), NULLIF(:'agent', ''))`,
    {
      user_id: userId,
      kind,
      device: client ? deviceHash(client.ip, client.userAgent) : "",
      agent: client?.userAgent?.slice(0, 300) ?? "",
    },
  );
}

/** Failed sign-ins per account, shared by all API instances. */
export const LOGIN_MAX_FAILURES = 10;
export const LOGIN_FAILURE_WINDOW_SECONDS = 15 * 60;

/**
 * Called before checking a password. A locked account answers exactly like a wrong
 * password would have (no "this account exists" signal) except for the retry hint.
 */
export async function assertLoginAllowed(userId: string): Promise<void> {
  const row = await queryOne(
    `SELECT hits, window_started_at > now() - make_interval(secs => :'window') AS current
     FROM rate_limit_buckets WHERE key = :'key'`,
    { key: `login-fail:${userId}`, window: LOGIN_FAILURE_WINDOW_SECONDS },
  );
  if (row && row.current === "t" && Number(row.hits) >= LOGIN_MAX_FAILURES) {
    throw new HttpError(429, "Too many sign-in attempts. Try again in 15 minutes or reset your password.");
  }
}

export async function recordLoginFailure(userId: string, client: ClientContext): Promise<void> {
  const wait = await hitSharedLimit(`login-fail:${userId}`, LOGIN_MAX_FAILURES - 1, LOGIN_FAILURE_WINDOW_SECONDS);
  await recordSecurityEvent(userId, wait > 0 ? "login_locked" : "login_failed", client);
}

/**
 * Records the sign-in and, when this device/network has never signed in to the account
 * before (and the account has history), emails an alert. Never blocks the sign-in.
 */
export async function recordLoginSuccess(userId: string, email: string | null, client: ClientContext): Promise<{ newDevice: boolean }> {
  const device = deviceHash(client.ip, client.userAgent);
  const history = await queryOne(
    `SELECT count(*) FILTER (WHERE device_hash = :'device') AS same_device, count(*) AS total
     FROM auth_security_events WHERE user_id = :'user_id' AND kind = 'login_succeeded'`,
    { user_id: userId, device },
  );
  await recordSecurityEvent(userId, "login_succeeded", client);
  // Successful sign-in clears the failure budget.
  await query(`DELETE FROM rate_limit_buckets WHERE key = :'key'`, { key: `login-fail:${userId}` });
  const newDevice = Number(history?.total ?? 0) > 0 && Number(history?.same_device ?? 0) === 0;
  if (newDevice) {
    await recordSecurityEvent(userId, "login_new_device", client);
    if (email) {
      void sendEmailSafely({
        kind: "new_device_login",
        to: email,
        subject: "New sign-in to your Katkee account",
        text:
          `Your Katkee account was just signed in on a new device${client.userAgent ? ` (${client.userAgent.slice(0, 120)})` : ""}.\n\n` +
          "If this was you, there's nothing to do.\n" +
          "If it wasn't, open Katkee → Profile → Settings → Account security, choose \"Sign out of all devices\", and reset your password.",
      });
    }
  }
  return { newDevice };
}

export const RESET_CODE_DIGITS = 6;
export const RESET_MAX_ATTEMPTS = 5;

/**
 * Starts a password reset. Always resolves the same way whether or not the account
 * exists. Only the newest request per account is usable.
 */
export async function requestPasswordReset(email: string, client: ClientContext): Promise<void> {
  const user = await queryOne(
    `SELECT id, email FROM users WHERE email = :'email' AND deleted_at IS NULL AND is_active AND password_hash IS NOT NULL`,
    { email },
  );
  if (!user) return;
  // 3 emails per account per hour: bounds abuse of the mail channel.
  if ((await hitSharedLimit(`reset-send:${user.id}`, 3, 3600)) > 0) return;
  const code = numericCode(RESET_CODE_DIGITS);
  await query(
    `WITH superseded AS (
       UPDATE password_reset_requests SET consumed_at = now() WHERE user_id = :'user_id' AND consumed_at IS NULL
     )
     INSERT INTO password_reset_requests (user_id, code_hash) VALUES (:'user_id', :'hash')`,
    { user_id: user.id as string, hash: codeHash(`reset:${user.id}`, code) },
  );
  await recordSecurityEvent(user.id as string, "password_reset_requested", client);
  const link = `${config.appLinks.passwordReset}?email=${encodeURIComponent(user.email as string)}&code=${code}`;
  await sendEmailSafely({
    kind: "password_reset",
    to: user.email as string,
    subject: `${code} is your Katkee password reset code`,
    text:
      `Your Katkee password reset code is ${code}. It expires in 15 minutes.\n\n` +
      `Open this link on your phone to continue: ${link}\n\n` +
      "If you didn't ask to reset your password, you can ignore this email — your password won't change.",
  });
}

/**
 * Verifies the newest reset code for the account and consumes it. Wrong codes count
 * against the request; after 5, the request is dead and a new code is needed.
 * Returns the user id when the code is valid.
 */
export async function consumePasswordResetCode(email: string, code: string): Promise<string> {
  const invalid = new HttpError(400, "That code is incorrect or has expired. Request a new code and try again.");
  const request = await queryOne(
    `SELECT r.id, r.user_id, r.code_hash, r.attempts
     FROM password_reset_requests r JOIN users u ON u.id = r.user_id
     WHERE u.email = :'email' AND u.deleted_at IS NULL AND u.is_active
       AND r.consumed_at IS NULL AND r.expires_at > now()
     ORDER BY r.created_at DESC LIMIT 1`,
    { email },
  );
  if (!request || Number(request.attempts) >= RESET_MAX_ATTEMPTS) throw invalid;
  const expected = request.code_hash as string;
  if (!safeEqualHex(codeHash(`reset:${request.user_id}`, code), expected)) {
    await query(
      `UPDATE password_reset_requests SET attempts = attempts + 1,
         consumed_at = CASE WHEN attempts + 1 >= :'max' THEN now() ELSE consumed_at END
       WHERE id = :'id'`,
      { id: request.id as string, max: RESET_MAX_ATTEMPTS },
    );
    throw invalid;
  }
  // Single use, even under concurrent submissions of the same code.
  const consumed = await queryOne(
    `UPDATE password_reset_requests SET consumed_at = now() WHERE id = :'id' AND consumed_at IS NULL RETURNING user_id`,
    { id: request.id as string },
  );
  if (!consumed) throw invalid;
  return consumed.user_id as string;
}

/**
 * Applies a new password hash and invalidates every existing session (refresh tokens
 * and, through sessions_revoked_at, already-issued access tokens).
 */
export async function setPasswordAndRevokeSessions(userId: string, passwordHash: string): Promise<void> {
  // Every live sign-in is ended explicitly (revoked_sessions), so its access token stops
  // on the next request even if it was issued within the same second as this change;
  // sessions_revoked_at additionally covers tokens minted before sessions existed.
  await query(
    `WITH changed AS (
       UPDATE users SET password_hash = :'hash', password_changed_at = now(), sessions_revoked_at = now()
       WHERE id = :'user_id' AND deleted_at IS NULL RETURNING id
     ), live AS (
       SELECT DISTINCT session_id, user_id FROM refresh_tokens
       WHERE user_id IN (SELECT id FROM changed) AND expires_at > now()
     ), ended AS (
       UPDATE refresh_tokens SET revoked_at = now()
       WHERE user_id IN (SELECT id FROM changed) AND revoked_at IS NULL
     )
     INSERT INTO revoked_sessions (session_id, user_id)
     SELECT session_id, user_id FROM live
     ON CONFLICT (session_id) DO NOTHING`,
    { user_id: userId, hash: passwordHash },
  );
}

export interface SecurityEventView {
  kind: SecurityEventKind;
  userAgent: string | null;
  createdAt: string;
}

export async function listSecurityEvents(userId: string): Promise<SecurityEventView[]> {
  const rows = await query(
    `SELECT kind, user_agent, created_at FROM auth_security_events
     WHERE user_id = :'user_id' ORDER BY created_at DESC LIMIT 50`,
    { user_id: userId },
  );
  return rows.map((r) => ({ kind: r.kind as SecurityEventKind, userAgent: r.user_agent ?? null, createdAt: r.created_at as string }));
}
