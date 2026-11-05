import {homePage} from "./feed-pages";
import {parsePagination,parseQueryString} from "../../http/pagination";
import type { Router } from "../../http/router";
import { requireAuth } from "../../http/middleware/auth.middleware";
import { sendJson } from "../../http/respond";
import * as recommendationService from "./recommendation.service";
import { adsEnabled } from "../ads/ads.service";
import { query } from "../../db/psql";
import { mapMediaRow, MEDIA_COLUMNS } from "../media/media.repository";
import { deliveryFor } from "../media/delivery";

export function registerRecommendationRoutes(router: Router): void {
  // Registered before "/api/v1/stories/:id" so "feed" is never mistaken for a story id.
  router.get("/api/v1/stories/feed/home", async (req, res) => {
    requireAuth(req);
    const q=parseQueryString(req.url??"");
    const result=q.limit!==undefined||q.cursor!==undefined?await homePage(req.userId!,parsePagination(q).limit,q.cursor):{feed:await recommendationService.getRankedHomeFeed(req.userId!)};
    // Which topics ranked an entry where is for ranking only; it doesn't leave the server.
    const feed=result.feed.map(({ranking:_ranking,...entry})=>entry);
    sendJson(res,200,{...result,feed,...(adsEnabled()?{sponsoredEnabled:true}:{})});
  });

  // Explore: popular public Stories from new people, one tile each (recommendation.service.ts).
  router.get("/api/v1/explore", async (req, res) => {
    requireAuth(req);
    const tiles = await recommendationService.getExplore(req.userId!);
    const ids = tiles.map((t) => t.story.mediaId);
    const media = ids.length
      ? new Map((await query(`SELECT ${MEDIA_COLUMNS} FROM media WHERE id = ANY(string_to_array(:'ids', ',')::uuid[])`, { ids: ids.join(",") })).map((r) => {
        const m = mapMediaRow(r);
        return [m.id, m] as const;
      }))
      : new Map();
    // Only tiles whose picture is ready; the tile is the thumbnail (or a video's first frame).
    const explore = tiles.flatMap((t) => {
      const m = media.get(t.story.mediaId);
      if (!m || m.status !== "ready") return [];
      const delivery = deliveryFor(m, false);
      if (!delivery.thumbnailUrl && !delivery.imageUrl) return [];
      return [{ owner: t.owner, story: { ...t.story, kind: m.kind, thumbnailUrl: delivery.thumbnailUrl, imageUrl: delivery.imageUrl, urlsExpireAt: delivery.urlsExpireAt } }];
    });
    sendJson(res, 200, { explore });
  });
}
