import React from "react";
import { StyleSheet, Text, View } from "react-native";
import type { Overlay, TextOverlayProperties } from "../models/storyDraft";
import { contrastOn, neonCore, neonRadius, textStyleLook, tightTextFits } from "./textLook";
import { mediaColors as colors, radii } from "../theme";
import { InteractiveSticker, type StickerInteraction } from "./InteractiveSticker";
import { BorderCopies, labelBox, MarkerLines, markerPad, outlineWidth, SOFT_ALPHA, textLookOf, withAlpha } from "./TextDecorations";
import { AnimatedTextBox, useTypedText } from "./TextAnimation";
import { t } from "../i18n";

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
  interaction,
}: {
  overlay: Overlay;
  containerWidth: number;
  containerHeight: number;
  onMentionPress?: (username: string) => void;
  /** While watching: polls, quizzes, questions, countdowns, links, songs and Add Yours take taps. */
  interaction?: StickerInteraction;
}): React.JSX.Element {
  switch (overlay.type) {
    case "poll":
    case "quiz":
    case "question":
    case "countdown":
    case "link":
    case "addYours":
    case "song":
      return <InteractiveSticker overlay={overlay} containerWidth={containerWidth} interaction={interaction} />;
    case "text":
      return <StoryTextOverlay properties={overlay.properties} containerWidth={containerWidth} containerHeight={containerHeight} />;
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
          @{overlay.properties.username ?? t("common.unknown")}
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



/** Text on a Story: its font, look (label, see-through, marker, border) and animation. */
function StoryTextOverlay({ properties, containerWidth, containerHeight }: { properties: TextOverlayProperties; containerWidth: number; containerHeight: number }): React.JSX.Element {
  const fontSize = properties.fontSize * containerHeight;
  const look = textLookOf(properties);
  // Typed out letter by letter for the typewriter animation; the whole text otherwise.
  const shown = useTypedText(properties.text, properties.animation);
  // Neon (stored as "Highlight") glows only on plain text; on a label, marker or border it's plain.
  const neon = properties.style === "Highlight" && look === "plain";
  const glow = neonRadius(fontSize);
  const textStyle = [
    styles.text,
    { color: neon ? neonCore(properties.color) : properties.color, fontSize, textAlign: properties.align, includeFontPadding: !tightTextFits(properties.text) },
    textStyleLook(properties.style, properties.color, fontSize),
    // Room for the glow, which Android cuts off at the text's edges.
    neon && { padding: glow },
    properties.style === "Highlight" && !neon && { textShadowRadius: 0 },
    look === "border" && { textShadowRadius: 0 },
  ];
  const pad = markerPad(fontSize);
  const box = (look === "label" || look === "soft") && properties.backgroundColor !== null
    ? { backgroundColor: look === "soft" ? withAlpha(properties.backgroundColor, SOFT_ALPHA) : properties.backgroundColor, ...labelBox(fontSize) }
    // Room for the marker's ends and the border, so they never touch the box's edge.
    : look === "marker" ? { paddingHorizontal: pad.x, paddingVertical: pad.y }
    : look === "border" ? { padding: outlineWidth(fontSize) }
    : null;
  return (
    <AnimatedTextBox animation={properties.animation} style={[{ maxWidth: containerWidth * TEXT_MAX_WIDTH_FRACTION + (neon ? glow * 2 : 0) }, box]}>
      <View>
        {look === "border" && shown ? <BorderCopies text={shown} textStyle={textStyle} borderColor={contrastOn(properties.color)} fontSize={fontSize} /> : null}
        {look === "marker" && properties.backgroundColor !== null && shown ? <MarkerLines text={shown} textStyle={textStyle} color={properties.backgroundColor} fontSize={fontSize} /> : null}
        {/* A second, wider glow behind the text, so the colour reads on any photo. */}
        {neon ? (
          <Text allowFontScaling={false} style={[...textStyle, styles.outlineCopy, { color: properties.color }]} accessible={false} importantForAccessibility="no">
            {shown}
          </Text>
        ) : null}
        {/* Screen readers get the whole text at once, not each letter as it's typed. */}
        <Text allowFontScaling={false} style={[...textStyle, neon && { textShadowRadius: glow * 0.5 }]} accessibilityLabel={properties.text}>{shown}</Text>
      </View>
    </AnimatedTextBox>
  );
}

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
