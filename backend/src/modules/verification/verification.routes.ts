import type { Router } from "../../http/router";
import { requireAuth } from "../../http/middleware/auth.middleware";
import { sendJson } from "../../http/respond";
import { parseQueryString } from "../../http/pagination";
import { enforceSharedLimit } from "../../shared/sharedRateLimit";
import { requireAdmin } from "../admin/security";
import { body, text, uuid } from "../admin/policy";
import { mediaStorage } from "../media/instance";
import { sendMediaFile } from "../media/delivery";
import * as verification from "./verification.service";

/** Settings > Request verification, and the Admin console's Verification queue. */
export function registerVerificationRoutes(router: Router): void {
  router.get("/api/v1/me/verification", async (req, res) => {
    requireAuth(req);
    res.setHeader("Cache-Control", "no-store");
    sendJson(res, 200, await verification.getStatus(req.userId as string));
  });

  router.post("/api/v1/me/verification", async (req, res) => {
    requireAuth(req);
    const input = verification.parseApply(req.body);
    // Shared by every API instance: 5 requests a day per account.
    await enforceSharedLimit(`verification:${req.userId}`, 5, 86_400, "Too many verification requests today.");
    const result = await verification.apply(req.userId as string, input);
    if ("notEligible" in result) {
      sendJson(res, 403, { error: "not_eligible", message: "Your account can't request verification yet.", reasons: result.notEligible });
      return;
    }
    sendJson(res, 201, result);
  });

  router.delete("/api/v1/me/verification", async (req, res) => {
    requireAuth(req);
    await verification.withdraw(req.userId as string);
    sendJson(res, 204, undefined);
  });

  router.get("/api/v1/admin/verification", async (req, res) => {
    await requireAdmin(req, "verification.review");
    res.setHeader("Cache-Control", "no-store");
    const search = String(parseQueryString(req.url ?? "").search ?? "").trim().replace(/^@/, "").toLowerCase().slice(0, 30);
    sendJson(res, 200, await verification.queue(search));
  });

  router.get("/api/v1/admin/verification/requests/:id", async (req, res) => {
    await requireAdmin(req, "verification.review");
    res.setHeader("Cache-Control", "no-store");
    sendJson(res, 200, { request: await verification.requestDetail(uuid(req.params.id)) });
  });

  // "Show ID photo": each view is audit-logged before the photo is sent.
  router.get("/api/v1/admin/verification/requests/:id/id-photo", async (req, res) => {
    const p = await requireAdmin(req, "verification.review");
    const media = await verification.idPhotoForAdmin(p.userId, uuid(req.params.id));
    res.setHeader("Cache-Control", "no-store");
    await sendMediaFile(req, res, media, "display", true, mediaStorage, { redirect: false });
  });

  router.get("/api/v1/admin/verification/users/:userId/avatar", async (req, res) => {
    await requireAdmin(req, "verification.review");
    const media = await verification.avatarForAdmin(uuid(req.params.userId));
    res.setHeader("Cache-Control", "no-store");
    await sendMediaFile(req, res, media, "thumbnail", false, mediaStorage, { redirect: false });
  });

  router.post("/api/v1/admin/verification/requests/:id/approve", async (req, res) => {
    const p = await requireAdmin(req, "verification.review");
    await verification.approve(p.userId, uuid(req.params.id));
    sendJson(res, 204, undefined);
  });

  router.post("/api/v1/admin/verification/requests/:id/deny", async (req, res) => {
    const p = await requireAdmin(req, "verification.review");
    await verification.deny(p.userId, uuid(req.params.id), text(body(req.body).reason, 500));
    sendJson(res, 204, undefined);
  });

  router.post("/api/v1/admin/verification/users/:userId/remove", async (req, res) => {
    const p = await requireAdmin(req, "verification.review");
    await verification.removeBadge(p.userId, uuid(req.params.userId), text(body(req.body).reason, 500));
    sendJson(res, 204, undefined);
  });

  router.post("/api/v1/admin/verification/users/:userId/restore", async (req, res) => {
    const p = await requireAdmin(req, "verification.review");
    await verification.restoreBadge(p.userId, uuid(req.params.userId));
    sendJson(res, 204, undefined);
  });
}
