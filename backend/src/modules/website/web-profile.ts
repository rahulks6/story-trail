/**
 * Public Katkee on the web: what katkee.com/u/<username> and /s/<story id> show to someone who
 * isn't signed in (website.routes.ts serves it).
 *
 * One rule decides everything here: an account shows on the web only while it is public, active,
 * in good standing (not restricted, suspended or disabled by moderators), not deleted, and has
 * "Show my profile on the web" on (Settings > Privacy). Every other account gets the same minimal
 * "Open in Katkee" page as an account that doesn't exist, so the web never says which it is.
 *
 * Of a shown account, only Stories whose audience is "public" appear, never followers-only or
 * Close Friends ones, never a deleted or removed one: its active Stories (the ring), and its
 * Highlights' public Stories. Nobody is signed in, so nothing is personal: no likes, comments,
 * view counts, sticker results or quiz answers, and watching never counts as a view, a profile
 * visit or reach (PUBLIC_STORY_VIEW_POLICY.md). Media goes through this site's own addresses
 * (/u/<username>/photo, /s/<id>/image, ...), which check the rule again on every request and
 * then hand over a short-lived signed CDN URL, the way the API delivers media to the app.
 */
import { query, queryOne, type Row } from "../../db/psql";
import { verifiedSql } from "../../shared/verified";
import * as mediaRepo from "../media/media.repository";
import type { MediaRecord } from "../media/media.repository";
import * as musicRepo from "../music/music.repository";
import * as socialRepo from "../social/social.repository";

/** The account rule, for a users row `u`. */
const WEB_ACCOUNT_SQL = `u.deleted_at IS NULL AND u.is_active AND u.moderation_state = 'ACTIVE' AND NOT u.is_private AND u.show_on_web`;
/** The Story rule, for a stories row `s` (expiry is the caller's: Highlights keep expired Stories). */
const WEB_STORY_SQL = `s.audience = 'public' AND s.deleted_at IS NULL AND s.moderation_removed_at IS NULL`;
const STORY_COLUMNS = "s.id, s.owner_id, s.media_id, s.caption, s.created_at, s.expires_at, s.overlays, s.drawing, s.audio_muted, s.crop, s.music";

/** Enough for any real profile; a page never grows without bound. */
const MAX_STORIES = 100;
const MAX_HIGHLIGHTS = 50;
const MAX_HIGHLIGHT_ITEMS = 100;

export interface WebAccount {
  id: string;
  username: string;
  displayName: string;
  bio: string;
  interests: string[];
  verified: boolean;
  /** A professional account's category, when its owner shows it; null otherwise. */
  professionalCategory: string | null;
  followers: number;
  following: number;
  /** The photos' media IDs, only when there is a photo the web may show. */
  photoId: string | null;
  coverId: string | null;
}

interface StoryRow {
  id: string;
  ownerId: string;
  mediaId: string;
  caption: string;
  createdAt: string;
  expiresAt: string;
  overlays: unknown[];
  drawing: unknown[];
  audioMuted: boolean;
  crop: { zoom: number; offsetX: number; offsetY: number };
  music: { trackId: string } | null;
}

/** What the web player gets for one Story: addresses on this site, never storage keys or IDs of anything else. */
export interface WebStory {
  id: string;
  kind: "photo" | "video";
  image: string;
  video: string | null;
  durationMs: number | null;
  createdAt: string;
  caption: string;
  muted: boolean;
  crop: { zoom: number; offsetX: number; offsetY: number };
  overlays: WebOverlay[];
  drawing: WebStroke[];
  music: { title: string; artist: string } | null;
}
export type WebOverlay = { type: string; x: number; y: number; scale: number; rotation: number; z: number } & Record<string, unknown>;
export interface WebStroke { tool: string; color: string; width: number; points: [number, number][] }

export interface WebHighlight { id: string; title: string; cover: string; items: WebStory[] }

export interface WebProfile {
  account: WebAccount;
  stories: WebStory[];
  highlights: WebHighlight[];
}

const parseJson = <T>(raw: string | null | undefined, fallback: T): T => {
  if (!raw) return fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
};

function parseInterests(raw: string | null): string[] {
  const parsed = parseJson<unknown>(raw, []);
  return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string").slice(0, 5) : [];
}

/** A profile photo or cover the web may show: the owner's own processed photo, never anything moderated or private. */
function showablePhoto(media: MediaRecord | undefined | null, ownerId: string): boolean {
  return !!media && media.ownerId === ownerId && media.kind === "photo" && media.status === "ready" && !media.purgedAt
    && !media.verificationDocument && !media.exportOverlay;
}

/**
 * The account at /u/<username> (or, after a rename, the one whose permanent ID the link
 * carries), when it shows on the web; null for every other case alike.
 */
export async function findWebAccount(username: string, id: string | null): Promise<WebAccount | null> {
  const row = await queryOne(
    `SELECT u.id, u.username, u.display_name, u.bio, u.interests_json, u.avatar_media_id, u.cover_media_id,
            ${verifiedSql("u")} AS verified, u.professional_category, u.professional_category_shown
     FROM users u
     WHERE (u.username = :'username' OR u.id = NULLIF(:'id', '')::uuid) AND ${WEB_ACCOUNT_SQL}
     ORDER BY (u.username = :'username') DESC
     LIMIT 1`,
    { username, id: id ?? "" },
  );
  if (!row) return null;
  const accountId = row.id as string;
  // Excluding moderated media: a photo moderators removed never shows.
  const [counts, photo, cover] = await Promise.all([
    socialRepo.followCounts(accountId),
    row.avatar_media_id ? mediaRepo.findMediaById(row.avatar_media_id, true) : null,
    row.cover_media_id ? mediaRepo.findMediaById(row.cover_media_id, true) : null,
  ]);
  return {
    id: accountId,
    username: row.username as string,
    displayName: row.display_name as string,
    bio: row.bio ?? "",
    interests: parseInterests(row.interests_json ?? null),
    verified: row.verified === "t",
    professionalCategory: row.professional_category_shown !== "f" ? row.professional_category ?? null : null,
    followers: counts.followers,
    following: counts.following,
    photoId: showablePhoto(photo, accountId) ? photo!.id : null,
    coverId: showablePhoto(cover, accountId) ? cover!.id : null,
  };
}

function mapStory(row: Row): StoryRow {
  const crop = parseJson<{ zoom?: unknown; offsetX?: unknown; offsetY?: unknown }>(row.crop ?? null, {});
  const music = parseJson<{ trackId?: unknown } | null>(row.music ?? null, null);
  return {
    id: row.id as string,
    ownerId: row.owner_id as string,
    mediaId: row.media_id as string,
    caption: row.caption ?? "",
    createdAt: row.created_at as string,
    expiresAt: row.expires_at as string,
    overlays: parseJson<unknown[]>(row.overlays, []),
    drawing: parseJson<unknown[]>(row.drawing, []),
    audioMuted: row.audio_muted === "t",
    crop: {
      zoom: clamp(Number(crop.zoom) || 1, 1, 4),
      offsetX: clamp(Number(crop.offsetX) || 0, -1, 1),
      offsetY: clamp(Number(crop.offsetY) || 0, -1, 1),
    },
    music: music && typeof music.trackId === "string" ? { trackId: music.trackId } : null,
  };
}

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
const finite = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
const text = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
const COLOR = /^#[0-9a-f]{3,8}$/i;
const color = (v: unknown, fallback: string | null) => (typeof v === "string" && COLOR.test(v) ? v : fallback);

/**
 * An overlay as the web draws it: its place and only the properties a signed-out viewer may see.
 * Results, answers, response counts, reminders and a quiz's correct answer are never included;
 * interactive stickers show read-only. A mention shows the account's name as it is now, and is
 * dropped when that account is gone.
 */
function webOverlay(raw: unknown, mentioned: Map<string, { username: string; verified: boolean }>): WebOverlay | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as { type?: unknown; x?: unknown; y?: unknown; scale?: unknown; rotation?: unknown; zIndex?: unknown; properties?: Record<string, unknown> };
  const p = o.properties ?? {};
  const place = {
    x: clamp(finite(o.x, 0.5), -0.5, 1.5), y: clamp(finite(o.y, 0.5), -0.5, 1.5),
    scale: clamp(finite(o.scale, 1), 0.1, 10), rotation: clamp(finite(o.rotation, 0), -3600, 3600), z: Math.round(clamp(finite(o.zIndex, 0), 0, 1000)),
  };
  const options = (v: unknown) => (Array.isArray(v) ? v.slice(0, 4).map((x) => text(x, 40)) : []);
  switch (o.type) {
    case "text": {
      const align = p.align === "left" || p.align === "right" ? p.align : "center";
      return {
        type: "text", ...place, text: text(p.text, 500), style: text(p.style, 20) || "Clean", color: color(p.color, "#FFFFFF"),
        background: color(p.backgroundColor, null), align, fontSize: clamp(finite(p.fontSize, 0.04), 0.01, 0.3),
      };
    }
    case "emoji": return { type: "emoji", ...place, emoji: text(p.emoji, 16) };
    case "sticker": return { type: "sticker", ...place, sticker: text(p.stickerId, 20) };
    case "location": return { type: "location", ...place, label: text(p.label, 80) };
    case "datetime": return { type: "datetime", ...place, label: text(p.display, 80) };
    case "mention": {
      const who = typeof p.userId === "string" ? mentioned.get(p.userId) : undefined;
      return who ? { type: "mention", ...place, username: who.username, verified: who.verified } : null;
    }
    case "link": {
      const url = text(p.url, 2048);
      if (!/^https?:\/\/[^\s]+$/i.test(url)) return null;
      return { type: "link", ...place, url, label: text(p.label, 40) };
    }
    case "song": {
      // On the web, a song sticker is a link to the song (Spotify / YouTube), labelled with its title.
      const url = text(p.url, 2048);
      if (!/^https:\/\/(open\.spotify\.com|music\.youtube\.com|www\.youtube\.com)\/[^\s]+$/i.test(url)) return null;
      return { type: "link", ...place, url, label: text(`♪ ${text(p.title, 120)}`, 40) };
    }
    case "poll": case "quiz": return { type: o.type, ...place, question: text(p.question, 80), options: options(p.options) };
    case "question": return { type: "question", ...place, prompt: text(p.prompt, 80) };
    case "countdown": return { type: "countdown", ...place, title: text(p.title, 40), endsAt: text(p.endsAt, 40) };
    case "addYours": return { type: "addYours", ...place, prompt: text(p.prompt, 80) };
    default: return null;
  }
}

function webStroke(raw: unknown): WebStroke | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as { tool?: unknown; color?: unknown; width?: unknown; points?: unknown };
  if (!Array.isArray(s.points) || s.points.length === 0) return null;
  const points = s.points.slice(0, 2000).flatMap((pt): [number, number][] => {
    const { x, y } = (pt ?? {}) as { x?: unknown; y?: unknown };
    return typeof x === "number" && typeof y === "number" && Number.isFinite(x) && Number.isFinite(y) ? [[Math.round(x * 1e4) / 1e4, Math.round(y * 1e4) / 1e4]] : [];
  });
  const tool = s.tool === "marker" || s.tool === "highlighter" ? s.tool : "pen";
  return s.tool === "eraser" || !points.length ? null : { tool, color: color(s.color, "#FFFFFF")!, width: clamp(finite(s.width, 0.01), 0.001, 0.2), points };
}

/** Stories as the player gets them; Stories whose media isn't ready (or was removed) are left out. */
async function webStories(rows: StoryRow[]): Promise<WebStory[]> {
  const mentionIds = rows.flatMap((r) => r.overlays.flatMap((o) => {
    const p = (o as { type?: unknown; properties?: { userId?: unknown } } | null);
    return p?.type === "mention" && typeof p.properties?.userId === "string" && /^[0-9a-f-]{36}$/i.test(p.properties.userId) ? [p.properties.userId] : [];
  }));
  const [media, tracks, mentionRows] = await Promise.all([
    mediaRepo.findMediaByIds(rows.map((r) => r.mediaId)),
    musicRepo.findTracksByIds(rows.flatMap((r) => (r.music ? [r.music.trackId] : []))),
    mentionIds.length
      ? query(`SELECT id, username, ${verifiedSql()} AS verified FROM users WHERE id = ANY (string_to_array(:'ids', ',')::uuid[]) AND deleted_at IS NULL AND is_active`, { ids: [...new Set(mentionIds)].join(",") })
      : Promise.resolve([] as Row[]),
  ]);
  const mentioned = new Map(mentionRows.map((r) => [r.id as string, { username: r.username as string, verified: r.verified === "t" }]));
  const out: WebStory[] = [];
  for (const row of rows) {
    const m = media.get(row.mediaId);
    if (!m || m.status !== "ready" || m.purgedAt || m.verificationDocument || m.exportOverlay || (m.kind !== "photo" && m.kind !== "video")) continue;
    const track = row.music ? tracks.get(row.music.trackId) : undefined;
    out.push({
      id: row.id,
      kind: m.kind,
      image: `/s/${row.id}/image`,
      video: m.kind === "video" ? `/s/${row.id}/video` : null,
      durationMs: m.durationMs,
      createdAt: new Date(row.createdAt).toISOString(),
      caption: row.caption.slice(0, 2200),
      muted: row.audioMuted,
      crop: row.crop,
      overlays: row.overlays.map((o) => webOverlay(o, mentioned)).filter((o): o is WebOverlay => o !== null),
      drawing: row.drawing.map(webStroke).filter((s): s is WebStroke => s !== null),
      music: track ? { title: track.title, artist: track.artist } : null,
    });
  }
  return out;
}

/** Everything /u/<username> shows of an account already found by findWebAccount. */
export async function webProfile(account: WebAccount): Promise<WebProfile> {
  const [active, highlightRows] = await Promise.all([
    query(
      `SELECT ${STORY_COLUMNS} FROM stories s
       WHERE s.owner_id = :'owner' AND ${WEB_STORY_SQL} AND s.expires_at > now()
       ORDER BY s.created_at ASC LIMIT ${MAX_STORIES}`,
      { owner: account.id },
    ),
    query(
      `SELECT h.id AS highlight_id, h.title, h.cover_story_id, ${STORY_COLUMNS}
       FROM (SELECT * FROM highlights WHERE owner_id = :'owner' ORDER BY position ASC, created_at ASC LIMIT ${MAX_HIGHLIGHTS}) h
       JOIN LATERAL (
         SELECT hi.story_id, hi.position FROM highlight_items hi JOIN stories s ON s.id = hi.story_id
         WHERE hi.highlight_id = h.id AND s.owner_id = h.owner_id AND ${WEB_STORY_SQL}
         ORDER BY hi.position ASC LIMIT ${MAX_HIGHLIGHT_ITEMS}
       ) items ON true
       JOIN stories s ON s.id = items.story_id
       ORDER BY h.position ASC, h.created_at ASC, h.id, items.position ASC`,
      { owner: account.id },
    ),
  ]);
  const stories = await webStories(active.map(mapStory));
  const byId = new Map((await webStories(highlightRows.map(mapStory))).map((s) => [s.id, s]));
  const highlights: WebHighlight[] = [];
  for (const row of highlightRows) {
    const story = byId.get(row.id as string);
    if (!story) continue;
    let highlight: WebHighlight | undefined = highlights[highlights.length - 1];
    if (!highlight || highlight.id !== row.highlight_id) {
      highlight = { id: row.highlight_id as string, title: row.title ?? "", cover: "", items: [] };
      highlights.push(highlight);
    }
    highlight.items.push(story);
    // The chosen cover when it is one of the Stories shown here; else the first.
    if (!highlight.cover || row.cover_story_id === story.id) highlight.cover = `/s/${story.id}/thumb`;
  }
  return { account, stories, highlights };
}

/** The account whose active, public Story /s/<id> is, when both show on the web. */
export async function findWebStoryOwner(storyId: string): Promise<{ account: WebAccount; storyId: string } | null> {
  const row = await queryOne(
    `SELECT u.username, u.id FROM stories s JOIN users u ON u.id = s.owner_id
     WHERE s.id = :'id' AND ${WEB_STORY_SQL} AND s.expires_at > now() AND ${WEB_ACCOUNT_SQL}`,
    { id: storyId },
  );
  if (!row) return null;
  const account = await findWebAccount(row.username as string, row.id as string);
  return account ? { account, storyId } : null;
}

/**
 * The media of a Story the web may show right now: public, live or in one of its owner's
 * Highlights, and its owner shows on the web. Null for anything else.
 */
export async function webStoryMedia(storyId: string): Promise<MediaRecord | null> {
  const row = await queryOne(
    `SELECT s.media_id, s.owner_id FROM stories s JOIN users u ON u.id = s.owner_id
     WHERE s.id = :'id' AND ${WEB_STORY_SQL} AND ${WEB_ACCOUNT_SQL}
       AND (s.expires_at > now() OR EXISTS (SELECT 1 FROM highlight_items hi JOIN highlights h ON h.id = hi.highlight_id
                                            WHERE hi.story_id = s.id AND h.owner_id = s.owner_id))`,
    { id: storyId },
  );
  if (!row?.media_id) return null;
  const media = await mediaRepo.findMediaById(row.media_id, true);
  if (!media || media.ownerId !== row.owner_id || media.verificationDocument || media.exportOverlay) return null;
  return media;
}

/** A shown account's profile photo or cover. */
export async function webProfilePhoto(username: string, which: "photo" | "cover"): Promise<MediaRecord | null> {
  const account = await findWebAccount(username, null);
  const id = which === "photo" ? account?.photoId : account?.coverId;
  return id ? mediaRepo.findMediaById(id, true) : null;
}

/**
 * The newest accounts that show on the web, for the profile sitemap: one indexed read of the
 * partial index (migration 0069), at most `limit` names.
 */
export async function sitemapUsernames(limit: number): Promise<string[]> {
  const rows = await query(
    `SELECT u.username FROM users u WHERE ${WEB_ACCOUNT_SQL} ORDER BY u.created_at DESC LIMIT :'limit'::int`,
    { limit },
  );
  return rows.map((r) => r.username as string);
}

// --- Aggregate page counts -----------------------------------------------------------------

const pending = new Map<"profile" | "story", number>();
let flushTimer: NodeJS.Timeout | null = null;

/**
 * Counts one web page opened: profile or Story, nothing else. Kept in memory and added to the
 * day's total (web_page_views) every half minute, so a busy profile never contends on one row.
 */
export function countWebPage(page: "profile" | "story"): void {
  pending.set(page, (pending.get(page) ?? 0) + 1);
  if (!flushTimer) {
    flushTimer = setTimeout(() => { flushTimer = null; void flushWebPageCounts(); }, 30_000);
    flushTimer.unref();
  }
}

/** Writes the counts so far (also called by tests). A failed write is dropped: these are only counts. */
export async function flushWebPageCounts(): Promise<void> {
  const counts = [...pending.entries()];
  pending.clear();
  for (const [page, n] of counts) {
    await query(
      `INSERT INTO web_page_views (day, page, views) VALUES ((now() AT TIME ZONE 'Asia/Kolkata')::date, :'page', :'n')
       ON CONFLICT (day, page) DO UPDATE SET views = web_page_views.views + EXCLUDED.views`,
      { page, n },
    ).catch(() => undefined);
  }
}
