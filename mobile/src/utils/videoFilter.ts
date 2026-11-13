import { NativeModules, Platform, findNodeHandle } from "react-native";
import { colorTransform, RECIPES, type ColorTransform, type FilterKey } from "../models/filterPreviews";

/**
 * The filter on a playing video in the editor, exact: the server's colour sum (filterPreviews.ts,
 * backend media/filters.ts) as Android's 4x5 colour matrix, put on the view around the video
 * (ColorFilterPackage.kt). Android's matrix works on 0-255 values, so the offsets are scaled.
 */
export function androidColorMatrix(t: ColorTransform): number[] {
  const out: number[] = [];
  for (let r = 0; r < 3; r++) out.push(t.matrix[r * 3] ?? 0, t.matrix[r * 3 + 1] ?? 0, t.matrix[r * 3 + 2] ?? 0, 0, (t.offset[r] ?? 0) * 255);
  out.push(0, 0, 0, 1, 0);
  return out;
}

interface ColorFilterModule { setColorMatrix(tag: number, matrix: number[] | null): Promise<boolean> }

/** Whether this phone can show the exact filter on a video (otherwise the editor shows a tint). */
export function canFilterVideo(): boolean {
  return Platform.OS === "android" && !!NativeModules.KatkeeColorFilter;
}

/** The native view's number for a View ref, or null before it's on screen. */
export function viewTag(ref: Parameters<typeof findNodeHandle>[0]): number | null {
  return findNodeHandle(ref) ?? null;
}

/** Puts `filter` on the native view `tag` (or takes it off for Original). Whether it's showing. */
export async function setVideoFilter(tag: number | null, filter: FilterKey): Promise<boolean> {
  const native = NativeModules.KatkeeColorFilter as ColorFilterModule | undefined;
  if (Platform.OS !== "android" || !native || tag === null) return false;
  try {
    return await native.setColorMatrix(tag, filter === "original" ? null : androidColorMatrix(colorTransform(RECIPES[filter])));
  } catch {
    return false;
  }
}
