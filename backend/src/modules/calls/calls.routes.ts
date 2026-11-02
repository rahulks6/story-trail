import type { Router } from "../../http/router";
import { requireAuth } from "../../http/middleware/auth.middleware";
import { sendJson } from "../../http/respond";
import { parseQueryString } from "../../http/pagination";
import { HttpError } from "../../http/errors";
import { RateLimiter } from "../../http/rateLimiter";
import * as callsService from "./calls.service";

/** TURN credentials per person: a phone needs one set per call, and a fresh one after a long reconnect. */
const iceServersLimiter = new RateLimiter(60_000, 20);
/** Heartbeats, signal fetches and state changes, per person: generous for ICE bursts, tight for floods. */
const callTrafficLimiter = new RateLimiter(60_000, 600);

function traffic(userId: string): void {
  callTrafficLimiter.check(userId);
}

export function registerCallsRoutes(router: Router): void {
  // Place a voice or video call to the other person in a 1:1 chat.
  router.post("/api/v1/conversations/:id/calls", async (req, res) => {
    requireAuth(req);
    const media = (req.body as { media?: unknown } | undefined)?.media;
    if (media !== "audio" && media !== "video") throw new HttpError(422, "media must be audio or video.");
    const started = await callsService.startCall(req.userId as string, req.params.id as string, media);
    sendJson(res, 201, started);
  });

  // Registered before /calls/:id, which would otherwise match it.
  router.get("/api/v1/calls/ice-servers", async (req, res) => {
    requireAuth(req);
    iceServersLimiter.check(req.userId as string);
    res.setHeader("Cache-Control", "no-store");
    sendJson(res, 200, await callsService.iceServers(req.userId as string));
  });

  router.get("/api/v1/calls/:id", async (req, res) => {
    requireAuth(req);
    traffic(req.userId as string);
    sendJson(res, 200, { call: await callsService.getCall(req.userId as string, req.params.id as string) });
  });

  router.post("/api/v1/calls/:id/ringing", async (req, res) => {
    requireAuth(req);
    traffic(req.userId as string);
    sendJson(res, 200, { call: await callsService.reportRinging(req.userId as string, req.params.id as string) });
  });

  router.post("/api/v1/calls/:id/accept", async (req, res) => {
    requireAuth(req);
    traffic(req.userId as string);
    sendJson(res, 200, await callsService.acceptCall(req.userId as string, req.params.id as string));
  });

  router.post("/api/v1/calls/:id/decline", async (req, res) => {
    requireAuth(req);
    traffic(req.userId as string);
    sendJson(res, 200, { call: await callsService.declineCall(req.userId as string, req.params.id as string) });
  });

  // Hang up. `reason`: "timeout" (the caller's ring time ran out) or "failed" (never connected).
  router.post("/api/v1/calls/:id/end", async (req, res) => {
    requireAuth(req);
    traffic(req.userId as string);
    const reason = (req.body as { reason?: unknown } | undefined)?.reason ?? "hangup";
    if (reason !== "hangup" && reason !== "timeout" && reason !== "failed") throw new HttpError(422, "reason must be hangup, timeout or failed.");
    sendJson(res, 200, { call: await callsService.endCall(req.userId as string, req.params.id as string, reason) });
  });

  router.post("/api/v1/calls/:id/heartbeat", async (req, res) => {
    requireAuth(req);
    traffic(req.userId as string);
    sendJson(res, 200, { call: await callsService.heartbeat(req.userId as string, req.params.id as string) });
  });

  router.post("/api/v1/calls/:id/signals", async (req, res) => {
    requireAuth(req);
    traffic(req.userId as string);
    const signal = callsService.parseSignal(req.body);
    sendJson(res, 201, await callsService.sendSignal(req.userId as string, req.params.id as string, signal));
  });

  // ?after=<seq>: the other phone's signals newer than the last one this phone handled.
  router.get("/api/v1/calls/:id/signals", async (req, res) => {
    requireAuth(req);
    traffic(req.userId as string);
    const after = parseQueryString(req.url ?? "").after ?? "0";
    if (!/^\d{1,15}$/.test(after)) throw new HttpError(400, "Invalid signal cursor.");
    sendJson(res, 200, await callsService.listSignals(req.userId as string, req.params.id as string, Number(after)));
  });
}
