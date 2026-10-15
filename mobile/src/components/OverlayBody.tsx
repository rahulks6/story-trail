import React from "react";
import { Platform, StyleSheet, Text, View, type StyleProp, type TextStyle } from "react-native";
import type { Overlay, TextOverlayProperties } from "../models/storyDraft";
import { colors, radii } from "../theme";

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
      const backgroundStyle =
        properties.backgroundColor !== null
          ? { backgroundColor: "rgba(0,0,0,0.55)", paddingHorizontal: 10, paddingVertical: 4, borderRadius: radii.sm }
          : null;
      return (
        <View style={[{ maxWidth: containerWidth * TEXT_MAX_WIDTH_FRACTION }, backgroundStyle]}>
          <Text
            style={[
              styles.text,
              { color: properties.color, fontSize: properties.fontSize * containerHeight, textAlign: properties.align },
              textStyleLook(properties.style),
            ]}
          >
            {properties.text}
          </Text>
        </View>
      );
    }
    case "emoji":
      return <Text style={{ fontSize: 0.09 * containerHeight }}>{overlay.properties.emoji}</Text>;
    case "sticker":
      return <Text style={[styles.sticker, { fontSize: 0.08 * containerHeight }]}>{STICKER_GLYPHS[overlay.properties.stickerId] ?? "✦"}</Text>;
    case "mention":
      return (
        <Text
          style={styles.chip}
          onPress={overlay.properties.username && onMentionPress ? () => onMentionPress!(overlay.properties.username as string) : undefined}
        >
          @{overlay.properties.username ?? "unknown"}
        </Text>
      );
    case "location":
      return <Text style={styles.chip}>📍 {overlay.properties.label}</Text>;
    case "datetime":
      return <Text style={styles.chip}>{overlay.properties.display}</Text>;
    default:
      return <View />;
  }
}

/** How a text style looks: on the Story, and in the text tool while writing. */
export function textStyleLook(style: TextOverlayProperties["style"]): StyleProp<TextStyle> {
  switch (style) {
    case "Bold": return styles.bold;
    case "Outline": return styles.outline;
    case "Typewriter": return styles.typewriter;
    case "Classic": return styles.classic;
    case "Modern": return styles.modern;
    case "Soft": return styles.soft;
    case "Highlight": return [styles.highlight, { color: colors.background }];
    default: return null;
  }
}

const styles = StyleSheet.create({
  text: { fontWeight: "600", color: colors.textPrimary },
  // Each style has its own font, one every phone has (Android's built-in families; iOS fonts),
  // so all eight look clearly different. Android has no light or extra-bold weights for the
  // default font, so weights alone made several styles look the same.
  bold: { fontFamily: Platform.select({ ios: "AvenirNext-Heavy", default: "sans-serif-black" }), fontWeight: "normal", textTransform: "uppercase" },
  outline: { fontWeight: "800", textShadowColor: "#000", textShadowRadius: 1, textShadowOffset: { width: 2, height: 2 } },
  typewriter: { fontFamily: Platform.select({ ios: "Courier", default: "monospace" }), fontWeight: "normal" },
  classic: { fontFamily: Platform.select({ ios: "Georgia", default: "serif" }), fontWeight: "normal", fontStyle: "italic" },
  modern: { fontFamily: Platform.select({ ios: "AvenirNextCondensed-DemiBold", default: "sans-serif-condensed" }), fontWeight: "normal", textTransform: "uppercase", letterSpacing: 2 },
  soft: { fontFamily: Platform.select({ ios: "SnellRoundhand-Bold", default: "cursive" }), fontWeight: "normal" },
  highlight: { backgroundColor: colors.accent, paddingHorizontal: 6, borderRadius: radii.sm, overflow: "hidden" },
  sticker: { color: colors.accent },
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
