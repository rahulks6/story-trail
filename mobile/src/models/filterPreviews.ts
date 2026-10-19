import type { FilterName } from "./storyDraft";

/**
 * Story filters. The server applies the chosen filter to the photo's or video's pixels while it
 * processes the upload (backend/src/modules/media/filters.ts), so every viewer sees the same
 * picture. The editor previews a photo with the very same colour transform, computed on the
 * phone (utils/filterPhoto.ts): RECIPES and colorTransform below are an identical copy of the
 * server's, and verification/story-filters.cjs checks the two agree.
 *
 * A Story whose media was uploaded without a filter (`filterApplied: false`) is still shown with
 * the light colour tint below, as before; so is the live preview of a video in the editor.
 */

export type FilterKey = "original" | "warm" | "cool" | "bright" | "cinema" | "mono" | "vintage" | "soft" | "vivid" | "night" | "fade";

export interface FilterRecipe {
  /** Added to every channel, -0.2 to 0.2. */
  brightness?: number;
  /** Around mid-grey: 1 leaves the image as it is. */
  contrast?: number;
  /** 0 is black and white, 1 leaves colour as it is. */
  saturation?: number;
  /** Positive warms (more red, less blue), negative cools. */
  warmth?: number;
  /** Lifts the blacks towards grey, 0 to 0.3. */
  fade?: number;
  /** Blends towards a sepia tone, 0 to 1. */
  sepia?: number;
}

export const RECIPES: Record<FilterKey, FilterRecipe> = {
  original: {},
  warm: { warmth: 0.1, saturation: 1.08, contrast: 1.04, brightness: 0.01 },
  cool: { warmth: -0.09, contrast: 1.05, brightness: 0.015 },
  bright: { brightness: 0.06, contrast: 1.06, saturation: 1.06 },
  cinema: { contrast: 1.18, saturation: 0.82, warmth: -0.03, brightness: -0.025 },
  mono: { saturation: 0, contrast: 1.12 },
  vintage: { sepia: 0.4, fade: 0.07, contrast: 0.94, warmth: 0.03 },
  soft: { contrast: 0.9, fade: 0.06, saturation: 0.94, brightness: 0.02 },
  vivid: { saturation: 1.35, contrast: 1.1 },
  night: { brightness: -0.06, contrast: 1.12, warmth: -0.06, saturation: 0.9 },
  fade: { fade: 0.14, contrast: 0.92, saturation: 0.88 },
};

/** out = matrix · in + offset: matrix is 3×3 row-major, offset is per channel, both on 0..1 values. */
export interface ColorTransform {
  matrix: number[];
  offset: number[];
}

// BEGIN shared colorTransform (keep identical to backend/src/modules/media/filters.ts)
const LUMA = [0.2126, 0.7152, 0.0722];
const SEPIA = [0.393, 0.769, 0.189, 0.349, 0.686, 0.168, 0.272, 0.534, 0.131];
const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const at = (values: readonly number[], index: number): number => values[index] ?? 0;

/** `first`, then out = matrix · in + offset. */
function then(first: ColorTransform, matrix: number[], offset: number[]): ColorTransform {
  const m: number[] = [];
  const o: number[] = [];
  for (let r = 0; r < 3; r++) {
    const row = [at(matrix, r * 3), at(matrix, r * 3 + 1), at(matrix, r * 3 + 2)];
    for (let c = 0; c < 3; c++) m.push(row.reduce((sum, k, i) => sum + k * at(first.matrix, i * 3 + c), 0));
    o.push(row.reduce((sum, k, i) => sum + k * at(first.offset, i), at(offset, r)));
  }
  return { matrix: m, offset: o };
}

export function colorTransform(recipe: FilterRecipe): ColorTransform {
  let t: ColorTransform = { matrix: IDENTITY, offset: [0, 0, 0] };
  const sepia = recipe.sepia ?? 0;
  if (sepia) t = then(t, IDENTITY.map((v, i) => v * (1 - sepia) + at(SEPIA, i) * sepia), [0, 0, 0]);
  const s = recipe.saturation ?? 1;
  if (s !== 1) t = then(t, IDENTITY.map((v, i) => at(LUMA, i % 3) * (1 - s) + v * s), [0, 0, 0]);
  const w = recipe.warmth ?? 0;
  if (w) t = then(t, [1 + w, 0, 0, 0, 1, 0, 0, 0, 1 - w], [0, 0, 0]);
  const c = recipe.contrast ?? 1;
  if (c !== 1) t = then(t, IDENTITY.map((v) => v * c), [0, 1, 2].map(() => 0.5 * (1 - c)));
  const b = recipe.brightness ?? 0;
  if (b) t = then(t, IDENTITY, [b, b, b]);
  const f = recipe.fade ?? 0;
  if (f) t = then(t, IDENTITY.map((v) => v * (1 - f)), [f, f, f]);
  return t;
}
// END shared colorTransform

/** Where red, green and blue sit inside one pixel, and how many bytes a pixel takes. */
const PIXEL_LAYOUTS: Record<string, { r: number; g: number; b: number; size: number }> = {
  RGBA: { r: 0, g: 1, b: 2, size: 4 },
  RGBX: { r: 0, g: 1, b: 2, size: 4 },
  BGRA: { r: 2, g: 1, b: 0, size: 4 },
  BGRX: { r: 2, g: 1, b: 0, size: 4 },
  ARGB: { r: 1, g: 2, b: 3, size: 4 },
  XRGB: { r: 1, g: 2, b: 3, size: 4 },
  ABGR: { r: 3, g: 2, b: 1, size: 4 },
  XBGR: { r: 3, g: 2, b: 1, size: 4 },
  RGB: { r: 0, g: 1, b: 2, size: 3 },
  BGR: { r: 2, g: 1, b: 0, size: 3 },
};

export function canFilterPixelFormat(format: string): boolean {
  return format in PIXEL_LAYOUTS;
}

/**
 * Applies a transform in place to 8-bit pixels, the same arithmetic as the server's
 * applyToPixels. Rows may be padded (`bytes.length / height` bytes each); alpha is left alone.
 */
export function applyToPixels(bytes: Uint8Array, width: number, height: number, format: string, t: ColorTransform): void {
  const layout = PIXEL_LAYOUTS[format];
  if (!layout || height <= 0) return;
  const rowBytes = Math.floor(bytes.length / height);
  const table = new Float32Array(9 * 256);
  for (let k = 0; k < 9; k++) for (let v = 0; v < 256; v++) table[k * 256 + v] = (at(t.matrix, k) * v) / 255;
  const o0 = at(t.offset, 0), o1 = at(t.offset, 1), o2 = at(t.offset, 2);
  const { r: lr, g: lg, b: lb, size } = layout;
  // Unrolled for speed on the phone (a 1080p photo is ~1.5M pixels); same sums, in the same order.
  for (let y = 0; y < height; y++) {
    const end = y * rowBytes + width * size;
    for (let i = y * rowBytes; i < end; i += size) {
      const r = bytes[i + lr]!, g = bytes[i + lg]! + 256, b = bytes[i + lb]! + 512;
      const v0 = table[r]! + table[g]! + table[b]! + o0;
      const v1 = table[768 + r]! + table[768 + g]! + table[768 + b]! + o1;
      const v2 = table[1536 + r]! + table[1536 + g]! + table[1536 + b]! + o2;
      bytes[i + lr] = v0 <= 0 ? 0 : v0 >= 1 ? 255 : Math.round(v0 * 255);
      bytes[i + lg] = v1 <= 0 ? 0 : v1 >= 1 ? 255 : Math.round(v1 * 255);
      bytes[i + lb] = v2 <= 0 ? 0 : v2 >= 1 ? 255 : Math.round(v2 * 255);
    }
  }
}

/** A light colour tint per filter: for media without a baked filter, and the editor's video preview. */
export interface FilterPreview {
  name: FilterName;
  overlayColor: string;
  overlayOpacity: number;
}

/** The backend stores/returns filter names lowercased (see storyDraft.ts's filterKey) — this is the read-side inverse. */
export function filterNameFromKey(key: string): FilterName {
  const match = FILTER_PREVIEWS.find((f) => f.name.toLowerCase() === key.toLowerCase());
  return match?.name ?? "Original";
}

export const FILTER_PREVIEWS: FilterPreview[] = [
  { name: "Original", overlayColor: "transparent", overlayOpacity: 0 },
  { name: "Warm", overlayColor: "#FF8A34", overlayOpacity: 0.12 },
  { name: "Cool", overlayColor: "#3E7BFF", overlayOpacity: 0.12 },
  { name: "Bright", overlayColor: "#FFFFFF", overlayOpacity: 0.1 },
  { name: "Cinema", overlayColor: "#1A2A3A", overlayOpacity: 0.22 },
  { name: "Mono", overlayColor: "#808080", overlayOpacity: 0.35 },
  { name: "Vintage", overlayColor: "#C9A66B", overlayOpacity: 0.2 },
  { name: "Soft", overlayColor: "#FFE8E8", overlayOpacity: 0.15 },
  { name: "Vivid", overlayColor: "#FF3366", overlayOpacity: 0.08 },
  { name: "Night", overlayColor: "#0A1030", overlayOpacity: 0.3 },
  { name: "Fade", overlayColor: "#CCCCCC", overlayOpacity: 0.25 },
];
