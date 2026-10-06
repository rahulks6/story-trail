import type { Router } from "../../http/router";
import { requireAuth } from "../../http/middleware/auth.middleware";
import { sendJson } from "../../http/respond";
import { HttpError } from "../../http/errors";
import { parsePagination, parseQueryString } from "../../http/pagination";
import { parseUsernameParam } from "../../shared/validation";
import { parseCreateReportInput, parseResolveReportInput } from "./dto";
import * as moderationService from "./moderation.service";
import { parseReportStatus, REPORT_STATUSES } from "./moderation.repository";
import { RateLimiter } from "../../http/rateLimiter";
import { requireAdmin } from "../admin/security";
/** Shared by every way of reporting (content, profiles, DMs): 30 reports per hour per account. */
export const reportLimiter = new RateLimiter(3600000, 30);


export function registerModerationRoutes(router: Router): void {
  router.post("/api/v1/reports", async (req, res) => {
    requireAuth(req);
    reportLimiter.check(req.userId as string);
    const input = parseCreateReportInput(req.body);
    const { report, created } = await moderationService.createReport(req.userId as string, input);
    sendJson(res, created ? 201 : 200, { report });
  });

  // Moderator endpoints require the Admin console session (cookie, CSRF, origin,
  // two-step verification) — never a consumer access token.
  router.get("/api/v1/moderation/reports", async (req, res) => {
    const principal = await requireAdmin(req, "reports.read");
    const query = parseQueryString(req.url ?? "");
    const status = parseReportStatus(query.status);
    if (!status) {
      throw new HttpError(422, `status must be one of: ${REPORT_STATUSES.join(", ")}.`);
    }
    const { limit, offset } = parsePagination(query);
    const reports = await moderationService.listReportsQueue(principal, status, limit, offset);
    sendJson(res, 200, { reports, limit, offset });
  });

  router.post("/api/v1/moderation/reports/:id/resolve", async (req, res) => {
    const principal = await requireAdmin(req, "reports.review", false, true);
    const input = parseResolveReportInput(req.body);
    const report = await moderationService.resolveReport(principal, req.params.id as string, input);
    sendJson(res, 200, { report });
  });

  router.post("/api/v1/moderation/users/:username/suspend", async (req, res) => {
    const principal = await requireAdmin(req, "users.suspend", false, true);
    const username = parseUsernameParam(req.params.username);
    await moderationService.suspendUserByUsername(principal, username);
    sendJson(res, 204, undefined);
  });

  router.post("/api/v1/moderation/users/:username/unsuspend", async (req, res) => {
    const principal = await requireAdmin(req, "users.suspend", false, true);
    const username = parseUsernameParam(req.params.username);
    await moderationService.unsuspendUserByUsername(principal, username);
    sendJson(res, 204, undefined);
  });
}
