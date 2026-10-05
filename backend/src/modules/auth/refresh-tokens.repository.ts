import { createHash, randomUUID } from "node:crypto";
import { nullable, query, queryOne } from "../../db/psql";

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export interface RefreshTokenRecord {
  id: string;
  userId: string;
  sessionId: string;
  expiresAt: string;
  revokedAt: string | null;
}

export async function insertRefreshToken(input: {
  userId: string;
  /** Keep the same session across rotation; omit to start a new sign-in session. */
  sessionId?: string;
  expiresAt: Date;
  userAgent: string | null;
}): Promise<{ id: string; sessionId: string }> {
  // Two-step insert (get an id, then a placeholder hash) so the caller can
  // mint the JWT's `jti` from the row id before the real token exists. The
  // placeholder must be unique per call — a literal like "pending" collides
  // under concurrent signups/logins, since token_hash is UNIQUE and many
  // rows would briefly share it before finalizeRefreshToken() overwrites it.
  const row = await queryOne(
    `INSERT INTO refresh_tokens (user_id, session_id, token_hash, expires_at, user_agent, last_used_at)
     VALUES (:'user_id', :'session_id', :'placeholder', :'expires_at', ${nullable("user_agent")}, now())
     RETURNING id, session_id`,
    {
      user_id: input.userId,
      session_id: input.sessionId ?? randomUUID(),
      placeholder: `pending:${randomUUID()}`,
      expires_at: input.expiresAt.toISOString(),
      user_agent: input.userAgent ? input.userAgent.slice(0, 300) : null,
    },
  );
  if (!row) throw new Error("Insert did not return a row");
  return { id: row.id as string, sessionId: row.session_id as string };
}

export async function finalizeRefreshToken(id: string, token: string): Promise<void> {
  await query(`UPDATE refresh_tokens SET token_hash = :'hash' WHERE id = :'id'`, {
    id,
    hash: hashToken(token),
  });
}

export async function findActiveRefreshToken(id: string, token: string): Promise<RefreshTokenRecord | null> {
  const row = await queryOne(
    `SELECT id, user_id, session_id, expires_at, revoked_at
     FROM refresh_tokens
     WHERE id = :'id' AND token_hash = :'hash'`,
    { id, hash: hashToken(token) },
  );
  if (!row) return null;
  const record: RefreshTokenRecord = {
    id: row.id as string,
    userId: row.user_id as string,
    sessionId: row.session_id as string,
    expiresAt: row.expires_at as string,
    revokedAt: row.revoked_at ?? null,
  };
  if (record.revokedAt !== null) return null;
  if (new Date(record.expiresAt).getTime() < Date.now()) return null;
  return record;
}

export async function revokeRefreshToken(id: string, replacedById: string | null): Promise<void> {
  await query(
    `UPDATE refresh_tokens SET revoked_at = now(), replaced_by_id = ${nullable("replaced_by", "uuid")}
     WHERE id = :'id'`,
    { id, replaced_by: replacedById },
  );
}

/** Only one concurrent caller may consume a refresh token. */
export async function consumeRefreshToken(id: string, token: string): Promise<boolean> {
  const row = await queryOne(
    `UPDATE refresh_tokens SET revoked_at = now()
     WHERE id = :'id' AND token_hash = :'hash'
       AND revoked_at IS NULL AND expires_at > now()
     RETURNING id`,
    { id, hash: hashToken(token) },
  );
  return row !== null;
}

export async function revokeAllRefreshTokensForUser(userId: string): Promise<void> {
  await query(`UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = :'user_id' AND revoked_at IS NULL`, {
    user_id: userId,
  });
}

export interface SessionSummary {
  id: string;
  userAgent: string | null;
  createdAt: string;
  lastUsedAt: string;
}

/** One entry per active sign-in (rotation chains collapse into their session). */
export async function listActiveSessions(userId: string): Promise<SessionSummary[]> {
  const rows = await query(
    `SELECT session_id, min(created_at) AS created_at, max(coalesce(last_used_at, created_at)) AS last_used_at,
            (array_agg(user_agent ORDER BY created_at DESC))[1] AS user_agent
     FROM refresh_tokens
     WHERE user_id = :'user_id'
     GROUP BY session_id
     HAVING bool_or(revoked_at IS NULL AND expires_at > now())
     ORDER BY max(coalesce(last_used_at, created_at)) DESC
     LIMIT 50`,
    { user_id: userId },
  );
  return rows.map((r) => ({ id: r.session_id as string, userAgent: r.user_agent ?? null, createdAt: r.created_at as string, lastUsedAt: r.last_used_at as string }));
}

/**
 * Ends one sign-in: its refresh tokens stop working and, through revoked_sessions,
 * so does its current access token. Returns false when it isn't this user's active session.
 */
export async function revokeSession(userId: string, sessionId: string): Promise<boolean> {
  const rows = await query(
    `WITH ended AS (
       UPDATE refresh_tokens SET revoked_at = now()
       WHERE user_id = :'user_id' AND session_id = :'session_id' AND revoked_at IS NULL
       RETURNING session_id
     ), marked AS (
       INSERT INTO revoked_sessions (session_id, user_id)
       SELECT DISTINCT session_id, :'user_id'::uuid FROM ended
       ON CONFLICT (session_id) DO NOTHING
     )
     SELECT DISTINCT session_id FROM ended`,
    { user_id: userId, session_id: sessionId },
  );
  return rows.length > 0;
}

/** Ends every sign-in except `keepSessionId` (if given). */
export async function revokeOtherSessions(userId: string, keepSessionId: string | null): Promise<number> {
  const rows = await query(
    `WITH ended AS (
       UPDATE refresh_tokens SET revoked_at = now()
       WHERE user_id = :'user_id' AND revoked_at IS NULL
         AND (:'keep' = '' OR session_id <> NULLIF(:'keep', '')::uuid)
       RETURNING session_id
     ), marked AS (
       INSERT INTO revoked_sessions (session_id, user_id)
       SELECT DISTINCT session_id, :'user_id'::uuid FROM ended
       ON CONFLICT (session_id) DO NOTHING
     )
     SELECT DISTINCT session_id FROM ended`,
    { user_id: userId, keep: keepSessionId ?? "" },
  );
  return rows.length;
}
