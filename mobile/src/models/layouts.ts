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
  { id: "six", cells: grid(2, 3) },
];

/** The size the finished collage is saved at: a full-resolution Story. */
export const LAYOUT_OUTPUT = { width: 1080, height: 1920 } as const;
