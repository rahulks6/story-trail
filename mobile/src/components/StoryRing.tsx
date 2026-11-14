import React from "react";
import { StyleSheet } from "react-native";
import Svg, { Rect } from "react-native-svg";
import { squircleRadius } from "./Avatar";

/** Katkee's Story ring: one warm amber, round-cornered like the photos (the Postcard look). */
export const STORY_RING_COLOR = "#F2B200";

/**
 * The ring round a photo that has a Story to watch, drawn over a box `size` wide (the photo sits
 * inside it). Decorative: the photo's own button says there's a Story.
 */
export function StoryRing({ size, width }: { size: number; width: number }): React.JSX.Element {
  const inset = width / 2;
  return (
    <Svg width={size} height={size} style={StyleSheet.absoluteFill} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Rect x={inset} y={inset} width={size - width} height={size - width} rx={squircleRadius(size) - inset} stroke={STORY_RING_COLOR} strokeWidth={width} fill="none" />
    </Svg>
  );
}
