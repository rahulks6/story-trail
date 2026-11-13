/**
 * Shared shapes for the Camera + Editor module's structured overlay/drawing
 * data — mirrors mobile/src/models/storyDraft.ts's client-side types.
 * Stored as JSONB on `stories` (migration 0015), never baked into pixels,
 * so a mention stays a live reference (resolved per-viewer in
 * stories.service.ts, respecting blocks/deletion/username changes) rather
 * than a permanently-rendered "@username".
 */

export const OVERLAY_TYPES = [
  "text", "emoji", "mention", "location", "datetime", "sticker",
  // A moving sticker: one of Katkee's own (assets/stickers) or a GIPHY sticker (modules/gifs).
  "gif",
  // Interactive stickers (stickers.service.ts): what viewers do with them is stored apart
  // from the Story (migration 0062), and attached for each viewer on every read.
  "poll", "quiz", "question", "countdown", "link", "addYours", "song",
] as const;
export type OverlayType = (typeof OVERLAY_TYPES)[number];

/** A Story carries at most one of each: one poll, one quiz, and so on (like Instagram). */
export const INTERACTIVE_TYPES = ["poll", "quiz", "question", "countdown", "link", "addYours", "song"] as const;
export type InteractiveType = (typeof INTERACTIVE_TYPES)[number];

export const MIN_OPTIONS = 2;
export const MAX_OPTIONS = 4;
export const MAX_OPTION_LENGTH = 40;
export const MAX_QUESTION_LENGTH = 80;
export const MAX_COUNTDOWN_TITLE_LENGTH = 40;
export const MAX_LINK_LENGTH = 2048;
export const MAX_LINK_LABEL_LENGTH = 40;
/** How far ahead a countdown may end. */
export const MAX_COUNTDOWN_DAYS = 90;

export const TEXT_STYLES = ["Clean", "Bold", "Classic", "Modern", "Typewriter", "Outline", "Soft", "Highlight"] as const;
export type TextStyle = (typeof TEXT_STYLES)[number];

export const STICKER_IDS = ["spark", "heart-line", "star-outline", "wave", "flame", "confetti", "ring", "bolt"] as const;
export type StickerId = (typeof STICKER_IDS)[number];

export const DATETIME_MODES = ["date", "time", "datetime"] as const;
export type DateTimeMode = (typeof DATETIME_MODES)[number];

export const DRAW_TOOLS = ["pen", "marker", "highlighter", "eraser"] as const;
export type DrawTool = (typeof DRAW_TOOLS)[number];

export const FILTER_NAMES = [
  "original",
  "warm",
  "cool",
  "bright",
  "cinema",
  "mono",
  "vintage",
  "retro",
  "film",
  "instant",
  "sepia",
  "noir",
  "soft",
  "vivid",
  "night",
  "fade",
] as const;
export type FilterKey = (typeof FILTER_NAMES)[number];

interface OverlayBase {
  id: string;
  x: number;
  y: number;
  scale: number;
  rotation: number;
  zIndex: number;
}

export interface TextOverlay extends OverlayBase {
  type: "text";
  properties: {
    text: string; style: TextStyle; color: string; backgroundColor: string | null; align: "left" | "center" | "right"; fontSize: number;
    /** "marker": a highlighter behind each line in backgroundColor (else backgroundColor is one label); "outline": a border round the letters. */
    effect?: "marker" | "outline" | "soft";
    /** How the text comes in on the Story; missing for still text. */
    animation?: "typewriter" | "pop" | "fade" | "bounce";
  };
}

export interface EmojiOverlay extends OverlayBase {
  type: "emoji";
  properties: { emoji: string };
}

export interface MentionOverlay extends OverlayBase {
  type: "mention";
  /**
   * `userId` is the only part that's actually persisted (see dto.ts's
   * parseOverlay — an incoming `username`/`displayName` is never trusted or
   * stored). `username`/`displayName` are attached fresh on every read, by
   * stories.service.ts's resolveOverlaysForViewer, from whatever that user's
   * identity actually is *right now* — a rename shows up immediately, and a
   * deleted account or a block in either direction makes the whole overlay
   * disappear from the response rather than ever rendering stale data.
   */
  properties: { userId: string; username?: string; displayName?: string; verified?: boolean };
}

export interface LocationOverlay extends OverlayBase {
  type: "location";
  properties: { label: string };
}

export interface DateTimeOverlay extends OverlayBase {
  type: "datetime";
  properties: { mode: DateTimeMode; value: string; display: string };
}

export interface StickerOverlay extends OverlayBase {
  type: "sticker";
  properties: { stickerId: StickerId };
}

/**
 * A moving sticker. Katkee's own are served by this server at /stickers/<id>.webp (url is that
 * path); GIPHY's are shown from GIPHY's own servers, as GIPHY requires (url is theirs).
 */
export interface GifOverlay extends OverlayBase {
  type: "gif";
  properties: { source: "katkee" | "giphy"; id: string; url: string; width: number; height: number };
}

/**
 * What a poll or quiz looks like to one viewer. Only attached once they have answered (or for
 * the owner): the counts aren't shown before you vote, and a quiz never gives its answer away.
 */
export interface VoteResults {
  counts: number[];
  total: number;
  /** The option this viewer chose; null for the owner, who doesn't vote. */
  viewerChoice: number | null;
}

export interface PollOverlay extends OverlayBase {
  type: "poll";
  properties: { question: string; options: string[]; results?: VoteResults | null };
}

export interface QuizOverlay extends OverlayBase {
  type: "quiz";
  /**
   * `correctIndex` is stored, but only ever sent to the owner and to a viewer who has already
   * answered (stickers.service.ts): before that the response leaves it out entirely.
   */
  properties: { question: string; options: string[]; correctIndex?: number; results?: VoteResults | null };
}

export interface QuestionOverlay extends OverlayBase {
  type: "question";
  /** `responseCount` is the owner's alone; `viewerAnswered` is whether this viewer has sent one. */
  properties: { prompt: string; viewerAnswered?: boolean; responseCount?: number };
}

export interface CountdownOverlay extends OverlayBase {
  type: "countdown";
  /** `endsAt` is an ISO time. `reminderCount` is the owner's alone. */
  properties: { title: string; endsAt: string; viewerReminded?: boolean; reminderCount?: number };
}

export interface LinkOverlay extends OverlayBase {
  type: "link";
  /** An http(s) URL that passed the link-safety policy (safety/links.ts), at publish and on every read. */
  properties: { url: string; label: string | null };
}

export interface AddYoursOverlay extends OverlayBase {
  type: "addYours";
  /**
   * Sent on publish: the prompt, and the chain being joined (when posting from someone's
   * "Add yours"). On read the chain's own prompt replaces whatever was sent, with how many
   * people have taken part and a few of their faces.
   */
  properties: {
    prompt: string;
    chainId?: string;
    participants?: number;
    recent?: { username: string; avatarMediaId: string | null }[];
  };
}

/**
 * A popular song shown as a link to where it's licensed to play (song-links.ts): the title,
 * artist and cover, opening Spotify or YouTube on tap. Katkee never plays it.
 */
export interface SongOverlay extends OverlayBase {
  type: "song";
  properties: { provider: "spotify" | "youtube_music" | "youtube"; url: string; title: string; artist: string; artworkUrl: string | null };
}

export type StoryOverlay =
  | TextOverlay
  | EmojiOverlay
  | MentionOverlay
  | LocationOverlay
  | DateTimeOverlay
  | StickerOverlay
  | GifOverlay
  | PollOverlay
  | QuizOverlay
  | QuestionOverlay
  | CountdownOverlay
  | LinkOverlay
  | AddYoursOverlay
  | SongOverlay;

export interface DrawStroke {
  id: string;
  tool: DrawTool;
  color: string;
  width: number;
  points: { x: number; y: number }[];
}

/**
 * A live-applied crop, not a pixel-level one — see migration 0017's own
 * comment. `zoom` is clamped to [1, MAX_CROP_ZOOM]; `offsetX`/`offsetY`
 * to [-1, 1] (a fraction of the pan room available at that zoom, not raw
 * pixels — see mobile/src/components/CropGestureLayer.tsx for the exact
 * transform this is fed into).
 */
export interface StoryCrop {
  zoom: number;
  offsetX: number;
  offsetY: number;
}

export const MAX_CROP_ZOOM = 4;
