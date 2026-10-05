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

  danger: "#E4483C",
  success: "#3FBF7F",

  overlayScrimStart: "rgba(0,0,0,0)",
  overlayScrimEnd: "rgba(0,0,0,0.65)",
} as const;

export type ColorToken = keyof typeof colors;
