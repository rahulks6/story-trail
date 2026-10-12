import type { Router } from "../../http/router";
import { requireAuth } from "../../http/middleware/auth.middleware";
import { sendJson } from "../../http/respond";
import { ValidationError } from "../auth/dto";
import { AREA_CELL_RE } from "./geohash";
import { deleteArea, getArea, setArea } from "./reach.repository";

/** The canonical name of an IANA time zone the runtime knows (aliases such as Asia/Calcutta included), or null. */
function canonicalTimeZone(value: string): string | null {
  if (value.length < 1 || value.length > 64) return null;
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: value }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

export function parseAreaInput(body: unknown): { cell?: string | null; timeZone?: string | null } {
  const b = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  const errors: Record<string, string> = {};
  const result: { cell?: string | null; timeZone?: string | null } = {};
  if (b.cell !== undefined) {
    if (b.cell === null) result.cell = null;
    else if (typeof b.cell === "string" && AREA_CELL_RE.test(b.cell)) result.cell = b.cell;
    else errors.cell = "cell must be a 4-character geohash, or null.";
  }
  if (b.timeZone !== undefined) {
    const zone = typeof b.timeZone === "string" ? canonicalTimeZone(b.timeZone) : null;
    if (b.timeZone === null) result.timeZone = null;
    else if (zone) result.timeZone = zone;
    else errors.timeZone = "timeZone must be an IANA time zone, or null.";
  }
  if (b.cell === undefined && b.timeZone === undefined) errors.cell = "Send a cell, a timeZone, or both.";
  if (Object.keys(errors).length > 0) throw new ValidationError(errors);
  return result;
}

/**
 * Your approximate area for nearby Stories (Phase 9). Only you can read it; it is never part of
 * a profile, search result, feed or ad. The app sends a coarse cell, never coordinates.
 */
export function registerAreaRoutes(router: Router): void {
  router.get("/api/v1/users/me/area", async (req, res) => {
    requireAuth(req);
    res.setHeader("Cache-Control", "no-store");
    sendJson(res, 200, { area: await getArea(req.userId as string) });
  });

  router.put("/api/v1/users/me/area", async (req, res) => {
    requireAuth(req);
    const area = await setArea(req.userId as string, parseAreaInput(req.body));
    res.setHeader("Cache-Control", "no-store");
    sendJson(res, 200, { area });
  });

  router.delete("/api/v1/users/me/area", async (req, res) => {
    requireAuth(req);
    await deleteArea(req.userId as string);
    sendJson(res, 204, undefined);
  });
}
