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
import { registerMediaRoutes } from "./modules/media/media.routes";
import { registerStoriesRoutes } from "./modules/stories/stories.routes";
import { registerEngagementRoutes } from "./modules/stories/engagement.routes";
import { registerEventsRoutes } from "./modules/recommendations/events.routes";
import { registerRecommendationRoutes } from "./modules/recommendations/recommendation.routes";
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
import { RealtimeHub } from "./realtime/hub";

/** The API server, with its readiness/shutdown state (see http/lifecycle.ts). */
export type KatkeeServer = Server & { lifecycle: Lifecycle };

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
  registerMediaRoutes(router);
  registerStoriesRoutes(router);
  registerEngagementRoutes(router);
  registerEventsRoutes(router);
  registerRecommendationRoutes(router);
  registerNotificationsRoutes(router);
  registerConversationsRoutes(router);
  registerHighlightsRoutes(router);
  registerModerationRoutes(router);
  registerAdminRoutes(router);
  registerAdsRoutes(router);
  registerAppealRoutes(router);
  registerAnalyticsRoutes(router);
  registerRealtimeRoutes(router);
  registerPushRoutes(router);

  const server = createServer(router, lifecycle);
  // Realtime connections share the HTTP port; closing the server also closes them.
  const hub = new RealtimeHub().attach(server);
  const close = server.close.bind(server);
  server.close = ((callback?: (error?: Error) => void) => {
    void hub.stop();
    return close(callback);
  }) as typeof server.close;
  return Object.assign(server, { lifecycle });
}
