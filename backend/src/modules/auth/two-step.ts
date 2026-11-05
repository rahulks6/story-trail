/**
 * Two-step login (Profile > Settings > Account and sign-in): after the password, or after Google,
 * Apple or a phone code, a 6-digit code from an authenticator app, or one of ten one-time backup
 * codes. Turned on and off only after "Confirm it's you" (a reauth ticket). The secret is sealed
 * with the MFA key like the admin console's (admin/security.ts); a code's time step is never
 * accepted twice, and a challenge allows five tries in five minutes.
 */
import { createHash, randomBytes } from "node:crypto";
import { config } from "../../config/env";
import { query, queryOne } from "../../db/psql";
import { HttpError } from "../../http/errors";
import { seal, unseal } from "../../shared/crypto";
import { generateBackupCodes, generateTotpSecret, normalizeBackupCode, otpauthUrl, verifyTotp } from "../admin/totp";
import { qrRows } from "../admin/security";
import { findUserById } from "../users/users.repository";
import { recordLoginSuccess, recordSecurityEvent, type ClientContext } from "./account-security";
import { getPublicUserById, issueTokenPair, type PublicUser, type TokenPair } from "./auth.service";

export const CHALLENGE_SECONDS = 300;
export const CHALLENGE_ATTEMPTS = 5;
export const BACKUP_CODES = 10;

const sha = (v: string) => createHash("sha256").update(v).digest("hex");
const associated = (userId: string) => `user-totp:${userId}`;

function key(): string {
  if (!config.admin.mfaEncryptionKey) throw new HttpError(503, "Two-step login isn't available right now.");
  return config.admin.mfaEncryptionKey;
}

/** Whether this account asks for a code at sign-in. */
export async function twoStepEnabled(userId: string): Promise<boolean> {
  return !!(await queryOne(`SELECT 1 AS on FROM user_mfa WHERE user_id = :'id' AND confirmed_at IS NOT NULL`, { id: userId }));
}

export type SignInResult = { user: PublicUser; tokens: TokenPair } | { twoStepRequired: true; challenge: string; expiresIn: number };

/**
 * The end of every sign-in (password, Google, Apple, phone): tokens at once, or, with two-step
 * login on, a challenge to answer with a code. Called after the first step has fully succeeded.
 */
export async function finishSignIn(userId: string, client: ClientContext, finish: () => Promise<{ user: PublicUser; tokens: TokenPair }>): Promise<SignInResult> {
  if (!(await twoStepEnabled(userId))) return finish();
  const challenge = randomBytes(32).toString("hex");
  await query(
    `INSERT INTO auth_two_step_challenges (token_hash, user_id, expires_at) VALUES (:'hash', :'user', now() + make_interval(secs => :'secs'::integer))`,
    { hash: sha(challenge), user: userId, secs: CHALLENGE_SECONDS },
  );
  console.info(JSON.stringify({ event: "two_step_challenged" }));
  void client;
  return { twoStepRequired: true, challenge, expiresIn: CHALLENGE_SECONDS };
}

/** A code from the authenticator app (6 digits) or a backup code: true when it's right, once. */
async function acceptCode(userId: string, code: string): Promise<boolean> {
  const digits = code.replace(/\s+/g, "");
  if (/^\d{6}$/.test(digits)) {
    const row = await queryOne(`SELECT secret_ciphertext, last_used_step FROM user_mfa WHERE user_id = :'id' AND confirmed_at IS NOT NULL`, { id: userId });
    if (!row) return false;
    const step = verifyTotp(unseal(row.secret_ciphertext as string, key(), associated(userId)), digits, Number(row.last_used_step));
    if (step === null) return false;
    // A step can only be used once, even by two requests at the same moment.
    return !!(await queryOne(`UPDATE user_mfa SET last_used_step = :'step', updated_at = now() WHERE user_id = :'id' AND last_used_step < :'step' RETURNING user_id`, { id: userId, step }));
  }
  const backup = normalizeBackupCode(code);
  if (backup.length !== 10) return false;
  return !!(await queryOne(
    `UPDATE user_mfa_backup_codes SET used_at = now() WHERE user_id = :'id' AND code_hash = :'hash' AND used_at IS NULL RETURNING user_id`,
    { id: userId, hash: sha(`${userId}:${backup}`) },
  ));
}

/** The second step: the challenge from sign-in and a code. Signs in, or says the code was wrong. */
export async function answerChallenge(challenge: unknown, code: unknown, client: ClientContext): Promise<{ user: PublicUser; tokens: TokenPair }> {
  if (typeof challenge !== "string" || !/^[a-f0-9]{64}$/.test(challenge) || typeof code !== "string" || code.length > 32) {
    throw new HttpError(401, "Sign in again.");
  }
  const row = await queryOne(
    `UPDATE auth_two_step_challenges SET attempts = attempts + 1
      WHERE token_hash = :'hash' AND consumed_at IS NULL AND expires_at > now() AND attempts < :'max'
      RETURNING user_id, attempts`,
    { hash: sha(challenge), max: CHALLENGE_ATTEMPTS },
  );
  if (!row) throw new HttpError(401, "That took too long or too many tries. Sign in again.");
  const userId = row.user_id as string;
  if (!(await acceptCode(userId, code))) {
    await recordSecurityEvent(userId, "two_step_failed", client);
    throw new HttpError(401, "That code isn't right. Check your authenticator app and try again.");
  }
  const claimed = await queryOne(`UPDATE auth_two_step_challenges SET consumed_at = now() WHERE token_hash = :'hash' AND consumed_at IS NULL RETURNING user_id`, { hash: sha(challenge) });
  if (!claimed) throw new HttpError(401, "Sign in again.");
  const user = await findUserById(userId);
  if (!user || !user.isActive) throw new HttpError(401, "Sign in again.");
  const tokens = await issueTokenPair(userId, client.userAgent);
  await recordLoginSuccess(userId, user.email, client);
  return { user: (await getPublicUserById(userId))!, tokens };
}

/** A "Confirm it's you" ticket, still unused and this account's; `consume` uses it up. */
async function ticketValid(userId: string, ticket: unknown, consume: boolean): Promise<void> {
  if (typeof ticket !== "string" || !/^[a-f0-9]{64}$/.test(ticket)) throw new HttpError(401, "Confirm it's you first.");
  const sql = consume
    ? `UPDATE auth_reauth_tickets SET consumed_at = now() WHERE token_hash = :'hash' AND user_id = :'user' AND consumed_at IS NULL AND expires_at > now() RETURNING user_id`
    : `SELECT user_id FROM auth_reauth_tickets WHERE token_hash = :'hash' AND user_id = :'user' AND consumed_at IS NULL AND expires_at > now()`;
  if (!(await queryOne(sql, { hash: sha(ticket), user: userId }))) throw new HttpError(401, "Confirm it's you first.");
}

export async function status(userId: string): Promise<{ enabled: boolean; backupCodesLeft: number }> {
  const enabled = await twoStepEnabled(userId);
  const left = enabled ? await queryOne(`SELECT count(*) AS n FROM user_mfa_backup_codes WHERE user_id = :'id' AND used_at IS NULL`, { id: userId }) : null;
  return { enabled, backupCodesLeft: Number(left?.n ?? 0) };
}

/** Step 1: a new secret for the authenticator app (replacing any not yet confirmed). */
export async function startSetup(userId: string, ticket: unknown): Promise<{ secret: string; otpauthUrl: string; qrRows: string[] }> {
  await ticketValid(userId, ticket, false);
  if (await twoStepEnabled(userId)) throw new HttpError(409, "Two-step login is already on.");
  const secret = generateTotpSecret();
  await query(
    `INSERT INTO user_mfa (user_id, secret_ciphertext) VALUES (:'id', :'secret')
     ON CONFLICT (user_id) DO UPDATE SET secret_ciphertext = EXCLUDED.secret_ciphertext, last_used_step = 0, confirmed_at = NULL, updated_at = now()`,
    { id: userId, secret: seal(secret, key(), associated(userId)) },
  );
  const user = await findUserById(userId);
  const url = otpauthUrl(secret, user?.email ?? user?.username ?? "Katkee", "Katkee");
  return { secret, otpauthUrl: url, qrRows: qrRows(url) };
}

/** Step 2: the first code proves the app is set up. Turns it on and hands out the backup codes, once. */
export async function confirmSetup(userId: string, ticket: unknown, code: unknown, client: ClientContext): Promise<{ backupCodes: string[] }> {
  if (typeof code !== "string" || !/^\d{6}$/.test(code.replace(/\s+/g, ""))) throw new HttpError(422, "Enter the 6-digit code from your authenticator app.");
  const row = await queryOne(`SELECT secret_ciphertext, last_used_step, confirmed_at FROM user_mfa WHERE user_id = :'id'`, { id: userId });
  if (!row || row.confirmed_at) throw new HttpError(409, "Start setting up two-step login again.");
  const step = verifyTotp(unseal(row.secret_ciphertext as string, key(), associated(userId)), code.replace(/\s+/g, ""), Number(row.last_used_step));
  if (step === null) throw new HttpError(422, "That code isn't right. Check the time on your phone and try the newest code.");
  await ticketValid(userId, ticket, true);
  const codes = generateBackupCodes(BACKUP_CODES);
  await query(`DELETE FROM user_mfa_backup_codes WHERE user_id = :'id'`, { id: userId });
  await query(
    `INSERT INTO user_mfa_backup_codes (user_id, code_hash) SELECT :'id', unnest(string_to_array(:'hashes', ','))`,
    { id: userId, hashes: codes.map((c) => sha(`${userId}:${normalizeBackupCode(c)}`)).join(",") },
  );
  await query(`UPDATE user_mfa SET confirmed_at = now(), last_used_step = :'step', updated_at = now() WHERE user_id = :'id'`, { id: userId, step });
  await recordSecurityEvent(userId, "two_step_enabled", client);
  return { backupCodes: codes };
}

/** Turning it off: "Confirm it's you" and a current code (or a backup code). */
export async function turnOff(userId: string, ticket: unknown, code: unknown, client: ClientContext): Promise<void> {
  if (!(await twoStepEnabled(userId))) return;
  if (typeof code !== "string" || code.length > 32 || !(await acceptCode(userId, code))) throw new HttpError(422, "That code isn't right.");
  await ticketValid(userId, ticket, true);
  await query(`DELETE FROM user_mfa WHERE user_id = :'id'`, { id: userId });
  await query(`DELETE FROM user_mfa_backup_codes WHERE user_id = :'id'`, { id: userId });
  await recordSecurityEvent(userId, "two_step_disabled", client);
}
