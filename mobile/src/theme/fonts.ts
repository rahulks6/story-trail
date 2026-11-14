import { Platform } from "react-native";

/**
 * Katkee's own type (the Postcard look): Baloo 2 for headings, made for Indian scripts as well as
 * Latin, and a handwriting face for Story captions on polaroids. Bundled on Android
 * (android/app/src/main/assets/fonts, SIL OFL); iPhone uses its closest system fonts for now.
 */
export const fonts = {
  /** Big headings: "Today", names on profiles, sheet titles. */
  display: Platform.select({ android: "Baloo2-ExtraBold", default: "System" }) as string,
  /** Smaller headings and labels that want the same voice. */
  displaySemi: Platform.select({ android: "Baloo2-SemiBold", default: "System" }) as string,
  /** Handwritten captions on polaroids. */
  hand: Platform.select({ android: "Pacifico-Regular", default: "SnellRoundhand-Bold" }) as string,
};
