import React, { forwardRef } from "react";
import { Image, StyleSheet, Text, View, type ImageSourcePropType } from "react-native";
import Svg, { Path } from "react-native-svg";
import type { DrawStroke, FilterName, Overlay, StoryCrop } from "../models/storyDraft";
import { mediaTransformStyle } from "../models/storyDraft";
import { StoryOverlayLayer } from "./StoryOverlayLayer";
import { BRAND_MARK } from "./brandMarkPaths";

/** What a ref to the card holds (a host View), for react-native-view-shot's captureRef. */
export type ShareCardHandle = React.ComponentRef<typeof View>;

/** The card is drawn at 9:16, this many points wide, and saved at 1080 × 1920 (720 × 1280 for video). */
export const SHARE_CARD_WIDTH = 360;
export const SHARE_CARD_HEIGHT = 640;

export interface ShareCardStory {
  kind: "photo" | "video";
  /** The photo (or, unused for video, the poster frame). */
  imageSource: ImageSourcePropType | null;
  crop: StoryCrop;
  overlays: Overlay[];
  drawing: DrawStroke[];
  filter: FilterName;
  filterApplied: boolean;
}

interface Props {
  story: ShareCardStory;
  username: string;
  /** "photo": the picture with everything on it. "overlay": only what goes on top of a video, transparent. */
  mode: "photo" | "overlay";
  onImageLoad?: () => void;
  onImageError?: () => void;
}

/**
 * Your Story as it goes to another app: the photo (or nothing, for a video's layer), its text,
 * stickers, drawing and filter exactly as StoryOverlayLayer shows them, and a small Katkee mark
 * with your username and katkee.com link in the bottom corner, on a soft scrim so it reads on
 * any picture. Captured with react-native-view-shot; never shown on screen as it is.
 */
export const StoryShareCard = forwardRef<ShareCardHandle, Props>(function StoryShareCard({ story, username, mode, onImageLoad, onImageError }, ref) {
  return (
    <View ref={ref} collapsable={false} style={[styles.card, mode === "photo" ? styles.photoCard : null]} pointerEvents="none">
      {mode === "photo" && story.imageSource ? (
        <Image
          testID="share-card-image"
          source={story.imageSource}
          style={[StyleSheet.absoluteFill, mediaTransformStyle(story.crop, SHARE_CARD_WIDTH, SHARE_CARD_HEIGHT)]}
          resizeMode="cover"
          onLoad={onImageLoad}
          onError={onImageError}
          accessibilityIgnoresInvertColors
        />
      ) : null}
      <StoryOverlayLayer
        overlays={story.overlays}
        drawing={story.drawing}
        filter={story.filter}
        filterApplied={story.filterApplied}
        containerWidth={SHARE_CARD_WIDTH}
        containerHeight={SHARE_CARD_HEIGHT}
      />
      <ShareWatermark username={username} />
    </View>
  );
});

/** Mark, wordmark, @username and katkee.com/u/<username>: small, bottom right. */
export function ShareWatermark({ username }: { username: string }): React.JSX.Element {
  const markHeight = 15;
  return (
    <View style={styles.watermark} testID="share-watermark">
      <View style={styles.brandRow}>
        <Svg width={(markHeight * BRAND_MARK.width) / BRAND_MARK.height} height={markHeight} viewBox={BRAND_MARK.viewBox}>
          <Path d={BRAND_MARK.k} fill="#FFFFFF" fillRule="evenodd" />
          <Path d={BRAND_MARK.dot} fill={BRAND_MARK.dotColor} />
        </Svg>
        <Text style={styles.wordmark} allowFontScaling={false}>
          Kat<Text style={styles.wordmarkAccent}>kee</Text>
        </Text>
      </View>
      <Text style={styles.username} numberOfLines={1} allowFontScaling={false}>@{username}</Text>
      <Text style={styles.link} numberOfLines={1} allowFontScaling={false}>katkee.com/u/{username}</Text>
    </View>
  );
}

const shadow = { textShadowColor: "rgba(0,0,0,0.55)", textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3 };

const styles = StyleSheet.create({
  card: { width: SHARE_CARD_WIDTH, height: SHARE_CARD_HEIGHT, overflow: "hidden", backgroundColor: "transparent" },
  photoCard: { backgroundColor: "#000000" },
  watermark: {
    position: "absolute",
    right: 12,
    bottom: 14,
    maxWidth: SHARE_CARD_WIDTH * 0.6,
    alignItems: "flex-end",
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: "rgba(0,0,0,0.28)",
  },
  brandRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  wordmark: { color: "#FFFFFF", fontSize: 13, fontWeight: "700", ...shadow },
  wordmarkAccent: { color: "#FFC800" },
  username: { color: "#FFFFFF", fontSize: 11, fontWeight: "600", marginTop: 1, ...shadow },
  link: { color: "rgba(255,255,255,0.85)", fontSize: 9, ...shadow },
});
