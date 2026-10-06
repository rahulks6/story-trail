import type { Router } from "../../http/router";
import { requireAuth } from "../../http/middleware/auth.middleware";
import { sendJson } from "../../http/respond";
import { RateLimiter } from "../../http/rateLimiter";
import { parseQueryString } from "../../http/pagination";
import { requireAdmin } from "../admin/security";
import { ingestEvents } from "./events";
import { analyticsOverview, refreshAnalytics } from "./rollup";

/** The app flushes every few seconds at most; this only stops a runaway client. */
export const analyticsIngestLimiter = new RateLimiter(60_000, 60);
const refreshLimiter = new RateLimiter(60_000, 2);

export function registerAnalyticsRoutes(router: Router): void {
  // Batches from the app (sessions, crashes, upload outcomes, views and searches). Never on
  // the critical path: the app sends these in the background and drops them on failure.
  router.post("/api/v1/analytics/events", async (req, res) => {
    requireAuth(req);
    analyticsIngestLimiter.check(req.userId as string);
    sendJson(res, 200, await ingestEvents(req.userId as string, req.body, req.headers["x-katkee-platform"]));
  });

  router.get("/api/v1/admin/analytics", async (req, res) => {
    await requireAdmin(req, "analytics.read");
    const days = Number(parseQueryString(req.url ?? "").days ?? 30);
    sendJson(res, 200, await analyticsOverview(Number.isInteger(days) ? Math.min(90, Math.max(7, days)) : 30));
  });

  router.post("/api/v1/admin/analytics/refresh", async (req, res) => {
    const principal = await requireAdmin(req, "analytics.read");
    refreshLimiter.check(principal.userId);
    sendJson(res, 200, await refreshAnalytics());
  });
}
