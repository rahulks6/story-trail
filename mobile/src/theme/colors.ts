/** Locked master spec palette (pages 2?3). */
export const colors = {
  background: "#0B0B0B",
  surface: "#141820",
  surfaceElevated: "#1D212A",
  border: "#282C36",

  textPrimary: "#FFFFFF",
  textSecondary: "#A3A3A3",
  textDisabled: "#5A5D61",

  accent: "#FFC800", // Katkee amber — Story ring, primary CTA, Follow, Create, unread badges
  accentPressed: "#E0AF00",
  onAccent: "#0B0B0B",

  // Lightened from #E4483C (same hue) so red text reaches 4.5:1 on sheets and dark text on red
  // fills does too (verification/contrast.cjs). Story text/drawing colours are content and keep their red.
  danger: "#ED5246",
  success: "#3FBF7F",

  overlayScrimStart: "rgba(0,0,0,0)",
  overlayScrimEnd: "rgba(0,0,0,0.65)",
} as const;

export type ColorToken = keyof typeof colors;
