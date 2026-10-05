import { queryOne } from "../../db/psql";
import type { AccessTokenClaims } from "./tokens";

export type SessionState = "ok" | "account_unavailable" | "session_ended";

/**
 * Whether a verified access token still represents a live sign-in: the account is
 * active and not deleted, the session wasn't ended, and no "sign out everywhere" or
 * password change happened after the token was issued. Used for every authenticated
 * HTTP request and, periodically, for every open realtime connection.
 */
export async function checkAccessSession(claims: Pick<AccessTokenClaims, "sub" | "iat"> & { sid?: string | undefined }): Promise<SessionState> {
  const user = await queryOne(
    `SELECT u.is_active,
            floor(extract(epoch FROM u.sessions_revoked_at))::bigint AS revoked_before,
            EXISTS (SELECT 1 FROM revoked_sessions r WHERE r.session_id = NULLIF(:'sid', '')::uuid) AS session_ended
     FROM users u WHERE u.id = :'id' AND u.deleted_at IS NULL`,
    { id: claims.sub, sid: claims.sid && /^[0-9a-f-]{36}$/i.test(claims.sid) ? claims.sid : "" },
  );
  if (!user || user.is_active !== "t") return "account_unavailable";
  if (user.session_ended === "t" || (user.revoked_before !== null && claims.iat < Number(user.revoked_before))) return "session_ended";
  return "ok";
}
