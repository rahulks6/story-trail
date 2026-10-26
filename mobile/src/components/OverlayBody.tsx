import React from "react";
import { StyleSheet, Text, View } from "react-native";
import type { Overlay } from "../models/storyDraft";
import { contrastOn, neonCore, neonRadius, textStyleLook, tightTextFits } from "./textLook";
import { mediaColors as colors, radii } from "../theme";

export /** Text wraps within this fraction of the container's own width (spec: "auto-wrap ... text") rather than growing indefinitely off-canvas. */
const TEXT_MAX_WIDTH_FRACTION = 0.8;

export const STICKER_GLYPHS: Record<string, string> = {
  spark: "✦",
  "heart-line": "♡",
  "star-outline": "☆",
  wave: "〰",
  flame: "🔥",
  confetti: "✺",
  ring: "◯",
  bolt: "⚡",
};

/**
 * Renders exactly one overlay's visual body — used by both
 * DraggableCanvasObject (editable, in the editor) and StoryOverlayLayer
 * (read-only, at view time), so what the editor shows is what actually
 * publishes (spec section 47: "preview accuracy"). Font sizes are
 * expressed relative to `containerHeight`/`containerWidth` because the
 * overlay's own `properties.fontSize` (text) is itself normalized —
 * see storyDraft.ts.
 */
// Story text and stickers are drawn at a size relative to the photo, so they look the same for
// every viewer: the phone's text-size setting never resizes them (allowFontScaling={false}).
export function OverlayBody({
  overlay,
  containerWidth,
  containerHeight,
  onMentionPress,
}: {
  overlay: Overlay;
  containerWidth: number;
  containerHeight: number;
  onMentionPress?: (username: string) => void;
}): React.JSX.Element {
  switch (overlay.type) {
    case "text": {
      const { properties } = overlay;
      const fontSize = properties.fontSize * containerHeight;
      // Neon (stored as "Highlight") glows only without a label; on a label it is plain text.
      const neon = properties.style === "Highlight" && properties.backgroundColor === null;
      const glow = neonRadius(fontSize);
      const textStyle = [
        styles.text,
        { color: neon ? neonCore(properties.color) : properties.color, fontSize, textAlign: properties.align, includeFontPadding: !tightTextFits(properties.text) },
        textStyleLook(properties.style, properties.color, fontSize),
        // Room for the glow, which Android cuts off at the text's edges.
        neon && { padding: glow },
        properties.style === "Highlight" && !neon && { textShadowRadius: 0 },
      ];
      // A background is a solid label in the chosen colour (Instagram's "A" box).
      const backgroundStyle = properties.backgroundColor !== null
        ? { backgroundColor: properties.backgroundColor, paddingHorizontal: fontSize * 0.35, paddingVertical: fontSize * 0.12, borderRadius: fontSize * 0.3 }
        : null;
      // Android can't stroke text, so Outline is drawn as the text in the outline colour behind
      // it, nudged in eight directions.
      const outline = properties.style === "Outline" && properties.backgroundColor === null;
      const w = Math.max(1.5, fontSize * 0.07);
      return (
        <View style={[{ maxWidth: containerWidth * TEXT_MAX_WIDTH_FRACTION + (neon ? glow * 2 : 0) }, backgroundStyle]}>
          {outline
            ? OUTLINE_OFFSETS.map(([dx, dy], i) => (
                <Text allowFontScaling={false} key={i} style={[...textStyle, styles.outlineCopy, { color: contrastOn(properties.color), textShadowRadius: 0, transform: [{ translateX: dx * w }, { translateY: dy * w }] }]} accessible={false} importantForAccessibility="no">
                  {properties.text}
                </Text>
              ))
            : null}
          {/* A second, wider glow behind the text, so the colour reads on any photo. */}
          {neon ? (
            <Text allowFontScaling={false} style={[...textStyle, styles.outlineCopy, { color: properties.color }]} accessible={false} importantForAccessibility="no">
              {properties.text}
            </Text>
          ) : null}
          <Text allowFontScaling={false} style={[...textStyle, outline && { textShadowRadius: 0 }, neon && { textShadowRadius: glow * 0.5 }]}>{properties.text}</Text>
        </View>
      );
    }
    case "emoji":
      return <Text allowFontScaling={false} style={{ fontSize: 0.09 * containerHeight }}>{overlay.properties.emoji}</Text>;
    case "sticker":
      return <Text allowFontScaling={false} style={[styles.sticker, { fontSize: 0.08 * containerHeight }]}>{STICKER_GLYPHS[overlay.properties.stickerId] ?? "✦"}</Text>;
    case "mention":
      return (
        <Text
          allowFontScaling={false}
          style={styles.chip}
          onPress={overlay.properties.username && onMentionPress ? () => onMentionPress!(overlay.properties.username as string) : undefined}
        >
          @{overlay.properties.username ?? "unknown"}
        </Text>
      );
    case "location":
      return <Text allowFontScaling={false} style={styles.chip}>📍 {overlay.properties.label}</Text>;
    case "datetime":
      return <Text allowFontScaling={false} style={styles.chip}>{overlay.properties.display}</Text>;
    default:
      return <View />;
  }
}

export { textStyleLook };

const OUTLINE_OFFSETS: Array<[number, number]> = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];

const styles = StyleSheet.create({
  text: { fontWeight: "600", color: colors.textPrimary },
  outlineCopy: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0 },
  sticker: { color: colors.accentText },
  chip: {
    color: colors.onAccent,
    backgroundColor: colors.accent,
    fontWeight: "700",
    fontSize: 14,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radii.pill,
    overflow: "hidden",
  },
});
