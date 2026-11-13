import fs from "node:fs";
import path from "node:path";
import type { ServerResponse } from "node:http";
import type { KatkeeRequest, Router } from "../../http/router";
import { requireAuth } from "../../http/middleware/auth.middleware";
import { sendJson } from "../../http/respond";
import { parseQueryString } from "../../http/pagination";
import { RateLimiter } from "../../http/rateLimiter";
import { GIPHY_PAGE, giphyEnabled, giphyStickers } from "./giphy";
import { katkeePack, katkeeSticker, searchKatkeePack, STICKER_DIR } from "./pack";

/** GIPHY's free key allows about 100 searches an hour per key in beta; this keeps one person from using it up. */
const searchLimit = new RateLimiter(60_000, 40);
const files = new Map<string, Buffer>();

/**
 * The GIF tab of the sticker sheet:
 * - GET /api/v1/gifs: Katkee's own pack (categories and stickers);
 * - GET /api/v1/gifs/search?q=&offset=&lang=: the pack's matches first (first page only), then
 *   GIPHY's (trending with no q). `giphy` says whether GIPHY is on, for "Powered by GIPHY";
 * - GET /stickers/<id>.webp: a pack sticker, on the API and katkee.com (stories on the website).
 */
export function registerGifRoutes(router: Router): void {
  router.get("/api/v1/gifs", async (req, res) => {
    requireAuth(req);
    sendJson(res, 200, { ...katkeePack(), giphy: giphyEnabled() });
  });

  router.get("/api/v1/gifs/search", async (req, res) => {
    requireAuth(req);
    searchLimit.check(req.userId!);
    const params = parseQueryString(req.url ?? "");
    const q = (params.q ?? "").slice(0, 50);
    const offset = Math.min(Math.max(0, Number.parseInt(params.offset ?? "0", 10) || 0), 4999);
    const katkee = offset === 0 ? searchKatkeePack(q) : [];
    const giphy = await giphyStickers(q, offset, (params.lang ?? "en").slice(0, 5), fetch);
    sendJson(res, 200, {
      katkee,
      giphy,
      nextOffset: giphy.length === GIPHY_PAGE ? offset + GIPHY_PAGE : null,
      giphyEnabled: giphyEnabled(),
    });
  });

  const serve = (req: KatkeeRequest, res: ServerResponse) => {
    const name = req.params.file ?? "";
    const id = name.endsWith(".webp") ? name.slice(0, -5) : "";
    const sticker = id ? katkeeSticker(id) : null;
    let body = sticker ? files.get(sticker.id) : undefined;
    if (sticker && !body) {
      try {
        body = fs.readFileSync(path.join(STICKER_DIR, `${sticker.id}.webp`));
        files.set(sticker.id, body);
      } catch {
        body = undefined;
      }
    }
    if (!body) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
      res.end("Not found");
      return;
    }
    res.writeHead(200, {
      "Content-Type": "image/webp",
      "Content-Length": body.length,
      // Ids aren't hashed, but a sticker is never redrawn under the same id.
      "Cache-Control": "public, max-age=2592000",
      "Access-Control-Allow-Origin": "*",
      "Cross-Origin-Resource-Policy": "cross-origin",
      "X-Content-Type-Options": "nosniff",
    });
    res.end(req.method === "HEAD" ? undefined : body);
  };
  router.get("/stickers/:file", serve);
  router.add("HEAD", "/stickers/:file", serve);
}
