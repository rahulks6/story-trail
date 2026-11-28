/**
 * Katkee's colours, dark and light. Dark is the locked master spec palette (pages 2-3); light is
 * its daytime counterpart: the same roles, with a deeper gold accent because amber is unreadable
 * as text on white (verification/contrast.cjs checks every text pair in both).
 */
export const darkPalette = {
  // "Midnight": a warm black, cards a step lighter, warm white text (aesthetic refresh, Nov 2026).
  background: "#0D0C0B",
  surface: "#171614",
  surfaceElevated: "#201E1B",
  border: "#2C2925",

  textPrimary: "#F5F2EC",
  textSecondary: "#A39D94",
  textDisabled: "#5E5A54",

  accent: "#FFC800", // Katkee amber — fills: primary CTA, Follow, Create, unread badges, my chat bubbles
  accentPressed: "#E0AF00",
  onAccent: "#0B0B0B",
  // The accent as text, icons, rings and borders. Amber in dark mode; deep gold in light mode,
  // where amber can't be read on white.
  accentText: "#FFC800",
  onAccentText: "#0B0B0B",
  // A soft wash of the accent behind accent text: chips like "Founding member" and streaks.
  accentTint: "rgba(255,200,0,0.12)",

  // Lightened from #E4483C (same hue) so red text reaches 4.5:1 on sheets and dark text on red
  // fills does too (verification/contrast.cjs). Story text/drawing colours are content and keep their red.
  danger: "#ED5246",
  onDanger: "#0B0B0B",
  success: "#3FBF7F",
  like: "#FF3040", // a liked heart: red, as people expect from a like

  overlayScrimStart: "rgba(0,0,0,0)",
  overlayScrimEnd: "rgba(0,0,0,0.65)",
};

export const lightPalette: Palette = {
  // "Daylight": a warm off-white page with white cards on it, warm near-black text.
  background: "#F6F4F0",
  surface: "#FFFFFF",
  surfaceElevated: "#EEEAE3",
  border: "#E2DDD4",

  textPrimary: "#17150F",
  textSecondary: "#6B655D",
  textDisabled: "#A39D94",

  // Buttons are filled with Katkee's own amber and black text in both modes (deep gold fills read
  // as brown); text and icons use the deep gold below.
  accent: "#FFC800",
  accentPressed: "#EDB900",
  onAccent: "#0B0B0B",
  accentText: "#8A5E00", // deep gold: Katkee's amber, dark enough to read on white
  onAccentText: "#FFFFFF",
  accentTint: "rgba(255,200,0,0.16)",

  danger: "#B71F1C",
  onDanger: "#FFFFFF",
  success: "#137333",
  like: "#E0245E", // a deeper red that holds up on white

  overlayScrimStart: "rgba(0,0,0,0)",
  overlayScrimEnd: "rgba(0,0,0,0.65)",
};

export type Palette = typeof darkPalette;
export type ColorToken = keyof Palette;
export type ColorScheme = "dark" | "light";

/**
 * The app's colours. Screens read these when their styles are created, so the scheme is chosen
 * once at launch (theme/appearance.ts) before any screen loads; changing it restarts the app.
 */
export const colors: Palette = { ...darkPalette };
let current: ColorScheme = "dark";

export function applyColorScheme(scheme: ColorScheme): void {
  current = scheme;
  Object.assign(colors, scheme === "light" ? lightPalette : darkPalette);
}

export function colorScheme(): ColorScheme {
  return current;
}

/**
 * Story, camera and editor screens: always dark, whatever the app's scheme, like Instagram. Text
 * and controls over photos and video stay readable.
 */
export const mediaColors: Palette = darkPalette;
