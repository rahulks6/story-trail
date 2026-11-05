import React from "react";
import { StyleSheet } from "react-native";
import Svg, { Circle, Defs, LinearGradient, Stop } from "react-native-svg";

/** Katkee's Story ring: yellow into orange into pink, like the logo and the store art. */
export const STORY_RING_COLORS = ["#FFC800", "#FF8A00", "#FF3D6E"] as const;

/**
 * The ring round a photo that has a Story to watch, drawn over a box `size` wide (the photo sits
 * inside it). Decorative: the photo's own button says there's a Story.
 */
export function StoryRing({ size, width }: { size: number; width: number }): React.JSX.Element {
  const r = (size - width) / 2;
  return (
    <Svg width={size} height={size} style={StyleSheet.absoluteFill} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Defs>
        <LinearGradient id="katkeeStoryRing" x1="0" y1="1" x2="1" y2="0">
          <Stop offset="0" stopColor={STORY_RING_COLORS[0]} />
          <Stop offset="0.55" stopColor={STORY_RING_COLORS[1]} />
          <Stop offset="1" stopColor={STORY_RING_COLORS[2]} />
        </LinearGradient>
      </Defs>
      <Circle cx={size / 2} cy={size / 2} r={r} stroke="url(#katkeeStoryRing)" strokeWidth={width} fill="none" />
    </Svg>
  );
}
