import { colors, mediaColors, type Palette } from "./colors";

function typographyFor(p: Palette) {
  return {
    displayLarge: { fontSize: 28, fontWeight: "700" as const, color: p.textPrimary },
    title: { fontSize: 20, fontWeight: "700" as const, color: p.textPrimary },
    body: { fontSize: 15, fontWeight: "400" as const, color: p.textPrimary },
    bodyStrong: { fontSize: 15, fontWeight: "600" as const, color: p.textPrimary },
    caption: { fontSize: 13, fontWeight: "400" as const, color: p.textSecondary },
    label: { fontSize: 13, fontWeight: "600" as const, color: p.textSecondary },
  } as const;
}

/** Text styles in the app's light or dark colours (chosen at launch, see colors.ts). */
export const typography = typographyFor(colors);
/** The same, always light-on-dark, for Story, camera and editor screens. */
export const mediaTypography = typographyFor(mediaColors);
