import React, { useState } from "react";
import { StyleSheet, Text, View, type StyleProp, type TextLayoutEvent, type TextStyle } from "react-native";
import type { TextOverlayProperties } from "../models/storyDraft";

/**
 * How text on a Story is set off from the photo (the text tool's "A" button cycles through them):
 * - plain: just the text;
 * - label: one rounded box behind the whole text, in the chosen colour (stored as backgroundColor);
 * - marker: a highlighter behind each line, hugging the words (backgroundColor + effect "marker";
 *   an app from before markers shows it as a label);
 * - border: an outline around every letter, black or white against the text's colour (effect
 *   "outline"; the "Outline" font style draws the same border, as it always has).
 */
export type TextLook = "plain" | "label" | "marker" | "border";
export const TEXT_LOOKS: TextLook[] = ["plain", "label", "marker", "border"];

export function textLookOf(p: Pick<TextOverlayProperties, "backgroundColor" | "effect" | "style">): TextLook {
  if (p.backgroundColor !== null) return p.effect === "marker" ? "marker" : "label";
  return p.effect === "outline" || p.style === "Outline" ? "border" : "plain";
}

/** The stored properties for a look in a colour: on a label or marker the colour is the background's. */
export function lookProperties(look: TextLook, color: string): Pick<TextOverlayProperties, "backgroundColor" | "effect"> {
  switch (look) {
    case "label": return { backgroundColor: color, effect: undefined };
    case "marker": return { backgroundColor: color, effect: "marker" };
    case "border": return { backgroundColor: null, effect: "outline" };
    default: return { backgroundColor: null, effect: undefined };
  }
}

/** The label's box around the text, for a font size in points. */
export const labelBox = (fontSize: number) => ({ paddingHorizontal: fontSize * 0.35, paddingVertical: fontSize * 0.12, borderRadius: fontSize * 0.3 });
/** The marker's room either side of each line (the outer box leaves this much space for it). */
export const markerPad = (fontSize: number) => ({ x: fontSize * 0.28, y: fontSize * 0.04 });
export const outlineWidth = (fontSize: number) => Math.max(1.5, fontSize * 0.07);

// Android can't stroke text, so a border is the text in the border colour behind it, nudged in
// eight directions (sixteen for big text, so the corners stay round).
const OFFSETS_8: [number, number][] = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];
const OFFSETS_16: [number, number][] = Array.from({ length: 16 }, (_, i) => [Math.cos((i / 16) * Math.PI * 2), Math.sin((i / 16) * Math.PI * 2)]);

/**
 * The border, drawn behind text laid out by `textStyle` in the same box: put it just before the
 * Text (or TextInput) it outlines, in a parent that both share.
 */
export function BorderCopies({ text, textStyle, borderColor, fontSize }: { text: string; textStyle: StyleProp<TextStyle>; borderColor: string; fontSize: number }): React.JSX.Element {
  const w = outlineWidth(fontSize);
  const offsets = fontSize >= 40 ? OFFSETS_16 : OFFSETS_8;
  return (
    <>
      {offsets.map(([dx, dy], i) => (
        <Text
          allowFontScaling={false}
          key={i}
          testID="text-border"
          style={[textStyle, styles.copy, { color: borderColor, textShadowRadius: 0, transform: [{ translateX: dx * w }, { translateY: dy * w }] }]}
          accessible={false}
          importantForAccessibility="no"
        >
          {text}
        </Text>
      ))}
    </>
  );
}

interface Line { x: number; y: number; width: number; height: number }

/**
 * The highlighter: a rounded block behind each line of the text, measured from an invisible copy
 * laid out exactly like the visible text (onTextLayout). Same placement rule as BorderCopies.
 */
export function MarkerLines({ text, textStyle, color, fontSize }: { text: string; textStyle: StyleProp<TextStyle>; color: string; fontSize: number }): React.JSX.Element {
  const [lines, setLines] = useState<{ text: string; lines: Line[] }>({ text: "", lines: [] });
  const pad = markerPad(fontSize);
  const radius = fontSize * 0.22;
  const onLayout = (e: TextLayoutEvent) => {
    const measured = e.nativeEvent.lines
      // A line of only spaces (after a typed space at the end) gets no block.
      .filter((l) => l.text.trim().length > 0 && l.width > 0)
      .map((l) => ({ x: l.x, y: l.y, width: l.width, height: l.height }));
    setLines({ text, lines: measured });
  };
  return (
    <>
      <Text allowFontScaling={false} style={[textStyle, styles.copy, styles.invisible]} onTextLayout={onLayout} accessible={false} importantForAccessibility="no">
        {text}
      </Text>
      {lines.text === text
        ? lines.lines.map((l, i) => (
            <View
              key={i}
              testID="text-marker"
              pointerEvents="none"
              style={[styles.copy, { left: l.x - pad.x, top: l.y - pad.y, width: l.width + pad.x * 2, height: l.height + pad.y * 2, right: undefined, bottom: undefined, borderRadius: radius, backgroundColor: color }]}
            />
          ))
        : null}
    </>
  );
}

const styles = StyleSheet.create({
  copy: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0 },
  invisible: { color: "transparent", textShadowRadius: 0 },
});
