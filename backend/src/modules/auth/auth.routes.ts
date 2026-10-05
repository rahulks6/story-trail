import type { KatkeeRequest, Router } from "../../http/router";
import { requireAuth } from "../../http/middleware/auth.middleware";
import { HttpError } from "../../http/errors";
import { sendJson } from "../../http/respond";
import { authRateLimiter } from "../../http/rateLimiters";
import { clientIp } from "../../http/rateLimiter";
import { enforceSharedLimit } from "../../shared/sharedRateLimit";
import { ipHash } from "../../shared/crypto";
import { verifyAccessToken } from "./tokens";
import { config } from "../../config/env";
import {
  parseChangePasswordInput,
  parseForgotPasswordInput,
  parseLoginInput,
  parseRefreshInput,
  parseResetPasswordInput,
  parseSignupInput,
} from "./dto";
import * as authService from "./auth.service";
import * as refreshTokensRepo from "./refresh-tokens.repository";
import { listSecurityEvents, recordSecurityEvent, type ClientContext } from "./account-security";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function clientContext(req: KatkeeRequest): ClientContext {
  return { ip: clientIp(req), userAgent: (req.headers["user-agent"] as string | undefined) ?? null };
}

/** The session id of the caller's access token (absent on tokens minted before sessions existed). */
function currentSessionId(req: KatkeeRequest): string | null {
  const header = req.headers.authorization ?? "";
  return verifyAccessToken(header.slice("Bearer ".length))?.sid ?? null;
}

export function registerAuthRoutes(router: Router): void {
  router.post("/api/v1/auth/signup", async (req, res) => {
    authRateLimiter.check(clientIp(req));
    // Account creation budget shared by all instances: 20 per network address per hour.
    await enforceSharedLimit(`signup-ip:${ipHash(clientIp(req))}`, config.rateLimit.signupPerHour, 3600, "Too many new accounts from this network.");
    const input = parseSignupInput(req.body);
    const result = await authService.signup(input, clientContext(req));
    sendJson(res, 201, result);
  });

  router.post("/api/v1/auth/login", async (req, res) => {
    // The same limiter/bucket as signup — an attacker guessing passwords
    // and an attacker mass-creating accounts are the same shape of abuse
    // against this endpoint family, so they share one budget per IP.
    // Per-account failure limits (shared across instances) live in auth.service.
    authRateLimiter.check(clientIp(req));
    const input = parseLoginInput(req.body);
    const result = await authService.login(input, clientContext(req));
    sendJson(res, 200, result);
  });

  // Not on the per-IP auth budget: a signed, single-use 256-bit token can't be guessed,
  // and many users share one address behind carrier-grade NAT.
  router.post("/api/v1/auth/refresh", async (req, res) => {
    const input = parseRefreshInput(req.body);
    const userAgent = (req.headers["user-agent"] as string | undefined) ?? null;
    const tokens = await authService.refresh(input.refreshToken, userAgent);
    sendJson(res, 200, { tokens });
  });

  router.post("/api/v1/auth/logout", async (req, res) => {
    const input = parseRefreshInput(req.body);
    await authService.logout(input.refreshToken);
    sendJson(res, 204, undefined);
  });

  router.get("/api/v1/auth/me", async (req: KatkeeRequest, res) => {
    requireAuth(req);
    const user = await authService.getPublicUserById(req.userId as string);
    if (!user) throw new HttpError(404, "User not found.");
    sendJson(res, 200, { user });
  });

  // Always 202 with the same body: the response never reveals whether an account exists.
  router.post("/api/v1/auth/password/forgot", async (req, res) => {
    await enforceSharedLimit(`reset-ip:${ipHash(clientIp(req))}`, config.rateLimit.resetRequestsPerHour, 3600, "Too many reset requests.");
    const { email } = parseForgotPasswordInput(req.body);
    await authService.forgotPassword(email, clientContext(req));
    sendJson(res, 202, { message: "If an account uses that email, we've sent a 6-digit code. It expires in 15 minutes." });
  });

  router.post("/api/v1/auth/password/reset", async (req, res) => {
    await enforceSharedLimit(`reset-verify-ip:${ipHash(clientIp(req))}`, config.rateLimit.resetVerifyPerHour, 3600, "Too many reset attempts.");
    const input = parseResetPasswordInput(req.body);
    sendJson(res, 200, await authService.resetPassword(input.email, input.code, input.newPassword, clientContext(req)));
  });

  router.post("/api/v1/auth/password/change", async (req, res) => {
    requireAuth(req);
    const input = parseChangePasswordInput(req.body);
    const tokens = await authService.changePassword(req.userId as string, input.currentPassword, input.newPassword, clientContext(req));
    sendJson(res, 200, { tokens });
  });

  router.get("/api/v1/auth/sessions", async (req, res) => {
    requireAuth(req);
    const current = currentSessionId(req);
    const sessions = await refreshTokensRepo.listActiveSessions(req.userId as string);
    sendJson(res, 200, { sessions: sessions.map((s) => ({ ...s, current: s.id === current })) });
  });

  router.post("/api/v1/auth/sessions/revoke-others", async (req, res) => {
    requireAuth(req);
    const ended = await refreshTokensRepo.revokeOtherSessions(req.userId as string, currentSessionId(req));
    await recordSecurityEvent(req.userId as string, "sessions_revoked", clientContext(req));
    sendJson(res, 200, { ended });
  });

  router.delete("/api/v1/auth/sessions/:id", async (req, res) => {
    requireAuth(req);
    const sessionId = req.params.id ?? "";
    if (!UUID_RE.test(sessionId)) throw new HttpError(404, "Session not found.");
    if (!(await refreshTokensRepo.revokeSession(req.userId as string, sessionId))) throw new HttpError(404, "Session not found.");
    await recordSecurityEvent(req.userId as string, "session_revoked", clientContext(req));
    sendJson(res, 204, undefined);
  });

  router.get("/api/v1/auth/security-events", async (req, res) => {
    requireAuth(req);
    sendJson(res, 200, { events: await listSecurityEvents(req.userId as string) });
  });
}
