/**
 * Story filters, applied to the pixels of a Story's photo or video while it is processed, so
 * every viewer (and every saved or shared copy) sees the same picture.
 *
 * Each filter is a recipe of a few familiar adjustments. The recipe becomes one colour transform,
 * out = matrix · in + offset on sRGB values from 0 to 1, clamped. The app's editor previews the
 * very same transform (mobile/src/models/filterPreviews.ts holds an identical copy of RECIPES and
 * colorTransform; verification/story-filters.cjs checks the two agree).
 *
 * Photos: the transform runs over the processed pixels in one pass, so nothing clips half-way.
 * Videos: ffmpeg applies it through a 3D lookup table (lut3d). The transform is affine, so the
 * table's trilinear interpolation reproduces it exactly between grid points.
 */
import * as fsp from "node:fs/promises";
import type { FilterKey } from "../stories/overlays";

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

// BEGIN shared colorTransform (keep identical to mobile/src/models/filterPreviews.ts)
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

export function isFilterKey(value: unknown): value is FilterKey {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(RECIPES, value);
}

/** The transform for a filter, or null when it leaves the picture as it is. */
export function transformFor(key: FilterKey): ColorTransform | null {
  return key === "original" ? null : colorTransform(RECIPES[key]);
}

/** Applies a transform in place to 8-bit interleaved pixels (`channels` 3 or 4; alpha is left alone). */
export function applyToPixels(pixels: Buffer, channels: number, t: ColorTransform): void {
  // Per-channel lookup tables for each matrix column turn the 3×3 product into nine table reads.
  const table = new Float32Array(9 * 256);
  for (let k = 0; k < 9; k++) for (let v = 0; v < 256; v++) table[k * 256 + v] = (at(t.matrix, k) * v) / 255;
  const offset = [at(t.offset, 0), at(t.offset, 1), at(t.offset, 2)];
  for (let i = 0; i + 2 < pixels.length; i += channels) {
    const r = pixels[i] ?? 0, g = pixels[i + 1] ?? 0, b = pixels[i + 2] ?? 0;
    for (let ch = 0; ch < 3; ch++) {
      const v = (table[ch * 768 + r] ?? 0) + (table[ch * 768 + 256 + g] ?? 0) + (table[ch * 768 + 512 + b] ?? 0) + (offset[ch] ?? 0);
      pixels[i + ch] = v <= 0 ? 0 : v >= 1 ? 255 : Math.round(v * 255);
    }
  }
}

/** Writes the transform as a .cube 3D lookup table for ffmpeg's lut3d filter. */
export async function writeCubeFile(file: string, t: ColorTransform, size = 33): Promise<void> {
  const lines = [`TITLE "katkee"`, `LUT_3D_SIZE ${size}`, "DOMAIN_MIN 0 0 0", "DOMAIN_MAX 1 1 1"];
  const clamp = (v: number) => (v <= 0 ? 0 : v >= 1 ? 1 : v);
  // .cube order: red changes fastest, then green, then blue.
  for (let bi = 0; bi < size; bi++) {
    for (let gi = 0; gi < size; gi++) {
      for (let ri = 0; ri < size; ri++) {
        const rgb = [ri / (size - 1), gi / (size - 1), bi / (size - 1)];
        const out = [0, 1, 2].map((ch) => clamp(rgb.reduce((sum, v, i) => sum + at(t.matrix, ch * 3 + i) * v, at(t.offset, ch))));
        lines.push(out.map((v) => v.toFixed(6)).join(" "));
      }
    }
  }
  await fsp.writeFile(file, lines.join("\n") + "\n");
}
