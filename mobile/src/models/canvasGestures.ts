/**
 * The Story editor's touch maths, kept apart from the components so it can be tested without a
 * phone: smooth drawing paths, two-finger move/resize/rotate, and the filter swipe.
 */

export interface Touch {
  pageX: number;
  pageY: number;
}

export interface Placement {
  x: number;
  y: number;
  scale: number;
  rotation: number;
}

export const MIN_OVERLAY_SCALE = 0.3;
export const MAX_OVERLAY_SCALE = 6;

const distance = (a: Touch, b: Touch) => Math.hypot(b.pageX - a.pageX, b.pageY - a.pageY);
const angle = (a: Touch, b: Touch) => (Math.atan2(b.pageY - a.pageY, b.pageX - a.pageX) * 180) / Math.PI;
const centre = (a: Touch, b: Touch) => ({ x: (a.pageX + b.pageX) / 2, y: (a.pageY + b.pageY) / 2 });

/**
 * Where an object ends up after a two-finger gesture (like Instagram): it grows or shrinks with the
 * fingers' spread, turns with their angle, and moves with the point between them. `start` is the
 * object and the two touches when the second finger landed; `now` is the two touches now.
 */
export function pinchPlacement(start: Placement, from: [Touch, Touch], now: [Touch, Touch], width: number, height: number): Placement {
  const d0 = distance(from[0], from[1]);
  const factor = d0 > 0 ? distance(now[0], now[1]) / d0 : 1;
  let turn = angle(now[0], now[1]) - angle(from[0], from[1]);
  if (turn > 180) turn -= 360;
  if (turn < -180) turn += 360;
  const c0 = centre(from[0], from[1]);
  const c1 = centre(now[0], now[1]);
  return {
    scale: Math.min(MAX_OVERLAY_SCALE, Math.max(MIN_OVERLAY_SCALE, start.scale * factor)),
    rotation: start.rotation + turn,
    x: width > 0 ? start.x + (c1.x - c0.x) / width : start.x,
    y: height > 0 ? start.y + (c1.y - c0.y) / height : start.y,
  };
}

/**
 * An SVG path through a stroke's points (normalized 0..1), smoothed with quadratic curves through
 * the midpoints so a freehand line looks drawn, not joined from straight pieces.
 */
export function strokePath(points: ReadonlyArray<{ x: number; y: number }>, width: number, height: number): string {
  if (points.length === 0) return "";
  const p = points.map((q) => [q.x * width, q.y * height] as const);
  const f = (n: number) => Math.round(n * 10) / 10;
  if (p.length === 1) return `M${f(p[0]![0])} ${f(p[0]![1])}L${f(p[0]![0] + 0.1)} ${f(p[0]![1])}`;
  let d = `M${f(p[0]![0])} ${f(p[0]![1])}`;
  for (let i = 1; i < p.length - 1; i++) {
    const [x, y] = p[i]!;
    const [nx, ny] = p[i + 1]!;
    d += `Q${f(x)} ${f(y)} ${f((x + nx) / 2)} ${f((y + ny) / 2)}`;
  }
  const last = p[p.length - 1]!;
  return d + `L${f(last[0])} ${f(last[1])}`;
}

/** How far a horizontal swipe on the photo must travel to change the filter. */
export const FILTER_SWIPE_DISTANCE = 50;

/**
 * The filter step a swipe has earned so far: -1 (next filter, swiping left), 1 (previous) or 0.
 * Mostly-vertical movement never counts, so scrolling a thumb up the screen won't change it.
 */
export function filterSwipeStep(dx: number, dy: number): -1 | 0 | 1 {
  if (Math.abs(dx) < FILTER_SWIPE_DISTANCE || Math.abs(dx) < Math.abs(dy) * 1.5) return 0;
  return dx < 0 ? -1 : 1;
}

/** A touch that barely moved is a tap. */
export const TAP_SLOP = 8;
