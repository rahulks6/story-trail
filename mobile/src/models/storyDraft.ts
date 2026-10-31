/**
 * Per spec section 26, generalized for the Camera + Editor module: every
 * canvas object (text/emoji/mention/location/datetime/sticker) shares one
 * geometry shape and one gesture model (see DraggableCanvasObject.tsx) —
 * only `properties` varies by type. x/y/scale are normalized to the
 * media's own box (0..1-ish, not device pixels — see DraggableCanvasObject's
 * own doc comment), which is what keeps a Story's layout consistent across
 * different screen sizes. This mirrors backend/src/modules/stories/overlays.ts
 * field-for-field; keep the two in lockstep by hand, same as the rest of
 * src/api/ and src/models/.
 */

export type FilterName = "Original" | "Warm" | "Cool" | "Bright" | "Cinema" | "Mono" | "Vintage" | "Soft" | "Vivid" | "Night" | "Fade";

/** The backend stores/validates filter names lowercased — see overlays.ts's FILTER_NAMES. */
export function filterKey(name: FilterName): string {
  return name.toLowerCase();
}

export type TextStyle = "Clean" | "Bold" | "Classic" | "Modern" | "Typewriter" | "Outline" | "Soft" | "Highlight";

export interface TextOverlayProperties {
  text: string;
  style: TextStyle;
  color: string;
  backgroundColor: string | null;
  align: "left" | "center" | "right";
  fontSize: number; // normalized to the media container's height, e.g. 0.045
}

export interface EmojiOverlayProperties {
  emoji: string;
}

export interface MentionOverlayProperties {
  userId: string;
  /** Attached fresh by the backend on every read — never trusted or sent on publish. */
  username?: string;
  displayName?: string;
}

export interface LocationOverlayProperties {
  label: string;
}

export type DateTimeMode = "date" | "time" | "datetime";

export interface DateTimeOverlayProperties {
  mode: DateTimeMode;
  value: string;
  display: string;
}

export const STICKER_IDS = ["spark", "heart-line", "star-outline", "wave", "flame", "confetti", "ring", "bolt"] as const;
export type StickerId = (typeof STICKER_IDS)[number];

export interface StickerOverlayProperties {
  stickerId: StickerId;
}

/**
 * Interactive stickers (backend stories/stickers.service.ts). The creator sets what's before
 * the `?` fields; the optional ones are attached by the server for each viewer on read (results
 * once you've answered, whether you asked to be reminded, the chain's size) and never sent.
 */
export const INTERACTIVE_TYPES = ["poll", "quiz", "question", "countdown", "link", "addYours"] as const;
export type InteractiveType = (typeof INTERACTIVE_TYPES)[number];
export const MIN_OPTIONS = 2;
export const MAX_OPTIONS = 4;
export const MAX_OPTION_LENGTH = 40;
export const MAX_QUESTION_LENGTH = 80;
export const MAX_COUNTDOWN_TITLE_LENGTH = 40;
export const MAX_ANSWER_LENGTH = 300;

/** A poll or quiz as one viewer sees it once they've answered (and the owner always). */
export interface VoteResults {
  counts: number[];
  total: number;
  viewerChoice: number | null;
}

export interface PollOverlayProperties {
  question: string;
  options: string[];
  results?: VoteResults | null;
}

export interface QuizOverlayProperties {
  question: string;
  options: string[];
  /** Always set while editing; from the server only for the owner or after you've answered. */
  correctIndex?: number;
  results?: VoteResults | null;
}

export interface QuestionOverlayProperties {
  prompt: string;
  viewerAnswered?: boolean;
  responseCount?: number;
}

export interface CountdownOverlayProperties {
  title: string;
  /** ISO time the countdown ends. */
  endsAt: string;
  viewerReminded?: boolean;
  reminderCount?: number;
}

export interface LinkOverlayProperties {
  url: string;
  label: string | null;
}

export interface AddYoursOverlayProperties {
  prompt: string;
  /** The chain this Story joins (posting from someone's "Add yours"), or, on read, its own chain. */
  chainId?: string;
  participants?: number;
  recent?: { username: string; avatarMediaId: string | null }[];
}

export function isInteractive(overlay: Pick<Overlay, "type">): boolean {
  return (INTERACTIVE_TYPES as readonly string[]).includes(overlay.type);
}

/** The host a link sticker shows ("shop.example.com"), so people see where it goes. */
export function linkHost(url: string): string {
  const match = /^https?:\/\/([^/?#]+)/i.exec(url);
  return (match?.[1] ?? url).replace(/^www\./i, "").toLowerCase();
}

/** What a typed address becomes: https:// added when no scheme was given. */
export function normalizeLinkInput(text: string): string {
  const trimmed = text.trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

interface OverlayBase {
  id: string;
  x: number;
  y: number;
  scale: number;
  rotation: number;
  zIndex: number;
}

export type Overlay =
  | (OverlayBase & { type: "text"; properties: TextOverlayProperties })
  | (OverlayBase & { type: "emoji"; properties: EmojiOverlayProperties })
  | (OverlayBase & { type: "mention"; properties: MentionOverlayProperties })
  | (OverlayBase & { type: "location"; properties: LocationOverlayProperties })
  | (OverlayBase & { type: "datetime"; properties: DateTimeOverlayProperties })
  | (OverlayBase & { type: "sticker"; properties: StickerOverlayProperties })
  | (OverlayBase & { type: "poll"; properties: PollOverlayProperties })
  | (OverlayBase & { type: "quiz"; properties: QuizOverlayProperties })
  | (OverlayBase & { type: "question"; properties: QuestionOverlayProperties })
  | (OverlayBase & { type: "countdown"; properties: CountdownOverlayProperties })
  | (OverlayBase & { type: "link"; properties: LinkOverlayProperties })
  | (OverlayBase & { type: "addYours"; properties: AddYoursOverlayProperties });

/** The content part of an interactive sticker the editor can change in place. */
export type InteractiveProperties =
  | PollOverlayProperties
  | QuizOverlayProperties
  | QuestionOverlayProperties
  | CountdownOverlayProperties
  | LinkOverlayProperties
  | AddYoursOverlayProperties;

export type DrawTool = "pen" | "marker" | "highlighter" | "eraser";

export interface DrawStroke {
  id: string;
  tool: DrawTool;
  color: string;
  width: number; // normalized to the media container's width
  points: { x: number; y: number }[];
}

export interface SourceMedia {
  uri: string;
  kind: "photo" | "video";
  width: number | null;
  height: number | null;
}

export const MAX_CROP_ZOOM = 4;

/**
 * A live-applied crop, not a pixel one — there's no image-processing
 * library in this sandbox to actually re-encode cropped pixels, so this
 * is stored as structured metadata and applied as a transform at both
 * edit time and view time (see components/CropGestureLayer.tsx and
 * mediaTransformStyle below), the same architecture as filter/overlays/
 * drawing. `zoom` 1 is the default resizeMode="cover" framing (no extra
 * zoom); `offsetX`/`offsetY` are normalized to [-1, 1] — the fraction of
 * the *maximum safe pan* at the current zoom, not raw pixels, so the
 * value still means the same thing at any container size.
 */
export interface StoryCrop {
  zoom: number;
  offsetX: number;
  offsetY: number;
}

export const DEFAULT_CROP: StoryCrop = { zoom: 1, offsetX: 0, offsetY: 0 };

export function clampCrop(crop: StoryCrop): StoryCrop {
  const zoom = Math.min(Math.max(crop.zoom, 1), MAX_CROP_ZOOM);
  const clampOffset = (n: number) => Math.min(Math.max(n, -1), 1);
  return { zoom, offsetX: clampOffset(crop.offsetX), offsetY: clampOffset(crop.offsetY) };
}

/**
 * The transform that actually applies a crop to a `resizeMode="cover"`
 * Image/Video: translate is listed before scale, so (per how RN/CSS
 * compose a transform list) it's expressed in final, post-scale pixels —
 * meaning `containerWidth * (zoom-1)/2` is exactly the room a `zoom`-times
 * enlargement creates on each side, so offsetX/offsetY at ±1 pan exactly
 * to the edge of what the zoomed image covers, never revealing a gap.
 */
export function mediaTransformStyle(crop: StoryCrop, containerWidth: number, containerHeight: number) {
  return {
    transform: [
      { translateX: crop.offsetX * (containerWidth * (crop.zoom - 1)) / 2 },
      { translateY: crop.offsetY * (containerHeight * (crop.zoom - 1)) / 2 },
      { scale: crop.zoom },
    ],
  };
}

export interface StoryDraft {
  sourceMedia: SourceMedia;
  filter: FilterName;
  overlays: Overlay[];
  drawing: DrawStroke[];
  caption: string;
  /** Video only — original recorded audio is kept by default (spec section 44). */
  audioMuted: boolean;
  crop: StoryCrop;
}

export function createEmptyDraft(sourceMedia: SourceMedia): StoryDraft {
  return { sourceMedia, filter: "Original", overlays: [], drawing: [], caption: "", audioMuted: false, crop: DEFAULT_CROP };
}

/** Used for the discard-protection prompt (spec section 27) — has the user actually changed anything? */
export function hasMeaningfulEdits(draft: StoryDraft): boolean {
  return (
    draft.filter !== "Original" ||
    draft.overlays.length > 0 ||
    draft.drawing.length > 0 ||
    draft.caption.trim().length > 0 ||
    draft.audioMuted ||
    draft.crop.zoom !== 1 ||
    draft.crop.offsetX !== 0 ||
    draft.crop.offsetY !== 0
  );
}

/**
 * "Safe positioning near canvas edges" (spec): an overlay's anchor point
 * (its own x/y, not its visible edges — those vary with scale/rotation)
 * is kept within this margin of the canvas at all times, in both the drag
 * gesture and the nudge-button alternative, so it can never be dragged
 * somewhere it's no longer reachable to tap, drag back, or select through
 * OverlayAdjustSheet. The backend's own clamp (dto.ts) is deliberately
 * looser than this — a sanity backstop against an arbitrary API caller,
 * not the UX guarantee this margin provides for the app's own gestures.
 */
export const OVERLAY_SAFE_MARGIN = 0.06;

export function clampOverlayPosition(x: number, y: number): { x: number; y: number } {
  const clamp = (n: number) => Math.min(Math.max(n, OVERLAY_SAFE_MARGIN), 1 - OVERLAY_SAFE_MARGIN);
  return { x: clamp(x), y: clamp(y) };
}
