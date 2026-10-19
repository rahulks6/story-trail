import React, { memo, useState } from "react";
import { View, type ViewProps } from "react-native";
import type { Overlay } from "../models/storyDraft";

type Props = ViewProps & {
  overlay: Pick<Overlay, "x" | "y" | "scale" | "rotation" | "zIndex">;
  containerWidth: number;
  containerHeight: number;
  /** Slightly see-through while being dragged. */
  dimmed?: boolean;
  children: React.ReactNode;
};

/**
 * Places text or a sticker with its centre on the overlay's x/y (like Instagram), at its scale
 * and angle, the same way in the editor and the viewer. It is measured first and shown once its
 * size is known, so it never jumps. New text at (0.5, 0.5) sits in the middle of the Story.
 */
function PlacedOverlayImpl({ overlay, containerWidth, containerHeight, dimmed = false, children, style, onLayout, ...rest }: Props): React.JSX.Element {
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  return (
    <View
      {...rest}
      onLayout={(e) => {
        const { width, height } = e.nativeEvent.layout;
        if (!size || size.width !== width || size.height !== height) setSize({ width, height });
        onLayout?.(e);
      }}
      style={[
        style,
        {
          position: "absolute",
          left: overlay.x * containerWidth - (size?.width ?? 0) / 2,
          top: overlay.y * containerHeight - (size?.height ?? 0) / 2,
          zIndex: overlay.zIndex,
          opacity: size ? (dimmed ? 0.85 : 1) : 0,
          transform: [{ scale: overlay.scale }, { rotate: `${overlay.rotation}deg` }],
        },
      ]}
    >
      {children}
    </View>
  );
}

/** Memoised: redraws only when its placement, size or children change. */
export const PlacedOverlay = memo(PlacedOverlayImpl);
