import type { SavedDraft } from "./draftStorage";
import { isTopic } from "../models/topics";

const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const number = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const text = (v: unknown): v is string => typeof v === "string";
const member = (v: unknown, values: string[]) => text(v) && values.includes(v);
/** A poll's or quiz's 2-4 options, each some text. */
const options = (v: unknown) => Array.isArray(v) && v.length >= 2 && v.length <= 4 && v.every(text);

/** Storage is untrusted input: reject incomplete drafts before rendering them. */
export function isSavedDraft(value: unknown, mediaUri: string): value is SavedDraft {
  if (!record(value) || !record(value.draft)) return false;
  if (!member(value.audience, ["public", "followers", "close_friends"]) || !text(value.mimeType) || !text(value.savedAt) || !Number.isFinite(Date.parse(value.savedAt))) return false;
  if (value.topic !== undefined && !isTopic(value.topic)) return false;
  const d = value.draft, source = d.sourceMedia, crop = d.crop;
  if (!record(source) || source.uri !== mediaUri || !member(source.kind, ["photo", "video"])) return false;
  if (![source.width, source.height].every(v => v === null || (number(v) && v > 0))) return false;
  if (!record(crop) || !number(crop.zoom) || crop.zoom < 1 || crop.zoom > 4 || !number(crop.offsetX) || Math.abs(crop.offsetX) > 1 || !number(crop.offsetY) || Math.abs(crop.offsetY) > 1) return false;
  if (!text(d.caption) || typeof d.audioMuted !== "boolean" || !member(d.filter, ["Original", "Warm", "Cool", "Bright", "Cinema", "Mono", "Vintage", "Retro", "Film", "Instant", "Sepia", "Noir", "Soft", "Vivid", "Night", "Fade"])) return false;
  if (!Array.isArray(d.overlays) || !Array.isArray(d.drawing)) return false;
  if (!d.drawing.every(stroke => record(stroke) && text(stroke.id) && text(stroke.color) && number(stroke.width) && stroke.width > 0 && member(stroke.tool, ["pen", "marker", "highlighter", "eraser"]) && Array.isArray(stroke.points) && stroke.points.every(p => record(p) && number(p.x) && number(p.y)))) return false;
  return d.overlays.every(overlay => {
    if (!record(overlay) || !text(overlay.id) || ![overlay.x, overlay.y, overlay.scale, overlay.rotation, overlay.zIndex].every(number) || !record(overlay.properties)) return false;
    const p = overlay.properties;
    switch (overlay.type) {
      case "text": return text(p.text) && text(p.color) && (p.backgroundColor === null || text(p.backgroundColor)) && (p.effect === undefined || member(p.effect, ["marker", "outline", "soft"])) && (p.animation === undefined || member(p.animation, ["typewriter", "pop", "fade", "bounce"])) && number(p.fontSize) && p.fontSize > 0 && member(p.align, ["left", "center", "right"]) && member(p.style, ["Clean", "Bold", "Classic", "Modern", "Typewriter", "Outline", "Soft", "Highlight"]);
      case "emoji": return text(p.emoji);
      case "mention": return text(p.userId) && (p.username === undefined || text(p.username)) && (p.displayName === undefined || text(p.displayName));
      case "location": return text(p.label);
      case "datetime": return member(p.mode, ["date", "time", "datetime"]) && text(p.value) && text(p.display);
      case "sticker": return member(p.stickerId, ["spark", "heart-line", "star-outline", "wave", "flame", "confetti", "ring", "bolt"]);
      case "gif": return member(p.source, ["katkee", "giphy"]) && text(p.id) && text(p.url) && (p.url.startsWith("/stickers/") || /^https:\/\//i.test(p.url)) && number(p.width) && p.width > 0 && number(p.height) && p.height > 0;
      case "poll": return text(p.question) && options(p.options);
      case "quiz": return text(p.question) && options(p.options) && number(p.correctIndex) && Number.isInteger(p.correctIndex) && p.correctIndex >= 0 && p.correctIndex < (p.options as unknown[]).length;
      case "question": return text(p.prompt);
      case "countdown": return text(p.title) && text(p.endsAt) && Number.isFinite(Date.parse(p.endsAt));
      case "link": return text(p.url) && /^https?:\/\//i.test(p.url) && (p.label === null || text(p.label));
      case "addYours": return text(p.prompt) && (p.chainId === undefined || text(p.chainId));
      case "song": return member(p.provider, ["spotify", "youtube_music", "youtube"]) && text(p.url) && /^https:\/\//i.test(p.url) && text(p.title) && text(p.artist) && (p.artworkUrl === null || text(p.artworkUrl));
      default: return false;
    }
  });
}
