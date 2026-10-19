import { Platform } from "react-native";
import * as RNFS from "@dr.pogodin/react-native-fs";
import { Images, loadImage, type Image } from "react-native-nitro-image";
import { RECIPES, applyToPixels, canFilterPixelFormat, colorTransform, type FilterKey } from "../models/filterPreviews";
import { base64ToBytes } from "./base64";
import { exifOrientation, uprightSteps } from "./exifOrientation";

/**
 * The editor's filter preview for a photo: the photo, upright and at most `maxEdge` pixels on its
 * long side, with the filter applied by the same arithmetic the server uses when it processes the
 * upload (models/filterPreviews.ts). What the person sees here is what their Story will look like.
 * Results are cached per photo, size and filter; the upright, resized pixels are decoded once.
 */

interface BasePixels {
  bytes: Uint8Array;
  width: number;
  height: number;
  format: string;
}

/**
 * Rows filtered between pauses: the whole photo in one go held the JS thread (and so any finger
 * on the screen) for a noticeable moment. Each pixel is still worked out by applyToPixels itself,
 * so the result is exactly the same.
 */
const ROWS_PER_SLICE = 96;
const pause = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

async function applyInSlices(bytes: Uint8Array, width: number, height: number, format: string, t: ReturnType<typeof colorTransform>): Promise<void> {
  if (height <= 0) return;
  const rowBytes = Math.floor(bytes.length / height);
  for (let y = 0; y < height; y += ROWS_PER_SLICE) {
    if (y > 0) await pause();
    const rows = Math.min(ROWS_PER_SLICE, height - y);
    applyToPixels(bytes.subarray(y * rowBytes, (y + rows) * rowBytes), width, rows, format, t);
  }
}

const bases = new Map<string, Promise<BasePixels>>();
const previews = new Map<string, Promise<string>>();

function localPath(uri: string): string {
  return uri.startsWith("file://") ? decodeURI(uri.slice(7)) : uri;
}

async function upright(uri: string): Promise<Image> {
  let image = await loadImage({ filePath: uri });
  // iOS reads the EXIF orientation into the UIImage and applies it when the image is drawn
  // (the resize below always draws it). Android's decoder ignores it.
  if (Platform.OS !== "android") return image;
  let orientation = 1;
  try {
    orientation = exifOrientation(base64ToBytes(await RNFS.read(localPath(uri), 128 * 1024, 0, "base64")));
  } catch {
    orientation = 1;
  }
  const steps = uprightSteps(orientation);
  if (steps.mirror) image = await image.mirrorHorizontallyAsync();
  if (steps.rotate) image = await image.rotateAsync(steps.rotate);
  return image;
}

function basePixels(uri: string, maxEdge: number): Promise<BasePixels> {
  const key = `${uri}|${maxEdge}`;
  let base = bases.get(key);
  if (!base) {
    base = (async () => {
      const image = await upright(uri);
      const scale = Math.min(1, maxEdge / Math.max(image.width, image.height));
      const sized = await image.resizeAsync(Math.max(1, Math.round(image.width * scale)), Math.max(1, Math.round(image.height * scale)));
      const raw = await sized.toRawPixelDataAsync(false);
      if (!canFilterPixelFormat(raw.pixelFormat)) throw new Error(`Unsupported pixel format ${raw.pixelFormat}`);
      return { bytes: new Uint8Array(raw.buffer.slice(0)), width: raw.width, height: raw.height, format: raw.pixelFormat };
    })();
    base.catch(() => bases.delete(key));
    bases.set(key, base);
  }
  return base;
}

/** A file:// URI of the filtered preview. "original" is the photo itself. */
export function filteredPhotoUri(uri: string, filter: FilterKey, maxEdge: number): Promise<string> {
  if (filter === "original") return Promise.resolve(uri);
  const key = `${uri}|${maxEdge}|${filter}`;
  let preview = previews.get(key);
  if (!preview) {
    preview = (async () => {
      const base = await basePixels(uri, maxEdge);
      const bytes = base.bytes.slice();
      await applyInSlices(bytes, base.width, base.height, base.format, colorTransform(RECIPES[filter]));
      const image = await Images.loadFromRawPixelDataAsync(
        { buffer: bytes.buffer as ArrayBuffer, width: base.width, height: base.height, pixelFormat: base.format as never },
        false,
      );
      const path = await image.saveToTemporaryFileAsync("jpg", 92);
      return path.startsWith("file://") ? path : `file://${path}`;
    })();
    preview.catch(() => previews.delete(key));
    previews.set(key, preview);
  }
  return preview;
}

/** Forgets the cached previews of a photo (when the editor closes). */
export function forgetFilteredPhoto(uri: string): void {
  for (const key of [...bases.keys()]) if (key.startsWith(`${uri}|`)) bases.delete(key);
  for (const key of [...previews.keys()]) if (key.startsWith(`${uri}|`)) previews.delete(key);
}
