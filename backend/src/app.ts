import * as fs from "node:fs";
import * as path from "node:path";
import {registerProviderAuthRoutes} from "./modules/auth/provider.routes";
import type {ProviderGateway} from "./modules/auth/providers";
import type { Server } from "node:http";
import { Router } from "./http/router";
import { createServer } from "./http/server";
import { Lifecycle } from "./http/lifecycle";
import { sendJson } from "./http/respond";
import { query } from "./db/psql";
import { registerAuthRoutes } from "./modules/auth/auth.routes";
import { registerUserRoutes } from "./modules/users/users.routes";
import { registerSocialRoutes } from "./modules/social/social.routes";
import { registerSearchRoutes } from "./modules/search/search.routes";
import { registerFestivalRoutes } from "./modules/festivals/festivals";
import { registerStreakRoutes } from "./modules/reminders/return-reasons";
import { registerMediaRoutes } from "./modules/media/media.routes";
import { registerMusicRoutes } from "./modules/music/music.routes";
import { registerStoriesRoutes } from "./modules/stories/stories.routes";
import { registerEngagementRoutes } from "./modules/stories/engagement.routes";
import { registerEventsRoutes } from "./modules/recommendations/events.routes";
import { registerRecommendationRoutes } from "./modules/recommendations/recommendation.routes";
import { registerAreaRoutes } from "./modules/recommendations/area.routes";
import { registerInterestsRoutes } from "./modules/recommendations/interests.routes";
import { registerNotificationsRoutes } from "./modules/notifications/notifications.routes";
import { registerConversationsRoutes } from "./modules/conversations/conversations.routes";
import { registerHighlightsRoutes } from "./modules/highlights/highlights.routes";
import { registerModerationRoutes } from "./modules/moderation/moderation.routes";
import { registerAdminRoutes } from "./modules/admin/admin.routes";
import { registerAdsRoutes } from "./modules/ads/ads.routes";
import { registerAppealRoutes } from "./modules/admin/appeals.routes";
import { registerRealtimeRoutes } from "./realtime/realtime.routes";
import { registerPushRoutes } from "./modules/push/push.routes";
import { registerAnalyticsRoutes } from "./modules/analytics/analytics.routes";
import { registerSupportRoutes } from "./modules/support/support.routes";
import { registerVerificationRoutes } from "./modules/verification/verification.routes";
import { registerWebsiteRoutes, websiteGate } from "./modules/website/website.routes";
import { RealtimeHub } from "./realtime/hub";

/** The API server, with its readiness/shutdown state (see http/lifecycle.ts) and its route table. */
export type KatkeeServer = Server & { lifecycle: Lifecycle; routes: () => Array<{ method: string; path: string }> };

/** The newest migration this build ships (migrations/*.sql, by name). */
const LATEST_MIGRATION = (() => {
  try {
    return fs.readdirSync(path.resolve(process.cwd(), "migrations")).filter((f) => f.endsWith(".sql")).sort().pop()?.replace(/\.sql$/, "") ?? null;
  } catch {
    return null;
  }
})();
let schemaChecked = false;
async function schemaIsCurrent(): Promise<boolean> {
  if (schemaChecked || !LATEST_MIGRATION) return true;
  const rows = await query(`SELECT 1 AS ok FROM schema_migrations WHERE version = :'v'`, { v: LATEST_MIGRATION });
  schemaChecked = rows.length > 0;
  return schemaChecked;
}

export function buildApp(providers?:ProviderGateway): KatkeeServer {
  const router = new Router();
  const lifecycle = new Lifecycle();

  // A real liveness check, not a static 200 — a psql-shim process spawn
  // failure or a database that's actually down would otherwise look
  // identical to a healthy server from outside. Never throws: a failed
  // check reports 503/"down" instead of surfacing as an unhandled 500.
  router.get("/health", async (_req, res) => {
    try {
      await query("SELECT 1");
      sendJson(res, 200, { status: "ok", service: "katkee-backend", db: "up" });
    } catch {
      sendJson(res, 503, { status: "degraded", service: "katkee-backend", db: "down" });
    }
  });

  // Readiness, for load balancers: whether this instance should get new requests. Not ready
  // while it drains for shutdown or while the database is unreachable.
  router.get("/ready", async (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (lifecycle.draining) {
      sendJson(res, 503, { status: "draining" });
      return;
    }
    try {
      await query("SELECT 1");
      // A new version isn't ready until the database has its migrations: otherwise the load
      // balancer would send traffic to code that queries columns that don't exist yet.
      if (!(await schemaIsCurrent())) {
        sendJson(res, 503, { status: "not_ready", db: "migrations pending", expected: LATEST_MIGRATION });
        return;
      }
      sendJson(res, 200, { status: "ready" });
    } catch {
      sendJson(res, 503, { status: "not_ready", db: "down" });
    }
  });

  registerAuthRoutes(router);
  registerProviderAuthRoutes(router,providers);
  registerUserRoutes(router);
  registerSocialRoutes(router);
  registerSearchRoutes(router);
  registerFestivalRoutes(router);
  registerStreakRoutes(router);
  registerMediaRoutes(router);
  registerMusicRoutes(router);
  registerStoriesRoutes(router);
  registerEngagementRoutes(router);
  registerEventsRoutes(router);
  registerRecommendationRoutes(router);
  registerAreaRoutes(router);
  registerInterestsRoutes(router);
  registerNotificationsRoutes(router);
  registerConversationsRoutes(router);
  registerHighlightsRoutes(router);
  registerModerationRoutes(router);
  registerAdminRoutes(router);
  registerAdsRoutes(router);
  registerAppealRoutes(router);
  registerAnalyticsRoutes(router);
  registerSupportRoutes(router);
  registerVerificationRoutes(router);
  registerRealtimeRoutes(router);
  registerPushRoutes(router);
  registerWebsiteRoutes(router);

  const server = createServer(router, lifecycle, websiteGate);
  // Realtime connections share the HTTP port; closing the server also closes them.
  const hub = new RealtimeHub().attach(server);
  const close = server.close.bind(server);
  server.close = ((callback?: (error?: Error) => void) => {
    void hub.stop();
    return close(callback);
  }) as typeof server.close;
  return Object.assign(server, { lifecycle, routes: () => router.list() });
}
