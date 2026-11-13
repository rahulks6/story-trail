import { apiGet } from "./client";
import { appEnv } from "../config/env";

/**
 * Moving stickers for the GIF tab: Katkee's own pack and GIPHY. Shapes mirror
 * backend/src/modules/gifs (pack.ts, giphy.ts, gifs.routes.ts).
 */
export interface KatkeeSticker {
  id: string;
  category: string;
  tags: string[];
  /** On Katkee's server: /stickers/<id>.webp. */
  url: string;
  size: number;
}

export interface GiphySticker {
  id: string;
  url: string;
  previewUrl: string;
  width: number;
  height: number;
  title: string;
}

export function getStickerPack(accessToken: string): Promise<{ categories: string[]; stickers: KatkeeSticker[]; giphy: boolean }> {
  return apiGet("/api/v1/gifs", accessToken);
}

export function searchGifs(accessToken: string, q: string, offset: number, lang: string): Promise<{ katkee: KatkeeSticker[]; giphy: GiphySticker[]; nextOffset: number | null; giphyEnabled: boolean }> {
  const query = new URLSearchParams({ q: q.trim(), offset: String(offset), lang });
  return apiGet(`/api/v1/gifs/search?${query.toString()}`, accessToken);
}

/** A sticker address the phone can load: Katkee's own are paths on the API's server. */
export function stickerImageUrl(url: string): string {
  return url.startsWith("/") ? `${appEnv.apiBaseUrl}${url}` : url;
}
