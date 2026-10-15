import React, { memo } from "react";
import { StyleSheet } from "react-native";
import Svg, { Path } from "react-native-svg";
import type { DrawStroke } from "../models/storyDraft";
import { strokePath } from "../models/canvasGestures";

/** How each tool draws, on top of the stroke's own width (normalized to the container width). */
export function strokeLook(stroke: DrawStroke, containerWidth: number): { thickness: number; opacity: number } {
  const widthMultiplier = stroke.tool === "highlighter" ? 3 : stroke.tool === "marker" ? 1.8 : 1;
  return {
    thickness: Math.max(1, stroke.width * containerWidth * widthMultiplier),
    opacity: stroke.tool === "highlighter" ? 0.4 : 1,
  };
}

/**
 * Freehand drawing strokes, one smooth SVG path each with round ends and joins. Shared between the
 * editor's canvas and the Story viewer, so a drawing appears exactly where it was drawn (every
 * point is normalized 0..1 to the media container, like overlay x/y).
 */
export const DrawingStrokes = memo(function DrawingStrokes({
  strokes,
  containerWidth,
  containerHeight,
}: {
  strokes: DrawStroke[];
  containerWidth: number;
  containerHeight: number;
}): React.JSX.Element {
  return (
    <Svg style={StyleSheet.absoluteFill} width={containerWidth} height={containerHeight} pointerEvents="none">
      {strokes.map((stroke) => {
        const { thickness, opacity } = strokeLook(stroke, containerWidth);
        return (
          <Path
            key={stroke.id}
            d={strokePath(stroke.points, containerWidth, containerHeight)}
            stroke={stroke.color}
            strokeOpacity={opacity}
            strokeWidth={thickness}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        );
      })}
    </Svg>
  );
});
