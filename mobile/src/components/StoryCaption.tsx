import React, { useState } from "react";
import { ScrollView, StyleSheet, Text, useWindowDimensions, View, type StyleProp, type ViewStyle } from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { Pressable } from "./Pressable";
import { spacing } from "../theme";

/** Shown in full up to this; longer, or more lines, folds to two lines with "more". */
const FOLD_CHARS = 90;
const FOLD_LINES = 2;

export function isLongCaption(text: string): boolean {
  return text.length > FOLD_CHARS || text.split("\n").length > FOLD_LINES;
}

/**
 * A soft dark fade up from the bottom of a Story, so the caption and the comment bar read on any
 * photo (a white wall, the sky) without a hard box. Deeper while a long caption is open.
 */
export function StoryBottomScrim({ height, deep = false, style }: { height: number; deep?: boolean; style?: StyleProp<ViewStyle> }): React.JSX.Element {
  return (
    <View style={[styles.scrim, { height }, style]} pointerEvents="none" accessible={false} importantForAccessibility="no-hide-descendants">
      <Svg width="100%" height="100%">
        <Defs>
          <LinearGradient id="storyBottomScrim" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#000" stopOpacity={0} />
            <Stop offset="0.45" stopColor="#000" stopOpacity={deep ? 0.45 : 0.22} />
            <Stop offset="1" stopColor="#000" stopOpacity={deep ? 0.8 : 0.55} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#storyBottomScrim)" />
      </Svg>
    </View>
  );
}

interface Props {
  text: string;
  /** Long captions fold; the parent knows (it lets taps through to the Story otherwise). */
  expanded?: boolean;
  onToggle?: () => void;
}

/**
 * A Story's caption, like Instagram: clean white type with a gentle shadow over the scrim; a long
 * one shows two lines and "more", and opens in place (scrolling if it's taller than a third of the
 * screen).
 */
export function StoryCaption({ text, expanded = false, onToggle }: Props): React.JSX.Element {
  const { height } = useWindowDimensions();
  const long = isLongCaption(text);
  const [scrolls, setScrolls] = useState(false);
  if (!long || !onToggle) {
    return <Text style={styles.text} maxFontSizeMultiplier={1.4}>{text}</Text>;
  }
  const maxHeight = Math.round(height / 3);
  return (
    <Pressable
      onPress={onToggle}
      pressEffect="none"
      accessibilityRole="button"
      accessibilityLabel={text}
      accessibilityHint={expanded ? "Shows less of the caption" : "Shows the whole caption"}
    >
      {expanded ? (
        <ScrollView style={{ maxHeight }} scrollEnabled={scrolls} showsVerticalScrollIndicator={scrolls} onContentSizeChange={(_w, h) => setScrolls(h > maxHeight)}>
          <Text style={styles.text} maxFontSizeMultiplier={1.4}>{text}</Text>
          <Text style={styles.more} maxFontSizeMultiplier={1.4}>less</Text>
        </ScrollView>
      ) : (
        <>
          <Text style={styles.text} numberOfLines={FOLD_LINES} maxFontSizeMultiplier={1.4}>{text}</Text>
          <Text style={styles.more} maxFontSizeMultiplier={1.4}>more</Text>
        </>
      )}
    </Pressable>
  );
}

const shadow = { textShadowColor: "rgba(0,0,0,0.55)", textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4 } as const;

const styles = StyleSheet.create({
  scrim: { position: "absolute", left: 0, right: 0, bottom: 0 },
  text: { color: "#FFFFFF", fontSize: 15, lineHeight: 21, fontWeight: "500", letterSpacing: 0.1, ...shadow },
  more: { color: "rgba(255,255,255,0.72)", fontSize: 14, fontWeight: "600", marginTop: spacing.xs / 2, ...shadow },
});
