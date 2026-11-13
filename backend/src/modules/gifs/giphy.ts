import { config } from "../../config/env";

/**
 * GIPHY stickers (moving, see-through), searched through this server so GIPHY sees Katkee's
 * server, not the person: no account, no IP address, no device. The phone then shows each sticker
 * from GIPHY's own servers (GIPHY's terms ask for that), as it would any image.
 *
 * On only with a real API key (GIPHY_API_KEY: letters and digits). The stack's placeholder for the
 * secret has punctuation, so deploying before the key is added just leaves GIPHY off.
 */
export const GIPHY_ID = /^[A-Za-z0-9]{5,40}$/;
const PAGE = 24;
const CACHE_MS = 10 * 60_000;
const CACHE_MAX = 500;
const TIMEOUT_MS = 5000;
/** GIPHY's content rating: "pg" keeps out anything a family wouldn't share. */
const RATING = "pg";
const LANGS = new Set(["en", "hi", "mr", "bn", "ta", "te", "gu", "kn", "ml", "pa", "ur"]);

export interface GiphySticker {
  id: string;
  /** The animated sticker (WebP, about 200 px wide). */
  url: string;
  /** A lighter version for the picker grid. */
  previewUrl: string;
  width: number;
  height: number;
  title: string;
}

export function giphyEnabled(): boolean {
  return /^[A-Za-z0-9]{20,64}$/.test(config.giphy.apiKey);
}

/**
 * The address, if it's one of GIPHY's media servers (a sticker can't point anywhere else): https,
 * media.giphy.com, media0-4.giphy.com or i.giphy.com, a plain path to a .gif or .webp.
 */
export function giphyMediaUrl(raw: string): string | null {
  // ".." is refused before parsing, which would quietly resolve it.
  if (raw.length > 600 || raw.includes("..")) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
  if (!/^(media[0-4]?|i)\.giphy\.com$/.test(url.hostname)) return null;
  if (!/^\/[A-Za-z0-9._=/-]+\.(gif|webp)$/.test(url.pathname) || url.pathname.includes("..")) return null;
  if (!/^[A-Za-z0-9=&._-]*$/.test(url.search.slice(1))) return null;
  return url.toString();
}

interface GiphyImage { url?: string; webp?: string; width?: string; height?: string }
interface GiphyItem { id?: string; title?: string; images?: Record<string, GiphyImage | undefined> }

function toSticker(item: GiphyItem): GiphySticker | null {
  const id = typeof item.id === "string" && GIPHY_ID.test(item.id) ? item.id : null;
  const full = item.images?.fixed_width;
  const small = item.images?.fixed_width_small ?? full;
  const url = full ? giphyMediaUrl(full.webp ?? full.url ?? "") : null;
  const previewUrl = small ? giphyMediaUrl(small.webp ?? small.url ?? "") : null;
  const width = Number(full?.width), height = Number(full?.height);
  if (!id || !url || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  return { id, url, previewUrl: previewUrl ?? url, width, height, title: typeof item.title === "string" ? item.title.slice(0, 80) : "" };
}

const cache = new Map<string, { at: number; stickers: GiphySticker[] }>();

/** Trending stickers (no query) or a search, a page at a time. [] when GIPHY is off or fails. */
export async function giphyStickers(query: string, offset: number, lang: string, fetcher: typeof fetch = fetch): Promise<GiphySticker[]> {
  if (!giphyEnabled()) return [];
  const q = query.trim().slice(0, 50);
  const language = LANGS.has(lang) ? lang : "en";
  const key = `${q.toLowerCase()}|${offset}|${language}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.stickers;

  const params = new URLSearchParams({ api_key: config.giphy.apiKey, limit: String(PAGE), offset: String(offset), rating: RATING });
  if (q) {
    params.set("q", q);
    params.set("lang", language);
  }
  const endpoint = `${config.giphy.endpoint}/v1/stickers/${q ? "search" : "trending"}?${params}`;
  try {
    const res = await fetcher(endpoint, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return [];
    const body = (await res.json()) as { data?: GiphyItem[] };
    const stickers = (body.data ?? []).map(toSticker).filter((s): s is GiphySticker => s !== null);
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
    cache.set(key, { at: Date.now(), stickers });
    return stickers;
  } catch {
    return [];
  }
}

export const GIPHY_PAGE = PAGE;

/** For tests. */
export function clearGiphyCache(): void {
  cache.clear();
}
