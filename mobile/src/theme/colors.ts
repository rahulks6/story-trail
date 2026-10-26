/**
 * Katkee's colours, dark and light. Dark is the locked master spec palette (pages 2-3); light is
 * its daytime counterpart: the same roles, with a deeper gold accent because amber is unreadable
 * as text on white (verification/contrast.cjs checks every text pair in both).
 */
export const darkPalette = {
  background: "#0B0B0B",
  surface: "#141820",
  surfaceElevated: "#1D212A",
  border: "#282C36",

  textPrimary: "#FFFFFF",
  textSecondary: "#A3A3A3",
  textDisabled: "#5A5D61",

  accent: "#FFC800", // Katkee amber — fills: primary CTA, Follow, Create, unread badges, my chat bubbles
  accentPressed: "#E0AF00",
  onAccent: "#0B0B0B",
  // The accent as text, icons, rings and borders. Amber in dark mode; deep gold in light mode,
  // where amber can't be read on white.
  accentText: "#FFC800",
  onAccentText: "#0B0B0B",

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
  background: "#FFFFFF",
  surface: "#F7F7F8",
  surfaceElevated: "#EDEDF0",
  border: "#DADCE0",

  textPrimary: "#0B0B0B",
  textSecondary: "#5C5F66",
  textDisabled: "#A0A4AB",

  // Buttons are filled with Katkee's own amber and black text in both modes (deep gold fills read
  // as brown); text and icons use the deep gold below.
  accent: "#FFC800",
  accentPressed: "#EDB900",
  onAccent: "#0B0B0B",
  accentText: "#8A5E00", // deep gold: Katkee's amber, dark enough to read on white
  onAccentText: "#FFFFFF",

  danger: "#C5221F",
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
