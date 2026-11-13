import fs from "node:fs";
import path from "node:path";

/**
 * Katkee's own moving stickers (brand/stickers/make-stickers.cjs): looping animated WebP files
 * in assets/stickers, with manifest.json naming each one's category and search words. The image
 * copies assets/ to /app/assets; from dist/src/modules/gifs that is four folders up.
 */
export const STICKER_DIR = process.env.STICKER_DIR ?? path.resolve(__dirname, "../../../../assets/stickers");

export interface KatkeeSticker {
  id: string;
  category: string;
  tags: string[];
  /** Where it's served on this server (and on katkee.com): /stickers/<id>.webp. */
  url: string;
  size: number;
}

interface Pack {
  categories: string[];
  stickers: KatkeeSticker[];
  byId: Map<string, KatkeeSticker>;
}

let pack: Pack | null = null;

function load(): Pack {
  if (pack) return pack;
  let raw: { size?: number; categories?: string[]; stickers?: { id: string; category: string; tags: string[] }[] } = {};
  try {
    raw = JSON.parse(fs.readFileSync(path.join(STICKER_DIR, "manifest.json"), "utf8"));
  } catch {
    // No pack in this build: the GIF tab shows GIPHY alone.
  }
  const size = typeof raw.size === "number" ? raw.size : 320;
  const stickers = (raw.stickers ?? [])
    .filter((s) => /^[a-z0-9-]{2,40}$/.test(s.id))
    .map((s) => ({ id: s.id, category: s.category, tags: s.tags, url: `/stickers/${s.id}.webp`, size }));
  pack = { categories: raw.categories ?? [], stickers, byId: new Map(stickers.map((s) => [s.id, s])) };
  return pack;
}

export function katkeePack(): { categories: string[]; stickers: KatkeeSticker[] } {
  const { categories, stickers } = load();
  return { categories, stickers };
}

export function katkeeSticker(id: string): KatkeeSticker | null {
  return load().byId.get(id) ?? null;
}

/** The pack's stickers matching a search, best first: a word that starts with it, then one containing it. */
export function searchKatkeePack(query: string): KatkeeSticker[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const { stickers } = load();
  const starts = stickers.filter((s) => s.tags.some((t) => t.toLowerCase().startsWith(q)) || s.id.startsWith(q));
  const contains = stickers.filter((s) => !starts.includes(s) && (s.tags.some((t) => t.toLowerCase().includes(q)) || s.id.includes(q)));
  return [...starts, ...contains];
}

/** For tests. */
export function resetPack(): void {
  pack = null;
}
