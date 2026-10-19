import type { Router } from "../../http/router";
import { requireAuth } from "../../http/middleware/auth.middleware";
import { sendJson } from "../../http/respond";
import { parsePagination, parseQueryString } from "../../http/pagination";
import { HttpError } from "../../http/errors";
import { cdnEnabled, signedCdnUrl } from "../media/delivery";
import { mediaStorage } from "../media/instance";
import { streamObject } from "../media/stream";
import * as musicService from "./music.service";
import { listMoods } from "./music.repository";

export function registerMusicRoutes(router: Router): void {
  // The song picker: ?q= searches title and artist, ?mood= filters.
  router.get("/api/v1/music", async (req, res) => {
    requireAuth(req);
    const params = parseQueryString(req.url ?? "");
    const { limit, offset } = parsePagination(params);
    const [tracks, moods] = await Promise.all([musicService.listTracks(params.q ?? "", params.mood ?? "", limit, offset), offset === 0 ? listMoods() : Promise.resolve(undefined)]);
    sendJson(res, 200, { tracks, limit, offset, ...(moods ? { moods } : {}) });
  });

  router.get("/api/v1/music/:id/file", async (req, res) => {
    requireAuth(req);
    const track = await musicService.requireTrack(req.params.id as string);
    if (cdnEnabled()) {
      res.writeHead(302, { Location: signedCdnUrl(track.storageKey).url, "Cache-Control": "private, no-store" });
      res.end();
      return;
    }
    const info = await mediaStorage.head(track.storageKey);
    if (!info) throw new HttpError(404, "Song not found.");
    await streamObject(req, res, { key: track.storageKey, mimeType: track.mimeType, size: info.size, etag: `"music-${track.id}"` }, mediaStorage);
  });
}
