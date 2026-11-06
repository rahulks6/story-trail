/**
 * Layouts (Camera > Layout): several photos in one Story. Each layout is a list of cells in a 9:16
 * frame, as fractions of its width and height; the cells tile the frame exactly.
 */
export interface LayoutCell { x: number; y: number; w: number; h: number }
export interface StoryLayout { id: string; cells: LayoutCell[] }

const rows = (n: number): LayoutCell[] => Array.from({ length: n }, (_, i) => ({ x: 0, y: i / n, w: 1, h: 1 / n }));
const grid = (cols: number, rowCount: number): LayoutCell[] =>
  Array.from({ length: cols * rowCount }, (_, i) => ({ x: (i % cols) / cols, y: Math.floor(i / cols) / rowCount, w: 1 / cols, h: 1 / rowCount }));

export const LAYOUTS: readonly StoryLayout[] = [
  { id: "two-rows", cells: rows(2) },
  { id: "two-columns", cells: grid(2, 1) },
  { id: "three-rows", cells: rows(3) },
  { id: "one-and-two", cells: [{ x: 0, y: 0, w: 1, h: 0.5 }, { x: 0, y: 0.5, w: 0.5, h: 0.5 }, { x: 0.5, y: 0.5, w: 0.5, h: 0.5 }] },
  { id: "four", cells: grid(2, 2) },
  { id: "five", cells: [
    { x: 0, y: 0, w: 0.5, h: 0.5 }, { x: 0.5, y: 0, w: 0.5, h: 0.5 },
    { x: 0, y: 0.5, w: 1 / 3, h: 0.5 }, { x: 1 / 3, y: 0.5, w: 1 / 3, h: 0.5 }, { x: 2 / 3, y: 0.5, w: 1 / 3, h: 0.5 },
  ] },
  { id: "six", cells: grid(2, 3) },
];

/** The most photos one layout holds, and so the most the gallery lets you pick at once. */
export const MAX_LAYOUT_PHOTOS = Math.max(...LAYOUTS.map((l) => l.cells.length));

/** The size the finished collage is saved at: a full-resolution Story. */
export const LAYOUT_OUTPUT = { width: 1080, height: 1920 } as const;

/**
 * The layout for this many photos: the first with exactly that many spaces, else the smallest
 * with room for them all (one photo goes in the first two-space layout).
 */
export function layoutFor(count: number): StoryLayout {
  return LAYOUTS.find((l) => l.cells.length === count)
    ?? [...LAYOUTS].sort((a, b) => a.cells.length - b.cells.length).find((l) => l.cells.length >= count)
    ?? LAYOUTS[LAYOUTS.length - 1]!;
}

/**
 * A photo in a space. It fills the space (cropping what doesn't fit, as a cover photo does), and
 * `x`/`y` say which part shows: -1 its left/top edge, 0 its centre, 1 its right/bottom edge.
 * Width and height are the photo's own, when known; without them it is simply centred.
 */
export interface LayoutPhoto { uri: string; width?: number; height?: number; x: number; y: number }

/** Where the photo is drawn inside a space `w` x `h` points: larger than the space, offset to show the chosen part. */
export function photoFrame(photo: LayoutPhoto, w: number, h: number): { left: number; top: number; width: number; height: number } | null {
  if (!photo.width || !photo.height || w <= 0 || h <= 0) return null;
  const scale = Math.max(w / photo.width, h / photo.height);
  const width = photo.width * scale, height = photo.height * scale;
  const spareX = width - w, spareY = height - h;
  return { width, height, left: (-spareX / 2) * (1 + photo.x), top: (-spareY / 2) * (1 + photo.y) };
}

const clamp = (v: number) => Math.max(-1, Math.min(1, v));

/** The photo's position after a drag of `dx`, `dy` points from where it was (`from`): it follows the finger, never past its edges. */
export function dragPhoto(from: LayoutPhoto, dx: number, dy: number, w: number, h: number): { x: number; y: number } {
  const frame = photoFrame(from, w, h);
  if (!frame) return { x: from.x, y: from.y };
  const spareX = frame.width - w, spareY = frame.height - h;
  return {
    x: spareX > 0.5 ? clamp(from.x - dx / (spareX / 2)) : 0,
    y: spareY > 0.5 ? clamp(from.y - dy / (spareY / 2)) : 0,
  };
}
