import type { Router } from "../http/router";
import { requireAuth } from "../http/middleware/auth.middleware";
import { sendJson } from "../http/respond";
import { HttpError } from "../http/errors";
import { query } from "../db/psql";
import { verifyAccessToken } from "../modules/auth/tokens";
import { opaqueToken, sha256 } from "../shared/crypto";

export function registerRealtimeRoutes(router: Router): void {
  // For clients that can't send an Authorization header on the WebSocket handshake
  // (browsers): a single-use ticket, valid for 60 seconds, bound to this sign-in.
  router.post("/api/v1/realtime/ticket", async (req, res) => {
    requireAuth(req);
    const claims = verifyAccessToken((req.headers.authorization ?? "").slice(7));
    if (!claims) throw new HttpError(401, "Invalid or expired access token.");
    const ticket = opaqueToken();
    await query(
      `INSERT INTO realtime_tickets (token_hash, user_id, session_id, access_issued_at, access_expires_at)
       VALUES (:'hash', :'user', NULLIF(:'sid', '')::uuid, to_timestamp(:'iat'::bigint), to_timestamp(:'exp'::bigint))`,
      { hash: sha256(ticket), user: claims.sub, sid: claims.sid && /^[0-9a-f-]{36}$/i.test(claims.sid) ? claims.sid : "", iat: claims.iat, exp: claims.exp },
    );
    sendJson(res, 201, { ticket, expiresInSeconds: 60, path: "/api/v1/realtime" });
  });
}
