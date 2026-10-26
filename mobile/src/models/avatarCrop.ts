/**
 * The rectangle a profile photo or cover is cut to (Phase 11), in the photo's own pixels. A
 * profile photo is a square (aspect 1); a cover is a 3:1 banner (COVER_ASPECT). Pure, so the
 * cropper's gestures and the cut itself can be tested without a device.
 */
export interface AvatarCrop {
  /** 1 shows the largest rectangle of the aspect that fits the photo; up to MAX_AVATAR_ZOOM. */
  zoom: number;
  /** The photo point at the centre of the frame, in photo pixels. */
  centerX: number;
  centerY: number;
}

export const MAX_AVATAR_ZOOM = 4;
/** The cut photo is saved at most this many pixels square. */
export const AVATAR_OUTPUT_SIZE = 640;
/** A cover is three times as wide as it is tall, and saved at most 1500 x 500. */
export const COVER_ASPECT = 3;
export const COVER_OUTPUT_WIDTH = 1500;
export const COVER_OUTPUT_HEIGHT = 500;

/** The visible rectangle, in photo pixels: at zoom 1 the largest one of `aspect` (width / height) that fits. */
export function cropSize(width: number, height: number, zoom: number, aspect = 1): { width: number; height: number } {
  const w = Math.min(width, height * aspect) / zoom;
  return { width: w, height: w / aspect };
}

/** The side of the visible square, in photo pixels. */
export function cropSide(width: number, height: number, zoom: number): number {
  return cropSize(width, height, zoom).width;
}

export function initialAvatarCrop(width: number, height: number): AvatarCrop {
  return { zoom: 1, centerX: width / 2, centerY: height / 2 };
}

/** Keeps the zoom in range and the rectangle inside the photo. */
export function clampAvatarCrop(crop: AvatarCrop, width: number, height: number, aspect = 1): AvatarCrop {
  const zoom = Math.min(MAX_AVATAR_ZOOM, Math.max(1, Number.isFinite(crop.zoom) ? crop.zoom : 1));
  const size = cropSize(width, height, zoom, aspect);
  const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, Number.isFinite(value) ? value : (low + high) / 2));
  return {
    zoom,
    centerX: clamp(crop.centerX, size.width / 2, width - size.width / 2),
    centerY: clamp(crop.centerY, size.height / 2, height - size.height / 2),
  };
}

/** A drag of (dx, dy) points across a frame `viewport` points wide: the photo follows the finger. */
export function panAvatarCrop(start: AvatarCrop, dx: number, dy: number, viewport: number, width: number, height: number, aspect = 1): AvatarCrop {
  const pixelsPerPoint = cropSize(width, height, start.zoom, aspect).width / viewport;
  return clampAvatarCrop({ ...start, centerX: start.centerX - dx * pixelsPerPoint, centerY: start.centerY - dy * pixelsPerPoint }, width, height, aspect);
}

/** Pinching (or the zoom buttons) by `factor`, keeping the same point in the middle. */
export function zoomAvatarCrop(start: AvatarCrop, factor: number, width: number, height: number, aspect = 1): AvatarCrop {
  return clampAvatarCrop({ ...start, zoom: start.zoom * factor }, width, height, aspect);
}

/** The rectangle to cut, in whole pixels, always inside the photo (a square for aspect 1). */
export function avatarCropRect(crop: AvatarCrop, width: number, height: number, aspect = 1): { startX: number; startY: number; endX: number; endY: number } {
  const c = clampAvatarCrop(crop, width, height, aspect);
  // Whole pixels from the height, so a 3:1 cut is exactly three times as wide as it is tall.
  const cutHeight = Math.max(1, Math.min(Math.floor(cropSize(width, height, c.zoom, aspect).height), Math.floor(height), Math.floor(Math.floor(width) / aspect)));
  const cutWidth = Math.max(1, Math.min(Math.round(cutHeight * aspect), Math.floor(width)));
  const startX = Math.min(Math.floor(width) - cutWidth, Math.max(0, Math.round(c.centerX - cutWidth / 2)));
  const startY = Math.min(Math.floor(height) - cutHeight, Math.max(0, Math.round(c.centerY - cutHeight / 2)));
  return { startX, startY, endX: startX + cutWidth, endY: startY + cutHeight };
}

/** Where to draw the photo so the crop fills a frame `viewport` points wide (and viewport / aspect tall). */
export function avatarImageLayout(crop: AvatarCrop, width: number, height: number, viewport: number, aspect = 1): { width: number; height: number; left: number; top: number } {
  const c = clampAvatarCrop(crop, width, height, aspect);
  const scale = viewport / cropSize(width, height, c.zoom, aspect).width;
  return { width: width * scale, height: height * scale, left: viewport / 2 - c.centerX * scale, top: viewport / aspect / 2 - c.centerY * scale };
}

/** The size a cut is saved at: no larger than the cut itself or the limits, keeping its shape. */
export function outputSize(cutWidth: number, cutHeight: number, maxWidth: number, maxHeight: number): { width: number; height: number } {
  const scale = Math.min(1, maxWidth / cutWidth, maxHeight / cutHeight);
  return { width: Math.max(1, Math.round(cutWidth * scale)), height: Math.max(1, Math.round(cutHeight * scale)) };
}
