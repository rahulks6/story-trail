import AsyncStorage from "@react-native-async-storage/async-storage";
import { Appearance, NativeModules, Platform } from "react-native";
import { applyColorScheme, type ColorScheme } from "./colors";

/** Automatic follows the phone's own light or dark setting. */
export type AppearanceChoice = "system" | "light" | "dark";

const KEY = "katkee.appearance.v1";
let choice: AppearanceChoice = "system";

function resolve(c: AppearanceChoice): ColorScheme {
  if (c === "light" || c === "dark") return c;
  return Appearance.getColorScheme() === "light" ? "light" : "dark";
}

/** Called once at launch, before the app's screens load: picks the colours they are drawn with. */
export async function loadAppearance(): Promise<void> {
  try {
    const saved = await AsyncStorage.getItem(KEY);
    if (saved === "light" || saved === "dark" || saved === "system") choice = saved;
  } catch {
    // First launch or storage unavailable: Automatic.
  }
  applyColorScheme(resolve(choice));
}

export function appearanceChoice(): AppearanceChoice {
  return choice;
}

/**
 * Saves the choice and, where the phone allows, reloads the app so every screen redraws in the
 * new colours (Android). Returns false when the person has to reopen Katkee themselves.
 */
export async function setAppearance(next: AppearanceChoice): Promise<boolean> {
  choice = next;
  await AsyncStorage.setItem(KEY, next).catch(() => undefined);
  const restart = (NativeModules as { KatkeeAppRestart?: { restart: () => void } }).KatkeeAppRestart;
  if (Platform.OS === "android" && restart) {
    restart.restart();
    return true;
  }
  return false;
}
