import type { Router } from "../../http/router";
import { requireAuth } from "../../http/middleware/auth.middleware";
import { sendJson } from "../../http/respond";
import { RateLimiter } from "../../http/rateLimiter";
import { HttpError } from "../../http/errors";
import { parsePagination, parseQueryString } from "../../http/pagination";
import { requireAdmin } from "../admin/security";
import { uuid } from "../admin/policy";
import { mediaStorage } from "../media/instance";
import { sendMediaFile } from "../media/delivery";
import * as support from "./support.service";

/** A crash loop on one phone can't fill the table; feedback is a few notes an hour at most. */
const crashLimiter = new RateLimiter(3_600_000, 30);
const feedbackLimiter = new RateLimiter(3_600_000, 10);

export function registerSupportRoutes(router: Router): void {
  // The app sends what went wrong (a fatal crash on the next launch); see support.service.ts.
  router.post("/api/v1/crash-reports", async (req, res) => {
    requireAuth(req);
    const device = { platform: support.parsePlatform(req.headers["x-katkee-platform"]) };
    const input = support.parseCrash(req.body);
    crashLimiter.check(req.userId as string);
    const { created } = await support.recordCrash(req.userId as string, device, input);
    sendJson(res, created ? 201 : 200, { ok: true });
  });

  // Settings > Help > Send feedback.
  router.post("/api/v1/feedback", async (req, res) => {
    requireAuth(req);
    const device = { platform: support.parsePlatform(req.headers["x-katkee-platform"]) };
    const input = support.parseFeedback(req.body);
    feedbackLimiter.check(req.userId as string);
    sendJson(res, 201, { feedback: await support.submitFeedback(req.userId as string, device, input) });
  });

  router.get("/api/v1/admin/crashes", async (req, res) => {
    await requireAdmin(req, "crashes.read");
    const q = parseQueryString(req.url ?? "");
    const page = parsePagination(q);
    const days = Number(q.days ?? 7);
    const window = Number.isInteger(days) ? Math.min(support.CRASH_RETENTION_DAYS, Math.max(1, days)) : 7;
    sendJson(res, 200, { items: await support.crashGroups(window, page.limit, page.offset), days: window, ...page });
  });

  router.get("/api/v1/admin/feedback", async (req, res) => {
    await requireAdmin(req, "feedback.read");
    const q = parseQueryString(req.url ?? "");
    const page = parsePagination(q);
    const status = q.status === "resolved" || q.status === "all" ? q.status : "open";
    res.setHeader("Cache-Control", "no-store");
    sendJson(res, 200, { items: await support.listFeedback(status, page.limit, page.offset), status, ...page });
  });

  router.post("/api/v1/admin/feedback/:id/status", async (req, res) => {
    const p = await requireAdmin(req, "feedback.read");
    const status = (req.body as { status?: unknown } | undefined)?.status;
    if (status !== "open" && status !== "resolved") throw new HttpError(422, "status must be open or resolved.");
    await support.setFeedbackStatus(uuid(req.params.id), p.userId, status);
    sendJson(res, 204, undefined);
  });

  router.get("/api/v1/admin/feedback/:id/screenshot", async (req, res) => {
    await requireAdmin(req, "feedback.read");
    const media = await support.feedbackScreenshot(uuid(req.params.id));
    res.setHeader("Cache-Control", "no-store");
    await sendMediaFile(req, res, media, null, false, mediaStorage, { redirect: false });
  });
}
