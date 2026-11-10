import { pinchPlacement, type Touch } from "./canvasGestures";

/**
 * How a photo sits in its Story, after two fingers move it (like Instagram): its centre as a
 * fraction of the frame (0.5, 0.5 is centred), its size (1 fills the frame) and its turn in
 * degrees. Anything it no longer covers shows a soft blur of the same photo. When the photo is
 * shared, the editor saves it exactly as it looks (StoryEditorScreen), so every viewer, the
 * website and older apps see the same picture without knowing about any of this.
 */
export interface PhotoFrame { x: number; y: number; scale: number; rotation: number }

export const UNFRAMED: PhotoFrame = { x: 0.5, y: 0.5, scale: 1, rotation: 0 };
/** Small enough to see all of a wide panorama inside the tall Story frame. */
export const MIN_PHOTO_SCALE = 0.2;
export const MAX_PHOTO_SCALE = 4;
/** Within this many degrees of straight (or a quarter turn), the photo settles exactly straight. */
const SNAP_DEGREES = 3;
/** Within this fraction of the centre, it settles exactly centred. */
const SNAP_CENTRE = 0.015;
/** Within this of its natural size, it settles at exactly that size. */
const SNAP_SCALE = 0.03;

/** An angle as -180 to 180 degrees. */
function normalised(degrees: number): number {
  let d = degrees % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

/** Nearly straight, nearly centred, nearly full size: made exactly so, as the fingers move. */
export function settled(frame: PhotoFrame): PhotoFrame {
  const rotation = normalised(frame.rotation);
  const quarter = Math.round(rotation / 90) * 90;
  return {
    x: Math.abs(frame.x - 0.5) < SNAP_CENTRE ? 0.5 : frame.x,
    y: Math.abs(frame.y - 0.5) < SNAP_CENTRE ? 0.5 : frame.y,
    scale: Math.abs(frame.scale - 1) < SNAP_SCALE ? 1 : frame.scale,
    rotation: Math.abs(rotation - quarter) < SNAP_DEGREES ? normalised(quarter) : rotation,
  };
}

/** Where the photo goes as two fingers move from `from` to `now`, starting from `start`. */
export function framePhoto(start: PhotoFrame, from: [Touch, Touch], now: [Touch, Touch], width: number, height: number): PhotoFrame {
  const next = pinchPlacement(start, from, now, width, height, { min: MIN_PHOTO_SCALE, max: MAX_PHOTO_SCALE });
  return settled({
    x: Math.min(1.5, Math.max(-0.5, next.x)),
    y: Math.min(1.5, Math.max(-0.5, next.y)),
    scale: Math.min(MAX_PHOTO_SCALE, Math.max(MIN_PHOTO_SCALE, next.scale)),
    rotation: next.rotation,
  });
}

/**
 * The size at which the photo fills the frame (scale 1), keeping its shape: the parts outside
 * the frame are still there, so making it smaller or turning it shows them instead of cutting.
 */
export function coverBox(frameW: number, frameH: number, photoW: number, photoH: number): { width: number; height: number } {
  const s = Math.max(frameW / photoW, frameH / photoH);
  return { width: photoW * s, height: photoH * s };
}

/**
 * Where a photo starts: a wide or square one fits the frame whole (nothing cut, the blur around
 * it), as Instagram does; a tall one fills it. Two fingers then make it bigger, smaller or turn it.
 */
export function initialFrame(frameW: number, frameH: number, photoW: number, photoH: number): PhotoFrame {
  if (!(frameW > 0 && frameH > 0 && photoW > 0 && photoH > 0)) return UNFRAMED;
  const photoShape = photoW / photoH, frameShape = frameW / frameH;
  if (photoShape <= frameShape * 1.15) return UNFRAMED;
  const fit = Math.min(frameW / photoW, frameH / photoH) / Math.max(frameW / photoW, frameH / photoH);
  return { x: 0.5, y: 0.5, scale: Math.max(MIN_PHOTO_SCALE, fit), rotation: 0 };
}

/** Whether the photo has been moved, resized or turned at all. */
export function isFramed(frame: PhotoFrame): boolean {
  const s = settled(frame);
  return s.x !== 0.5 || s.y !== 0.5 || s.scale !== 1 || s.rotation !== 0;
}
