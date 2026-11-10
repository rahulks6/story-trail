/**
 * Song stickers: a popular song shown on a Story as a link to where it's licensed to play
 * (Spotify, YouTube Music, YouTube). Katkee never plays or stores the song: the sticker shows
 * its title, artist and cover, and a tap opens the official app. That's how Katkee offers any
 * song without a label licence (docs/MUSIC.md).
 *
 * The title, artist and cover come from the services' public oEmbed / page metadata, looked
 * up here (the app sends only the link) and cached briefly.
 */
import { HttpError } from "../../http/errors";

export type SongProvider = "spotify" | "youtube_music" | "youtube";

export interface SongInfo {
  provider: SongProvider;
  /** The canonical link the sticker opens (tracking parameters dropped). */
  url: string;
  title: string;
  artist: string;
  /** The cover from the service's own image CDN, or null. */
  artworkUrl: string | null;
}

export const MAX_SONG_TEXT_LENGTH = 120;
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const SPOTIFY_ID = /^[A-Za-z0-9]{22}$/;

/**
 * A link someone pasted, as the canonical song link it names, or null when it isn't a song on a
 * supported service. Spotify short links (spotify.link/...) need a lookup: see resolveShortLink.
 */
export function parseSongUrl(raw: unknown): { provider: SongProvider; url: string } | null {
  if (typeof raw !== "string") return null;
  const text = raw.trim();
  if (!text || text.length > 2048 || /\s/.test(text)) return null;
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username || url.password) return null;
  const host = url.hostname.toLowerCase();
  const parts = url.pathname.split("/").filter(Boolean);

  if (host === "open.spotify.com") {
    // open.spotify.com/track/<id>, also with a locale first: /intl-hi/track/<id>
    const i = parts[0]?.startsWith("intl-") ? 1 : 0;
    if (parts[i] === "track" && SPOTIFY_ID.test(parts[i + 1] ?? "")) return { provider: "spotify", url: `https://open.spotify.com/track/${parts[i + 1]}` };
    return null;
  }
  if (host === "music.youtube.com") {
    const v = url.searchParams.get("v") ?? "";
    return YOUTUBE_ID.test(v) ? { provider: "youtube_music", url: `https://music.youtube.com/watch?v=${v}` } : null;
  }
  if (host === "youtube.com" || host === "www.youtube.com" || host === "m.youtube.com") {
    const v = parts[0] === "shorts" ? parts[1] ?? "" : url.searchParams.get("v") ?? "";
    return YOUTUBE_ID.test(v) ? { provider: "youtube", url: `https://www.youtube.com/watch?v=${v}` } : null;
  }
  if (host === "youtu.be") {
    const v = parts[0] ?? "";
    return YOUTUBE_ID.test(v) ? { provider: "youtube", url: `https://www.youtube.com/watch?v=${v}` } : null;
  }
  return null;
}

/** Covers come only from the services' own image hosts, so a sticker can't point the app at anything else. */
export function allowedArtworkUrl(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > 1024) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") return null;
    const host = url.hostname.toLowerCase();
    const ok = host === "i.scdn.co" || host.endsWith(".spotifycdn.com") || host === "i.ytimg.com" || host.endsWith(".googleusercontent.com");
    return ok ? url.toString() : null;
  } catch {
    return null;
  }
}

export function songText(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const one = raw.replace(/\s+/g, " ").trim();
  return Array.from(one).slice(0, MAX_SONG_TEXT_LENGTH).join("").trim();
}

/** "Kesariya (Official Video) | Brahmastra" -> "Kesariya | Brahmastra": the noise video titles carry. */
export function tidyVideoTitle(title: string): string {
  return title
    .replace(/\s*[([](?:[^)\]]*\b(?:official|video|lyric|lyrics|audio|visualizer|4k|hd|full song|music video)\b[^)\]]*)[)\]]/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

const decodeEntities = (s: string) =>
  s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");

function metaContent(html: string, property: string): string | null {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${property}["'][^>]*content=["']([^"']*)["']`, "i");
  const alt = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${property}["']`, "i");
  const m = re.exec(html) ?? alt.exec(html);
  return m ? decodeEntities(m[1]!) : null;
}

type Fetch = typeof fetch;
const UA = "Mozilla/5.0 (compatible; KatkeeBot/1.0; +https://katkee.com)";

/** spotify.link/<code> redirects to an open.spotify.com link; follow at most three hops. */
async function resolveShortLink(raw: string, fetchImpl: Fetch): Promise<string | null> {
  let current = /^https?:\/\//i.test(raw.trim()) ? raw.trim() : `https://${raw.trim()}`;
  for (let hop = 0; hop < 3; hop++) {
    let host: string;
    try {
      host = new URL(current).hostname.toLowerCase();
    } catch {
      return null;
    }
    if (host !== "spotify.link" && host !== "spotify.app.link") return current;
    const res = await fetchImpl(current, { redirect: "manual", headers: { "User-Agent": UA }, signal: AbortSignal.timeout(5000) });
    const next = res.headers.get("location");
    if (!next) return null;
    current = new URL(next, current).toString();
  }
  return current;
}

async function lookupSpotify(url: string, fetchImpl: Fetch): Promise<Omit<SongInfo, "provider" | "url">> {
  // The track page's Open Graph tags carry the artist ("Arijit Singh · Brahmastra · Song · 2022").
  const page = await fetchImpl(url, { headers: { "User-Agent": UA, "Accept-Language": "en" }, signal: AbortSignal.timeout(6000) });
  if (!page.ok) throw new HttpError(404, "Couldn't find that song on Spotify.");
  const html = await page.text();
  const title = songText(metaContent(html, "og:title"));
  const description = metaContent(html, "og:description") ?? "";
  const artist = songText(metaContent(html, "music:musician_description") ?? description.split(" · ")[0] ?? "");
  if (!title) throw new HttpError(404, "Couldn't find that song on Spotify.");
  return { title, artist, artworkUrl: allowedArtworkUrl(metaContent(html, "og:image")) };
}

async function lookupYouTube(url: string, fetchImpl: Fetch): Promise<Omit<SongInfo, "provider" | "url">> {
  // YouTube Music links resolve through YouTube's oEmbed (same video id).
  const watch = url.replace("https://music.youtube.com/", "https://www.youtube.com/");
  const res = await fetchImpl(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(watch)}`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(6000) });
  if (!res.ok) throw new HttpError(404, "Couldn't find that song on YouTube.");
  const data = (await res.json()) as { title?: unknown; author_name?: unknown; thumbnail_url?: unknown };
  let title = songText(tidyVideoTitle(typeof data.title === "string" ? data.title : ""));
  // Auto-generated music channels are "Artist - Topic"; a label's channel (T-Series) stays as is.
  const artist = songText(typeof data.author_name === "string" ? data.author_name.replace(/\s+-\s+Topic$/i, "") : "");
  // "Artist - Song" from the artist's own channel: the artist is already shown, keep the song.
  const prefix = /^(.{1,80}?)\s+[-–—]\s+(.+)$/.exec(title);
  if (prefix && artist && prefix[1]!.toLowerCase() === artist.toLowerCase()) title = songText(prefix[2]!);
  if (!title) throw new HttpError(404, "Couldn't find that song on YouTube.");
  return { title, artist, artworkUrl: allowedArtworkUrl(data.thumbnail_url) };
}

const cache = new Map<string, { at: number; info: SongInfo }>();
const CACHE_MS = 6 * 60 * 60 * 1000;
const CACHE_MAX = 2000;

/** The song a pasted link names, with its title, artist and cover. */
export async function lookupSong(raw: unknown, fetchImpl: Fetch = fetch): Promise<SongInfo> {
  let parsed = parseSongUrl(raw);
  if (!parsed && typeof raw === "string" && /^(https?:\/\/)?spotify\.(link|app\.link)\//i.test(raw.trim())) {
    const resolved = await resolveShortLink(raw, fetchImpl).catch(() => null);
    parsed = resolved ? parseSongUrl(resolved) : null;
  }
  if (!parsed) {
    throw new HttpError(422, "Paste a song link from Spotify, YouTube Music or YouTube.", { url: "Paste a song link from Spotify, YouTube Music or YouTube." });
  }
  const hit = cache.get(parsed.url);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.info;
  let details: Omit<SongInfo, "provider" | "url">;
  try {
    details = parsed.provider === "spotify" ? await lookupSpotify(parsed.url, fetchImpl) : await lookupYouTube(parsed.url, fetchImpl);
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(503, "Couldn't reach the music service. Try again in a moment.");
  }
  const info: SongInfo = { provider: parsed.provider, url: parsed.url, ...details };
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
  cache.set(parsed.url, { at: Date.now(), info });
  return info;
}
