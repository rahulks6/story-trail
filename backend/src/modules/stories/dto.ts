import { ValidationError } from "../auth/dto";
import type { Audience, CommentSetting } from "./stories.repository";
import type { StoryOverlay, DrawStroke, StoryCrop } from "./overlays";
import { canonicalTopic, TOPICS, type Topic } from "../../shared/topics";
import { OVERLAY_TYPES, TEXT_STYLES, STICKER_IDS, DATETIME_MODES, DRAW_TOOLS, FILTER_NAMES, MAX_CROP_ZOOM } from "./overlays";

const MAX_CAPTION_LENGTH = 280;
const AUDIENCES: Audience[] = ["public", "followers", "close_friends"];
const COMMENT_SETTINGS: CommentSetting[] = ["everyone", "followers", "disabled"];

export interface PublishStoryInput {
  requestId?: string;
  mediaId: string;
  caption: string;
  audience: Audience;
  allowComments: CommentSetting;
  allowSharing: boolean;
  overlays: StoryOverlay[];
  drawing: DrawStroke[];
  filter: string;
  audioMuted: boolean;
  crop: StoryCrop;
  /** A song from the catalogue and the part of it that plays (checked against the track in stories.service). */
  music?: { trackId: string; startMs: number; durationMs: number } | null;
  /** A current festival's slug (festivals table): adds the Story to that festival's ring. */
  festival?: string;
  /** One topic from the topic list (shared/topics.ts); without one, the owner's interests stand in. */
  topic?: Topic;
}

function parseMusic(raw: unknown, errors: Record<string, string>): PublishStoryInput["music"] {
  if (raw === undefined || raw === null) return null;
  const m = raw as Record<string, unknown>;
  if (typeof m !== "object" || typeof m.trackId !== "string" || !UUID.test(m.trackId)) {
    errors.music = "music needs a trackId.";
    return null;
  }
  const startMs = isFiniteNumber(m.startMs) ? Math.max(0, Math.round(m.startMs)) : 0;
  const durationMs = isFiniteNumber(m.durationMs) ? Math.round(m.durationMs) : 15_000;
  return { trackId: m.trackId, startMs, durationMs };
}

const DEFAULT_CROP: StoryCrop = { zoom: 1, offsetX: 0, offsetY: 0 };

const MAX_OVERLAYS = 40;
const MAX_STROKES = 80;
const MAX_POINTS_PER_STROKE = 500;
const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const UUID = /^[0-9a-f-]{36}$/i;

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(Math.max(n, min), max);
}

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });
/** Longest single emoji kept: a ZWJ family is 11 UTF-16 units, a subdivision flag 14. */
const MAX_EMOJI_LENGTH = 32;

/**
 * At most `max` UTF-16 units, cut between characters: a plain slice could split an emoji's
 * surrogate pair (shown as "�"), a flag, or a ZWJ sequence like a family or a skin tone.
 */
function clipText(text: string, max: number): string {
  if (text.length <= max) return text;
  let end = 0;
  for (const { segment } of graphemes.segment(text)) {
    if (end + segment.length > max) break;
    end += segment.length;
  }
  return text.slice(0, end);
}

/** The first character of `text` as people see it (one emoji, with its skin tone, flag or ZWJ parts). */
function firstGrapheme(text: string): string {
  for (const { segment } of graphemes.segment(text)) return segment;
  return "";
}

/**
 * Every overlay is trusted client geometry (x/y/scale/rotation) clamped to
 * a sane range, plus type-specific `properties` validated per type. Bad or
 * unknown shapes are dropped rather than rejecting the whole publish — an
 * editor bug in one overlay shouldn't block the rest of a Story.
 */
function parseOverlay(raw: unknown, index: number): StoryOverlay | null {
  if (typeof raw !== "object" || raw === null) return null;
  const o = raw as Record<string, unknown>;
  const type = o.type;
  if (typeof type !== "string" || !OVERLAY_TYPES.includes(type as (typeof OVERLAY_TYPES)[number])) return null;

  const id = typeof o.id === "string" && o.id.length > 0 ? o.id : `overlay-${index}`;
  // A sanity backstop against an arbitrary API caller, not the UX
  // guarantee the mobile app's own gestures keep — see its
  // OVERLAY_SAFE_MARGIN (storyDraft.ts), which is deliberately tighter
  // than this so an overlay always stays within reach of a drag/tap; this
  // just rejects wildly out-of-view garbage (x=1000, etc).
  const x = isFiniteNumber(o.x) ? clamp(o.x, -0.1, 1.1) : 0.5;
  const y = isFiniteNumber(o.y) ? clamp(o.y, -0.1, 1.1) : 0.5;
  const scale = isFiniteNumber(o.scale) ? clamp(o.scale, 0.1, 6) : 1;
  const rotation = isFiniteNumber(o.rotation) ? ((o.rotation % 360) + 360) % 360 : 0;
  const zIndex = isFiniteNumber(o.zIndex) ? Math.trunc(o.zIndex) : index;

  const properties = o.properties as Record<string, unknown> | undefined;
  if (typeof properties !== "object" || properties === null) return null;

  switch (type) {
    case "text": {
      const text = typeof properties.text === "string" ? clipText(properties.text, MAX_CAPTION_LENGTH) : "";
      if (text.trim().length === 0) return null;
      const style: (typeof TEXT_STYLES)[number] =
        typeof properties.style === "string" && TEXT_STYLES.includes(properties.style as (typeof TEXT_STYLES)[number])
          ? (properties.style as (typeof TEXT_STYLES)[number])
          : "Clean";
      const color = typeof properties.color === "string" && HEX_COLOR.test(properties.color) ? properties.color : "#FFFFFF";
      const backgroundColor =
        typeof properties.backgroundColor === "string" && HEX_COLOR.test(properties.backgroundColor)
          ? properties.backgroundColor
          : null;
      const align = properties.align === "left" || properties.align === "right" ? properties.align : "center";
      const fontSize = isFiniteNumber(properties.fontSize) ? clamp(properties.fontSize, 0.01, 0.2) : 0.045;
      return { id, type: "text", x, y, scale, rotation, zIndex, properties: { text, style, color, backgroundColor, align, fontSize } };
    }
    case "emoji": {
      // One emoji, whole: slicing to 8 units cut families, flags and skin tones in half.
      const emoji = typeof properties.emoji === "string" ? firstGrapheme(properties.emoji.trim()) : "";
      if (emoji.length === 0 || emoji.length > MAX_EMOJI_LENGTH) return null;
      return { id, type: "emoji", x, y, scale, rotation, zIndex, properties: { emoji } };
    }
    case "mention": {
      const userId = typeof properties.userId === "string" ? properties.userId : "";
      if (!UUID.test(userId)) return null;
      return { id, type: "mention", x, y, scale, rotation, zIndex, properties: { userId } };
    }
    case "location": {
      const label = typeof properties.label === "string" ? clipText(properties.label.trim(), 100) : "";
      if (label.length === 0) return null;
      return { id, type: "location", x, y, scale, rotation, zIndex, properties: { label } };
    }
    case "datetime": {
      const mode: (typeof DATETIME_MODES)[number] =
        typeof properties.mode === "string" && DATETIME_MODES.includes(properties.mode as (typeof DATETIME_MODES)[number])
          ? (properties.mode as (typeof DATETIME_MODES)[number])
          : "datetime";
      const value = typeof properties.value === "string" ? clipText(properties.value, 40) : new Date().toISOString();
      const display = typeof properties.display === "string" ? clipText(properties.display, 40) : value;
      return { id, type: "datetime", x, y, scale, rotation, zIndex, properties: { mode, value, display } };
    }
    case "sticker": {
      const stickerId = typeof properties.stickerId === "string" ? properties.stickerId : "";
      if (!STICKER_IDS.includes(stickerId as (typeof STICKER_IDS)[number])) return null;
      return { id, type: "sticker", x, y, scale, rotation, zIndex, properties: { stickerId: stickerId as (typeof STICKER_IDS)[number] } };
    }
    default:
      return null;
  }
}

function parseOverlays(raw: unknown): StoryOverlay[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, MAX_OVERLAYS)
    .map((o, i) => parseOverlay(o, i))
    .filter((o): o is StoryOverlay => o !== null);
}

function parseStroke(raw: unknown, index: number): DrawStroke | null {
  if (typeof raw !== "object" || raw === null) return null;
  const s = raw as Record<string, unknown>;
  const id = typeof s.id === "string" && s.id.length > 0 ? s.id : `stroke-${index}`;
  const tool: (typeof DRAW_TOOLS)[number] =
    typeof s.tool === "string" && DRAW_TOOLS.includes(s.tool as (typeof DRAW_TOOLS)[number])
      ? (s.tool as (typeof DRAW_TOOLS)[number])
      : "pen";
  const color = typeof s.color === "string" && HEX_COLOR.test(s.color) ? s.color : "#FCB020";
  const width = isFiniteNumber(s.width) ? clamp(s.width, 0.002, 0.08) : 0.01;
  const rawPoints = Array.isArray(s.points) ? s.points : [];
  const points = rawPoints
    .slice(0, MAX_POINTS_PER_STROKE)
    .filter((p): p is { x: number; y: number } => {
      if (typeof p !== "object" || p === null) return false;
      const pt = p as Record<string, unknown>;
      return isFiniteNumber(pt.x) && isFiniteNumber(pt.y);
    })
    .map((p) => ({ x: clamp(p.x, -0.2, 1.2), y: clamp(p.y, -0.2, 1.2) }));
  if (points.length < 2) return null;
  return { id, tool, color, width, points };
}

function parseDrawing(raw: unknown): DrawStroke[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, MAX_STROKES)
    .map(parseStroke)
    .filter((s): s is DrawStroke => s !== null);
}

function parseCrop(raw: unknown): StoryCrop {
  if (typeof raw !== "object" || raw === null) return DEFAULT_CROP;
  const c = raw as Record<string, unknown>;
  return {
    zoom: isFiniteNumber(c.zoom) ? clamp(c.zoom, 1, MAX_CROP_ZOOM) : 1,
    offsetX: isFiniteNumber(c.offsetX) ? clamp(c.offsetX, -1, 1) : 0,
    offsetY: isFiniteNumber(c.offsetY) ? clamp(c.offsetY, -1, 1) : 0,
  };
}

export function parsePublishStoryInput(body: unknown): PublishStoryInput {
  const errors: Record<string, string> = {};
  const b = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;

  const mediaId = typeof b.mediaId === "string" ? b.mediaId : "";
  if(b.requestId!==undefined&&(typeof b.requestId!=='string'||!/^[A-Za-z0-9_-]{16,100}$/.test(b.requestId)))errors.requestId='Invalid publish request identifier.';
  if (!/^[0-9a-f-]{36}$/i.test(mediaId)) errors.mediaId = "mediaId must be a valid media id.";

  const caption = typeof b.caption === "string" ? b.caption : "";
  if (caption.length > MAX_CAPTION_LENGTH) errors.caption = `Caption must be at most ${MAX_CAPTION_LENGTH} characters.`;

  const audience = (b.audience as Audience) ?? "public";
  if (!AUDIENCES.includes(audience)) errors.audience = `audience must be one of: ${AUDIENCES.join(", ")}.`;

  const allowComments = (b.allowComments as CommentSetting) ?? "everyone";
  if (!COMMENT_SETTINGS.includes(allowComments)) {
    errors.allowComments = `allowComments must be one of: ${COMMENT_SETTINGS.join(", ")}.`;
  }

  const allowSharing = b.allowSharing === undefined ? true : b.allowSharing;
  if (typeof allowSharing !== "boolean") errors.allowSharing = "allowSharing must be a boolean.";

  const filter = typeof b.filter === "string" && FILTER_NAMES.includes(b.filter as (typeof FILTER_NAMES)[number]) ? b.filter : "original";
  const audioMuted = b.audioMuted === undefined ? false : b.audioMuted;
  if (typeof audioMuted !== "boolean") errors.audioMuted = "audioMuted must be a boolean.";

  const music = parseMusic(b.music, errors);
  let festival: string | undefined;
  if (b.festival !== undefined && b.festival !== null) {
    if (typeof b.festival !== "string" || !/^[a-z0-9-]{3,60}$/.test(b.festival)) errors.festival = "festival must be a festival id.";
    else festival = b.festival;
  }

  let topic: Topic | undefined;
  if (b.topic !== undefined && b.topic !== null && b.topic !== "") {
    const known = canonicalTopic(b.topic);
    if (!known) errors.topic = `topic must be one of: ${TOPICS.join(", ")}.`;
    else topic = known;
  }

  if (Object.keys(errors).length > 0) throw new ValidationError(errors);
  return {
    mediaId,
    ...(typeof b.requestId==='string'?{requestId:b.requestId}:{}),
    caption,
    audience,
    allowComments,
    allowSharing: allowSharing as boolean,
    overlays: parseOverlays(b.overlays),
    drawing: parseDrawing(b.drawing),
    filter,
    audioMuted: audioMuted as boolean,
    crop: parseCrop(b.crop),
    ...(music ? { music } : {}),
    ...(festival ? { festival } : {}),
    // Left out when absent, so an older app's retried publish hashes as it always did.
    ...(topic ? { topic } : {}),
  };
}

const MAX_COMMENT_LENGTH = 500;

export function parseCommentInput(body: unknown): string {
  const b = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  const text = typeof b.body === "string" ? b.body.trim() : "";
  if (text.length < 1 || text.length > MAX_COMMENT_LENGTH) {
    throw new ValidationError({ body: `Comment must be 1-${MAX_COMMENT_LENGTH} characters.` });
  }
  return text;
}
