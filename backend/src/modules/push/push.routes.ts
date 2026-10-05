import type { Router } from "../../http/router";
import { requireAuth } from "../../http/middleware/auth.middleware";
import { sendJson } from "../../http/respond";
import { HttpError } from "../../http/errors";
import { query, queryOne } from "../../db/psql";
import { verifyAccessToken } from "../auth/tokens";

interface DeviceInput {
  provider: "fcm" | "apns";
  platform: "ios" | "android";
  token: string;
  appVersion: string | null;
  locale: string | null;
}

function parseDevice(body: unknown): DeviceInput {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const errors: Record<string, string> = {};
  const provider = b.provider === "fcm" || b.provider === "apns" ? b.provider : null;
  if (!provider) errors.provider = "provider must be fcm or apns.";
  const platform = b.platform === "ios" || b.platform === "android" ? b.platform : null;
  if (!platform) errors.platform = "platform must be ios or android.";
  if (provider === "apns" && platform !== "ios") errors.platform = "APNs tokens are iOS-only.";
  const token = typeof b.token === "string" ? b.token.trim() : "";
  if (!/^[A-Za-z0-9_:.\-]{16,4096}$/.test(token)) errors.token = "token is not a valid push token.";
  const appVersion = typeof b.appVersion === "string" ? b.appVersion.slice(0, 40) : null;
  const locale = typeof b.locale === "string" && /^[A-Za-z0-9-]{2,35}$/.test(b.locale) ? b.locale : null;
  if (Object.keys(errors).length || !provider || !platform) throw new HttpError(422, "Invalid push device.", errors);
  return { provider, platform, token, appVersion, locale };
}

export function registerPushRoutes(router: Router): void {
  /**
   * Registers (or refreshes) this device for push. A token seen before moves to the
   * current account — the phone signed in as someone else — and is bound to this
   * sign-in, so ending the sign-in stops its pushes.
   */
  router.post("/api/v1/push/devices", async (req, res) => {
    requireAuth(req);
    const device = parseDevice(req.body);
    const claims = verifyAccessToken((req.headers.authorization ?? "").slice(7));
    const sid = claims?.sid && /^[0-9a-f-]{36}$/i.test(claims.sid) ? claims.sid : "";
    const row = await queryOne(
      `INSERT INTO push_devices (user_id, session_id, provider, platform, token, app_version, locale)
       VALUES (:'user', NULLIF(:'sid', '')::uuid, :'provider', :'platform', :'token', NULLIF(:'version', ''), NULLIF(:'locale', ''))
       ON CONFLICT (provider, token) DO UPDATE SET
         user_id = EXCLUDED.user_id, session_id = EXCLUDED.session_id, platform = EXCLUDED.platform,
         app_version = EXCLUDED.app_version, locale = EXCLUDED.locale, last_seen_at = now(),
         disabled_at = NULL, disabled_reason = NULL
       RETURNING id, (xmax = 0) AS inserted`,
      { user: req.userId as string, sid, provider: device.provider, platform: device.platform, token: device.token, version: device.appVersion ?? "", locale: device.locale ?? "" },
    );
    sendJson(res, row?.inserted === "t" ? 201 : 200, { device: { id: row?.id } });
  });

  /** Called on sign-out (before the session ends) so this device stops receiving pushes. */
  router.post("/api/v1/push/devices/unregister", async (req, res) => {
    requireAuth(req);
    const b = (req.body && typeof req.body === "object" ? req.body : {}) as Record<string, unknown>;
    const provider = b.provider === "fcm" || b.provider === "apns" ? b.provider : null;
    const token = typeof b.token === "string" ? b.token.trim() : "";
    if (!provider || !token) throw new HttpError(422, "provider and token are required.");
    await query(`DELETE FROM push_devices WHERE provider = :'provider' AND token = :'token' AND user_id = :'user'`, {
      provider, token, user: req.userId as string,
    });
    sendJson(res, 204, undefined);
  });
}
