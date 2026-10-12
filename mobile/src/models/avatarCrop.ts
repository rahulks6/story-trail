/**
 * The square a profile photo is cut to (Phase 11), in the photo's own pixels. Pure, so the
 * cropper's gestures and the cut itself can be tested without a device.
 */
export interface AvatarCrop {
  /** 1 shows the photo's shorter side edge to edge; up to MAX_AVATAR_ZOOM. */
  zoom: number;
  /** The photo point at the centre of the circle, in photo pixels. */
  centerX: number;
  centerY: number;
}

export const MAX_AVATAR_ZOOM = 4;
/** The cut photo is saved at most this many pixels square. */
export const AVATAR_OUTPUT_SIZE = 640;

/** The side of the visible square, in photo pixels. */
export function cropSide(width: number, height: number, zoom: number): number {
  return Math.min(width, height) / zoom;
}

export function initialAvatarCrop(width: number, height: number): AvatarCrop {
  return { zoom: 1, centerX: width / 2, centerY: height / 2 };
}

/** Keeps the zoom in range and the square inside the photo. */
export function clampAvatarCrop(crop: AvatarCrop, width: number, height: number): AvatarCrop {
  const zoom = Math.min(MAX_AVATAR_ZOOM, Math.max(1, Number.isFinite(crop.zoom) ? crop.zoom : 1));
  const half = cropSide(width, height, zoom) / 2;
  const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, Number.isFinite(value) ? value : (low + high) / 2));
  return { zoom, centerX: clamp(crop.centerX, half, width - half), centerY: clamp(crop.centerY, half, height - half) };
}

/** A drag of (dx, dy) points across a circle `viewport` points wide: the photo follows the finger. */
export function panAvatarCrop(start: AvatarCrop, dx: number, dy: number, viewport: number, width: number, height: number): AvatarCrop {
  const pixelsPerPoint = cropSide(width, height, start.zoom) / viewport;
  return clampAvatarCrop({ ...start, centerX: start.centerX - dx * pixelsPerPoint, centerY: start.centerY - dy * pixelsPerPoint }, width, height);
}

/** Pinching (or the zoom buttons) by `factor`, keeping the same point in the middle. */
export function zoomAvatarCrop(start: AvatarCrop, factor: number, width: number, height: number): AvatarCrop {
  return clampAvatarCrop({ ...start, zoom: start.zoom * factor }, width, height);
}

/** The square to cut, in whole pixels, always inside the photo. */
export function avatarCropRect(crop: AvatarCrop, width: number, height: number): { startX: number; startY: number; endX: number; endY: number } {
  const c = clampAvatarCrop(crop, width, height);
  const side = Math.max(1, Math.min(Math.floor(cropSide(width, height, c.zoom)), Math.floor(width), Math.floor(height)));
  const startX = Math.min(Math.floor(width) - side, Math.max(0, Math.round(c.centerX - side / 2)));
  const startY = Math.min(Math.floor(height) - side, Math.max(0, Math.round(c.centerY - side / 2)));
  return { startX, startY, endX: startX + side, endY: startY + side };
}

/** Where to draw the photo so the crop fills a square `viewport` points wide. */
export function avatarImageLayout(crop: AvatarCrop, width: number, height: number, viewport: number): { width: number; height: number; left: number; top: number } {
  const c = clampAvatarCrop(crop, width, height);
  const scale = viewport / cropSide(width, height, c.zoom);
  return { width: width * scale, height: height * scale, left: viewport / 2 - c.centerX * scale, top: viewport / 2 - c.centerY * scale };
}
