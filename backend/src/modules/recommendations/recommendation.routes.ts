import {homePage} from "./feed-pages";
import {parsePagination,parseQueryString} from "../../http/pagination";
import type { Router } from "../../http/router";
import { requireAuth } from "../../http/middleware/auth.middleware";
import { sendJson } from "../../http/respond";
import * as recommendationService from "./recommendation.service";
import { adsEnabled } from "../ads/ads.service";

export function registerRecommendationRoutes(router: Router): void {
  // Registered before "/api/v1/stories/:id" so "feed" is never mistaken for a story id.
  router.get("/api/v1/stories/feed/home", async (req, res) => {
    requireAuth(req);
    const q=parseQueryString(req.url??"");
    const result=q.limit!==undefined||q.cursor!==undefined?await homePage(req.userId!,parsePagination(q).limit,q.cursor):{feed:await recommendationService.getRankedHomeFeed(req.userId!)};
    sendJson(res,200,{...result,...(adsEnabled()?{sponsoredEnabled:true}:{})});
  });
}
