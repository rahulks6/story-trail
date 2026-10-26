import { Platform, type TextStyle as RNTextStyle } from "react-native";
import type { TextStyle } from "../models/storyDraft";

/**
 * How each Story text style looks. On Android the fonts are bundled with the app
 * (android/app/src/main/assets/fonts, named by PostScript name), so every phone shows the same
 * thing; the phone's own font families ("cursive", "serif"...) differ by maker and several fell
 * back to the plain font. iOS has comparable fonts built in.
 */
const FONTS: Record<TextStyle, { android?: string; ios?: string; weight?: RNTextStyle["fontWeight"] }> = {
  Clean: { weight: "700" },
  Bold: { android: "ArchivoBlack-Regular", ios: "AvenirNext-Heavy" },
  Classic: { android: "PlayfairDisplay-BoldItalic", ios: "Georgia-BoldItalic" },
  Modern: { android: "BebasNeue-Regular", ios: "AvenirNextCondensed-Bold" },
  Typewriter: { android: "SpecialElite-Regular", ios: "AmericanTypewriter" },
  Outline: { android: "ArchivoBlack-Regular", ios: "AvenirNext-Heavy" },
  Soft: { android: "Pacifico-Regular", ios: "SnellRoundhand-Bold" },
  Highlight: { weight: "700" },
};

/** The names people see. "Highlight" is stored for compatibility and shown as Neon (a glow). */
export const STYLE_LABELS: Record<TextStyle, string> = {
  Clean: "Clean", Bold: "Strong", Classic: "Classic", Modern: "Modern", Typewriter: "Typewriter", Outline: "Outline", Soft: "Script", Highlight: "Neon",
};

export const TEXT_STYLES: TextStyle[] = ["Clean", "Bold", "Classic", "Modern", "Typewriter", "Outline", "Soft", "Highlight"];

/** Black or white, whichever reads better on `hex`. */
export function contrastOn(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return "#FFFFFF";
  const n = parseInt(m[1]!, 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b! > 0.4 ? "#000000" : "#FFFFFF";
}

/** The font (and, for Modern, the capitals and spacing) of a style. */
export function fontLook(style: TextStyle): RNTextStyle {
  const f = FONTS[style] ?? FONTS.Clean;
  const family = Platform.OS === "ios" ? f.ios : f.android;
  const look: RNTextStyle = family ? { fontFamily: family, fontWeight: "normal" } : { fontWeight: f.weight ?? "700" };
  if (style === "Modern") Object.assign(look, { letterSpacing: 1.5, textTransform: "uppercase" });
  return look;
}

/**
 * Whether Story text can sit tight on its label (Android's includeFontPadding off). Only Latin
 * letters fit in the Story fonts' own height: an emoji (drawn from the emoji font, which is
 * taller) or a script such as Hindi with marks above the line was cut off at the top and bottom.
 */
export function tightTextFits(text: string): boolean {
  return /^[\u0000-ɏ -⁯₠-₿]*$/.test(text);
}

/** Neon's glow radius for text of `fontSize`: Android draws no blur wider than 25. */
export function neonRadius(fontSize: number): number {
  return Math.min(25, Math.max(6, fontSize * 0.4));
}

/** Neon's bright core: the glow colour washed towards white, like a lit tube. */
export function neonCore(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return "#FFFFFF";
  const n = parseInt(m[1]!, 16);
  const mix = (c: number) => Math.round(c + (255 - c) * 0.7).toString(16).padStart(2, "0");
  return `#${mix((n >> 16) & 255)}${mix((n >> 8) & 255)}${mix(n & 255)}`.toUpperCase();
}

/**
 * Font plus effect, for text of `color` at `fontSize`: Neon is a light core glowing in the colour
 * (callers pad the text by neonRadius so the glow isn't cut off at its edges); Outline gets a hard
 * shadow (the editor's preview; the Story draws a full outline). The text colour is the caller's.
 */
export function textStyleLook(style: TextStyle, color = "#FFFFFF", fontSize = 30): RNTextStyle {
  const look = fontLook(style);
  if (style === "Highlight") Object.assign(look, { textShadowColor: color, textShadowRadius: neonRadius(fontSize), textShadowOffset: { width: 0, height: 0 } });
  if (style === "Outline") Object.assign(look, { textShadowColor: contrastOn(color), textShadowRadius: 2, textShadowOffset: { width: 1.5, height: 1.5 } });
  return look;
}
