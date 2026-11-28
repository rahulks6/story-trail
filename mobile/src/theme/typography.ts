import { Platform } from "react-native";
import { colors, mediaColors, type Palette } from "./colors";

/**
 * The italic serif for headings (screen titles, names on profiles, section titles): Playfair
 * Display on Android (bundled, also a Story text style), Georgia on iPhone.
 */
export const SERIF = Platform.select({ ios: "Georgia-BoldItalic", default: "PlayfairDisplay-BoldItalic" });

function typographyFor(p: Palette) {
  return {
    // Large bold headings read better a touch tighter.
    displayLarge: { fontSize: 28, fontWeight: "700" as const, letterSpacing: -0.4, color: p.textPrimary },
    // Elegant headings: a screen's title, a person's name on their profile, a section title.
    display: { fontFamily: SERIF, fontSize: 28, letterSpacing: -0.2, color: p.textPrimary },
    section: { fontFamily: SERIF, fontSize: 20, color: p.textPrimary },
    title: { fontSize: 20, fontWeight: "700" as const, letterSpacing: -0.2, color: p.textPrimary },
    body: { fontSize: 15, fontWeight: "400" as const, color: p.textPrimary },
    bodyStrong: { fontSize: 15, fontWeight: "600" as const, color: p.textPrimary },
    caption: { fontSize: 13, fontWeight: "400" as const, color: p.textSecondary },
    label: { fontSize: 13, fontWeight: "600" as const, color: p.textSecondary },
  } as const;
}

/** Stack header titles (navigation screenOptions): the serif, a little smaller than a page title. */
export const HEADER_TITLE = { fontFamily: SERIF, fontSize: 21 } as const;

/** Text styles in the app's light or dark colours (chosen at launch, see colors.ts). */
export const typography = typographyFor(colors);
/** The same, always light-on-dark, for Story, camera and editor screens. */
export const mediaTypography = typographyFor(mediaColors);
