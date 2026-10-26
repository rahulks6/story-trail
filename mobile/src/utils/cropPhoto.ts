import { loadImage } from "react-native-nitro-image";
import { outputSize } from "../models/avatarCrop";

type CropRect = { startX: number; startY: number; endX: number; endY: number };

/**
 * Cuts a rectangle out of a photo on the phone and saves it as a JPEG (Phase 11), so only the
 * part you chose is ever uploaded, at most `maxWidth` x `maxHeight`. `rect` is in the photo's
 * pixels (models/avatarCrop.ts).
 */
export async function cropPhoto(uri: string, rect: CropRect, maxWidth: number, maxHeight: number): Promise<string> {
  const image = await loadImage({ filePath: uri });
  const cropped = await image.cropAsync(rect.startX, rect.startY, rect.endX, rect.endY);
  const cutWidth = rect.endX - rect.startX, cutHeight = rect.endY - rect.startY;
  const size = outputSize(cutWidth, cutHeight, maxWidth, maxHeight);
  const sized = size.width < cutWidth || size.height < cutHeight ? await cropped.resizeAsync(size.width, size.height) : cropped;
  const path = await sized.saveToTemporaryFileAsync("jpg", 90);
  return path.startsWith("file://") ? path : `file://${path}`;
}

