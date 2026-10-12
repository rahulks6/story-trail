import { loadImage } from "react-native-nitro-image";
import { AVATAR_OUTPUT_SIZE } from "../models/avatarCrop";

/**
 * Cuts a square out of a photo on the phone and saves it as a JPEG (Phase 11), so only the part
 * you chose is ever uploaded. `rect` is in the photo's pixels (models/avatarCrop.ts).
 */
export async function cropSquarePhoto(
  uri: string,
  rect: { startX: number; startY: number; endX: number; endY: number },
  outputSize: number = AVATAR_OUTPUT_SIZE,
): Promise<string> {
  const image = await loadImage({ filePath: uri });
  const cropped = await image.cropAsync(rect.startX, rect.startY, rect.endX, rect.endY);
  const side = rect.endX - rect.startX;
  const sized = side > outputSize ? await cropped.resizeAsync(outputSize, outputSize) : cropped;
  const path = await sized.saveToTemporaryFileAsync("jpg", 90);
  return path.startsWith("file://") ? path : `file://${path}`;
}
