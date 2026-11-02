import React from "react";
import { StyleSheet, View, type LayoutChangeEvent } from "react-native";
import { isInteractive, type Overlay, type DrawStroke, type FilterName } from "../models/storyDraft";
import type { StickerInteraction } from "./InteractiveSticker";
import { FILTER_PREVIEWS } from "../models/filterPreviews";
import { OverlayBody } from "./OverlayBody";
import { DrawingStrokes } from "./DrawingStrokes";
import { PlacedOverlay } from "./PlacedOverlay";

/**
 * The read-only counterpart to the editor's live canvas: renders a
 * published Story's filter tint (only for media uploaded without its filter
 * applied, `filterApplied` false), drawing, and overlays exactly where they
 * were placed (same normalized x/y/scale/rotation, same OverlayBody used
 * while editing — spec section 47's "preview accuracy"). Not interactive
 * except a mention, which the spec requires stay tappable after publish
 * (section 30: "tapping a mention must navigate to that user's live
 * profile"), and, when `interaction` is given, the interactive stickers
 * (polls, quizzes, questions, countdowns, links, Add Yours). They sit above
 * the Story's tap layer, so a tap on one never also moves to the next Story.
 */
export function StoryOverlayLayer({
  overlays,
  drawing,
  filter,
  filterApplied = false,
  containerWidth,
  containerHeight,
  onMentionPress,
  interaction,
}: {
  overlays: Overlay[];
  drawing: DrawStroke[];
  filter: FilterName;
  /** The media's pixels already carry the filter (applied on upload): no tint on top. */
  filterApplied?: boolean;
  containerWidth: number;
  containerHeight: number;
  onMentionPress?: (username: string) => void;
  /** Interactive stickers take taps (vote, answer, remind, open a link, Add yours) when given. */
  interaction?: StickerInteraction;
}): React.JSX.Element {
  const activeFilter = filterApplied ? FILTER_PREVIEWS[0] : FILTER_PREVIEWS.find((f) => f.name === filter) ?? FILTER_PREVIEWS[0];
  const sorted = [...overlays].sort((a, b) => a.zIndex - b.zIndex);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {activeFilter.overlayOpacity > 0 ? (
        <View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { backgroundColor: activeFilter.overlayColor, opacity: activeFilter.overlayOpacity }]}
        />
      ) : null}

      {containerWidth > 0 ? <DrawingStrokes strokes={drawing} containerWidth={containerWidth} containerHeight={containerHeight} /> : null}

      {containerWidth > 0
        ? sorted.map((overlay) => (
            <PlacedOverlay
              key={overlay.id}
              overlay={overlay}
              containerWidth={containerWidth}
              containerHeight={containerHeight}
              pointerEvents={overlay.type === "mention" || (interaction && isInteractive(overlay)) ? "auto" : "none"}
            >
              <OverlayBody overlay={overlay} containerWidth={containerWidth} containerHeight={containerHeight} onMentionPress={onMentionPress} interaction={interaction} />
            </PlacedOverlay>
          ))
        : null}
    </View>
  );
}

/** Convenience for a screen that doesn't yet know its container size — call in onLayout. */
export function useContainerLayout(): [{ width: number; height: number }, (e: LayoutChangeEvent) => void] {
  const [size, setSize] = React.useState({ width: 0, height: 0 });
  const onLayout = React.useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setSize({ width, height });
  }, []);
  return [size, onLayout];
}

const styles = StyleSheet.create({
});
