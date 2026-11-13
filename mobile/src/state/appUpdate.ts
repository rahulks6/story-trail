import { useEffect } from "react";
import { AppState, NativeModules, Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * Keeping everyone on the latest Katkee: when Play has a newer version, Play's "Update available"
 * page shows over the app (InAppUpdatePackage.kt), on opening Katkee or coming back to it. Phones
 * otherwise wait days for Play's own auto-update (Wi-Fi, charging), so fixes reached few people.
 * Someone who closes the page is asked again after ASK_AGAIN_AFTER_MS; Play is only asked at
 * most every CHECK_EVERY_MS.
 */
export const ASK_AGAIN_AFTER_MS = 24 * 60 * 60 * 1000;
export const CHECK_EVERY_MS = 30 * 60 * 1000;
const KEY = "katkee.appUpdate.v1.lastShown";

type Result = "shown" | "none" | "error";
interface UpdateModule { checkAndUpdate(): Promise<Result> }

let lastCheck = 0;

/** Asks Play for a newer version and shows the update page if there is one (and it's time). */
export async function checkForAppUpdate(now = Date.now()): Promise<Result> {
  const native = NativeModules.KatkeeInAppUpdate as UpdateModule | undefined;
  if (Platform.OS !== "android" || !native) return "none";
  if (now - lastCheck < CHECK_EVERY_MS) return "none";
  lastCheck = now;
  try {
    const shown = Number(await AsyncStorage.getItem(KEY)) || 0;
    if (now - shown < ASK_AGAIN_AFTER_MS) return "none";
    const result = await native.checkAndUpdate();
    if (result === "shown") await AsyncStorage.setItem(KEY, String(now)).catch(() => undefined);
    return result;
  } catch {
    return "error";
  }
}

/** For tests. */
export function resetAppUpdateCheck(): void {
  lastCheck = 0;
}

/** Checks on start and whenever Katkee comes back to the front. Mounted once. */
export function useAppUpdate(): void {
  useEffect(() => {
    if (Platform.OS !== "android") return;
    void checkForAppUpdate();
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void checkForAppUpdate();
    });
    return () => sub.remove();
  }, []);
}
