import type { Router } from "../../http/router";
import { requireAuth } from "../../http/middleware/auth.middleware";
import { sendJson } from "../../http/respond";
import { parseQueryString } from "../../http/pagination";
import { HttpError } from "../../http/errors";
import { enforceSharedLimit } from "../../shared/sharedRateLimit";
import * as professional from "./professional.service";
import { DASHBOARD_RANGES, getDashboard, type DashboardRange } from "./dashboard";
import { knownTimeZone } from "./timeZones";

/** Settings > Professional account, and the dashboard behind your profile's Insights button. */
export function registerProfessionalRoutes(router: Router): void {
  router.get("/api/v1/me/professional", async (req, res) => {
    requireAuth(req);
    res.setHeader("Cache-Control", "no-store");
    sendJson(res, 200, await professional.getStatus(req.userId as string));
  });

  // Switch to a professional account, or change its category or whether it shows.
  router.put("/api/v1/me/professional", async (req, res) => {
    requireAuth(req);
    const input = professional.parseProfessionalInput(req.body);
    // Shared by every API instance: switching is free, but not a toggle to hammer.
    await enforceSharedLimit(`professional:${req.userId}`, 30, 86_400, "Too many account changes today.");
    sendJson(res, 200, await professional.setProfessional(req.userId as string, input));
  });

  router.delete("/api/v1/me/professional", async (req, res) => {
    requireAuth(req);
    await enforceSharedLimit(`professional:${req.userId}`, 30, 86_400, "Too many account changes today.");
    sendJson(res, 200, await professional.switchToPersonal(req.userId as string));
  });

  // Only ever your own (there is no :username), and only once you're professional.
  router.get("/api/v1/me/professional/dashboard", async (req, res) => {
    requireAuth(req);
    const userId = req.userId as string;
    const params = parseQueryString(req.url ?? "");
    const days = Number(params.days ?? 7);
    if (!(DASHBOARD_RANGES as readonly number[]).includes(days)) throw new HttpError(400, "days must be 7 or 30.");
    const settings = await professional.professionalSettings(userId);
    if (!settings) throw new HttpError(403, "Switch to a professional account to see your dashboard.", undefined, undefined, "not_professional");
    // The phone's time zone when it sends a valid one (remembered for next time), else the last one, else UTC.
    const asked = typeof params.tz === "string" && (await knownTimeZone(params.tz)) ? params.tz : null;
    if (asked && asked !== settings.timeZone) await professional.rememberTimeZone(userId, asked);
    const timeZone = asked ?? settings.timeZone ?? "UTC";
    res.setHeader("Cache-Control", "no-store");
    sendJson(res, 200, { dashboard: await getDashboard(userId, days as DashboardRange, timeZone) });
  });
}
