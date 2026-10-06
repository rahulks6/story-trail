import * as http from "node:http";
import { randomUUID } from "node:crypto";
import { ValidationError } from "../modules/auth/dto";
import { AuthError } from "../modules/auth/auth.service";
import { DatabaseError } from "../db/psql";
import { queryOne } from "../db/psql";
import { verifyAccessToken } from "../modules/auth/tokens";
import { checkAccessSession } from "../modules/auth/session-check";
import { noteActivity } from "../modules/analytics/activity";
import { HttpError } from "./errors";
import { sendJson } from "./respond";
import { globalRateLimiter } from "./rateLimiters";
import { clientIp } from "./rateLimiter";
import type { KatkeeRequest, Router } from "./router";
import type { Lifecycle } from "./lifecycle";

const MAX_BODY_BYTES = 1 * 1024 * 1024; // 1 MiB

function readBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new HttpError(413, "Request body too large."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8").trim();
      if (!raw) {
        resolve(undefined);
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new HttpError(400, "Request body must be valid JSON."));
      }
    });
    req.on("error", reject);
  });
}

/** A caller's (or proxy's) request id is kept when it is a plain token; anything else is replaced. */
const REQUEST_ID = /^[A-Za-z0-9._:-]{8,128}$/;
export function requestIdFor(req: http.IncomingMessage): string {
  const given = req.headers["x-request-id"];
  return typeof given === "string" && REQUEST_ID.test(given) ? given : randomUUID();
}

function logError(requestId: string, event: string, detail: unknown): void {
  console.error(JSON.stringify({
    ts: new Date().toISOString(), event, requestId,
    error: detail instanceof Error ? `${detail.name}: ${detail.message}` : String(detail),
    ...(detail instanceof Error && detail.stack ? { stack: detail.stack.split("\n").slice(0, 8).join("\n") } : {}),
  }));
}

function handleError(res: http.ServerResponse, error: unknown, requestId: string): void {
  if (error instanceof ValidationError) {
    sendJson(res, 422, { error: "validation_error", fields: error.fieldErrors });
    return;
  }
  if (error instanceof AuthError) {
    sendJson(res, error.status, { error: "auth_error", message: error.message });
    return;
  }
  if (error instanceof HttpError) {
    for (const [name, value] of Object.entries(error.headers ?? {})) res.setHeader(name, value);
    sendJson(res, error.status, { error: "http_error", message: error.message, fields: error.fieldErrors });
    return;
  }
  // The request id lets support find the server log line for a failure someone reports.
  if (error instanceof DatabaseError) {
    logError(requestId, "database_error", error.detail);
    sendJson(res, 500, { error: "internal_error", message: "Something went wrong.", requestId });
    return;
  }
  logError(requestId, "unhandled_error", error);
  sendJson(res, 500, { error: "internal_error", message: "Something went wrong.", requestId });
}

function logRequest(req: http.IncomingMessage, res: http.ServerResponse, durationMs: number, requestId: string): void {
  // One structured JSON line per request — real production observability
  // without an external logging package (this sandbox can't install one
  // anyway). The path is logged without its query string: nothing here
  // uses query params for secrets today, but stripping them is a cheap
  // habit that stays correct if that ever changes.
  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      method: req.method,
      path: (req.url ?? "").split("?")[0],
      status: res.statusCode,
      durationMs,
      ip: clientIp(req),
      requestId,
    }),
  );
}

export function createServer(router: Router, lifecycle?: Lifecycle): http.Server {
  const server = http.createServer((req, res) => {
    const startedAt = Date.now();
    const requestId = requestIdFor(req);
    res.setHeader("X-Request-Id", requestId);
    lifecycle?.track(res);
    // Draining: finish this request, then let the client reconnect to another instance.
    if (lifecycle?.draining) res.setHeader("Connection", "close");
    res.on("finish", () => logRequest(req, res, Date.now() - startedAt, requestId));

    void (async () => {
      try {
        globalRateLimiter.check(clientIp(req));

        const url = req.url ?? "/";
        const match = router.match(req.method ?? "GET", url);
        if (!match) {
          sendJson(res, 404, { error: "not_found", message: `No route for ${req.method} ${url}` });
          return;
        }

        // DELETE is included too — HTTP (RFC 7231) doesn't forbid a body on
        // DELETE, and account deletion's password confirmation needs one.
        // Every existing DELETE route sends no body at all, so readBody()
        // just resolves those to undefined exactly as before — this is
        // additive, not a behavior change for them.
        const isBodyMethod = ["POST", "PUT", "PATCH", "DELETE"].includes((req.method ?? "").toUpperCase());
        const body = isBodyMethod && !match.options.rawBody ? await readBody(req) : undefined;

        const katkeeReq = req as KatkeeRequest;
        katkeeReq.params = match.params;
        katkeeReq.body = body;
        katkeeReq.requestId = requestId;

        const bearer = req.headers.authorization;
        if (bearer?.startsWith("Bearer ")) {
          const claims = verifyAccessToken(bearer.slice(7));
          if (claims) {
            // One indexed lookup per authenticated request: account state, "sign out
            // everywhere"/password changes, and explicitly ended sign-ins all take effect
            // immediately instead of when the 15-minute access token expires.
            const state = await checkAccessSession(claims);
            if (state === "account_unavailable") throw new HttpError(403, "Account unavailable.");
            if (state === "session_ended") throw new HttpError(401, "Your session has ended. Sign in again.");
            // DAU/WAU/MAU: records the person active today (in the background, at most once a day).
            if (!url.startsWith("/api/v1/admin/")) noteActivity(claims.sub, req.headers["x-katkee-platform"]);
          }
        }
        if (url.startsWith("/api/v1/admin/")) res.setHeader("Cache-Control", "no-store");
        await match.handler(katkeeReq, res);
      } catch (error) {
        handleError(res, error, requestId);
      }
    })();
  });

  // Headers must arrive quickly regardless of a request's body size — this
  // specifically targets a slow/trickling-headers (slowloris-style)
  // connection without punishing a legitimate large video upload on a slow
  // network, which needs `requestTimeout` (left at Node's own 5-minute
  // default) to stay generous.
  server.headersTimeout = 10_000;

  return server;
}
