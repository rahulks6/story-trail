import { useMediaStatusBar } from "../../hooks/useMediaStatusBar";
import { AddToHighlightSheet } from "../../components/AddToHighlightSheet";
import { Icon } from "../../components/Icon";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Animated, Image, StyleSheet, Text, View } from "react-native";
import { Pressable } from "../../components/Pressable";
import Video from "react-native-video";
import type { NativeStackScreenProps, NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useIsFocused, useNavigation } from "@react-navigation/native";
import { useAppForeground } from "../../hooks/useAppForeground";
import type { RootStackParamList } from "../../navigation/types";
import { mediaColors as colors, radii, spacing, ICONS } from "../../theme";
import { useAuth } from "../../state/AuthContext";
import { getStoryDetail, type StoryDetail } from "../../api/engagement";
import { getMedia } from "../../api/media";
import { mediaFileUrl } from "../../api/stories";
import { ApiError } from "../../api/client";
import { StoryOverlayLayer, useContainerLayout } from "../../components/StoryOverlayLayer";
import { filterNameFromKey } from "../../models/filterPreviews";
import { mediaTransformStyle } from "../../models/storyDraft";
import { useScreenInsets } from "../../hooks/useScreenInsets";

type Props = NativeStackScreenProps<RootStackParamList, "ArchivedStoryViewer">;

const PHOTO_DURATION_MS = 5000;

/**
 * Single, view-only playback of one of your own Archive Stories, active
 * or long expired — the gap StoryFeed.tsx's own doc comment flags:
 * that pipeline only ever fetches a creator's *active* Stories
 * (getMyActiveStories/getUserActiveStories), so it can't play back
 * something Archive shows that's since expired. This works for exactly
 * that case because getStoryDetail/media access both already let an
 * owner reach their own content regardless of expiry (see
 * stories.service.ts's checkStoryAccess and media.routes.ts's
 * requireAccessibleMedia) — no backend change needed, only this screen.
 * Deliberately as simple as HighlightViewerScreen.tsx: no like/comment,
 * no next/previous (Archive's own grid is the "next", one tap away).
 */
export function ArchivedStoryViewerScreen({ route, navigation }: Props): React.JSX.Element {
  useMediaStatusBar();
  const { storyId } = route.params;
  const { accessToken } = useAuth();
  const insets = useScreenInsets();
  const rootNavigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  const [detail, setDetail] = useState<StoryDetail | null>(null);
  const [mediaKind, setMediaKind] = useState<"photo" | "video" | null>(null);
  const [videoDurationMs, setVideoDurationMs] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [added, setAdded] = useState<string | null>(null);
  const [containerSize, onContainerLayout] = useContainerLayout();
  const progress = useRef(new Animated.Value(0)).current;
  const animationRef = useRef<Animated.CompositeAnimation | null>(null);
  // Where the bar had got to when playback paused (0-1), to carry on from there.
  const resumeFrom = useRef(0);
  const [attempt, setAttempt] = useState(0);
  // Plays only while on screen, in the foreground, and not while choosing a Highlight.
  const focused = useIsFocused();
  const foreground = useAppForeground();
  const active = focused && foreground && !addOpen;

  useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;
    (async () => {
      try {
        const { story } = await getStoryDetail(storyId, accessToken);
        const media = await getMedia(story.mediaId, accessToken);
        if (cancelled) return;
        setDetail(story);
        setMediaKind(media.kind === "video" ? "video" : "photo");
      } catch (err) {
        if (!cancelled) setError(err instanceof ApiError ? err.message : "Couldn't load this Story.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [storyId, accessToken, attempt]);

  const close = useCallback(() => navigation.goBack(), [navigation]);

  useEffect(() => {
    if (!detail || mediaKind === null) return;
    if (mediaKind === "video" && videoDurationMs === null) return;
    const from = resumeFrom.current;
    progress.setValue(from);
    if (!active) return;
    const durationMs = mediaKind === "video" ? (videoDurationMs as number) : PHOTO_DURATION_MS;
    const startedAt = Date.now();
    let done = false;
    const animation = Animated.timing(progress, { toValue: 1, duration: durationMs * (1 - from), useNativeDriver: true });
    animationRef.current = animation;
    animation.start(({ finished }) => {
      if (!finished) return;
      done = true;
      close();
    });
    return () => {
      animation.stop();
      // The bar runs on the native side: how far it got comes from the time it ran.
      if (!done) resumeFrom.current = Math.min(1, from + (Date.now() - startedAt) / durationMs);
    };
  }, [detail, mediaKind, videoDurationMs, progress, close, active]);

  // Fetch the Story and its media again, from the start.
  const retry = () => {
    resumeFrom.current = 0;
    setError(null);
    setDetail(null);
    setMediaKind(null);
    setVideoDurationMs(null);
    setAttempt((n) => n + 1);
  };

  if (error) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>{error}</Text>
        <Pressable style={styles.retryButton} onPress={retry} accessibilityRole="button">
          <Text style={styles.retryLabel}>Try again</Text>
        </Pressable>
        <Pressable style={[styles.closeButton, { top: insets.top + spacing.sm + 10 }]} onPress={close} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close">
          <Icon style={styles.closeIcon} name={ICONS.close} />
        </Pressable>
      </View>
    );
  }

  if (!detail) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.accentText} />
        <Pressable style={[styles.closeButton, { top: insets.top + spacing.sm + 10 }]} onPress={close} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close">
          <Icon style={styles.closeIcon} name={ICONS.close} />
        </Pressable>
      </View>
    );
  }

  // Processed variants: 720p video (poster first) or the display-size photo.
  const mediaUrl = mediaFileUrl(detail.mediaId, mediaKind === "video" ? "video_720" : "display");
  const authHeaders = accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined;

  return (
    <View style={styles.container} onLayout={onContainerLayout}>
      {mediaKind === "video" ? (
        <Video
          key={attempt}
          source={{ uri: mediaUrl, headers: authHeaders }}
          poster={{ source: { uri: mediaFileUrl(detail.mediaId, "poster"), headers: authHeaders }, resizeMode: "cover" }}
          style={[StyleSheet.absoluteFill, mediaTransformStyle(detail.crop, containerSize.width, containerSize.height)]}
          resizeMode="cover"
          onLoad={(meta) => setVideoDurationMs(Math.max(1000, meta.duration * 1000))}
          paused={!active}
          muted={detail.audioMuted}
          onError={() => setError("Couldn't play this Story.")}
        />
      ) : mediaKind === "photo" ? (
        <Image
          key={attempt}
          onError={() => setError("Couldn't load this photo.")}
          source={{ uri: mediaUrl, headers: authHeaders }}
          style={[StyleSheet.absoluteFill, mediaTransformStyle(detail.crop, containerSize.width, containerSize.height)]}
          resizeMode="cover"
        />
      ) : (
        <ActivityIndicator color={colors.accentText} style={styles.loadingSpinner} />
      )}

      {containerSize.width > 0 ? (
        <StoryOverlayLayer
          overlays={detail.overlays}
          drawing={detail.drawing}
          filter={filterNameFromKey(detail.filter)}
          filterApplied={detail.filterApplied === true}
          containerWidth={containerSize.width}
          containerHeight={containerSize.height}
          onMentionPress={(username) =>
            rootNavigation.navigate("Main", { screen: "Search", params: { screen: "UserProfile", initial: false, params: { username } } })
          }
        />
      ) : null}

      <View style={[styles.progressTrack, { top: insets.top + spacing.sm }]}>
        <Animated.View
          // Scaled from the left on the native side, not a width laid out every frame.
          style={[styles.progressFill, { transform: [{ scaleX: progress }] }]}
        />
      </View>

      {detail.caption ? <Text style={[styles.caption, { bottom: spacing.xl * 3 + insets.bottom }]}>{detail.caption}</Text> : null}

      <Pressable
        onPress={() => {
          // Stay on this Story while choosing (playback pauses while the sheet is open).
          setAddOpen(true);
        }}
        style={[styles.addButton, { bottom: spacing.md + insets.bottom }]}
        accessibilityRole="button"
        accessibilityLabel="Add to Highlight"
      >
        <Icon name={added ? ICONS.check : ICONS.add} size={18} color={colors.onAccent} />
        <Text style={styles.addLabel}>{added ? `Added to ${added}` : "Add to Highlight"}</Text>
      </Pressable>
      <AddToHighlightSheet visible={addOpen} storyIds={[storyId]} onClose={() => setAddOpen(false)} onAdded={setAdded} />

      <Pressable style={[styles.closeButton, { top: insets.top + spacing.sm + 10 }]} onPress={close} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close">
        <Icon style={styles.closeIcon} name={ICONS.close} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background, gap: spacing.md },
  errorText: { color: colors.danger },
  loadingSpinner: { position: "absolute", top: "50%", left: "50%", marginLeft: -10, marginTop: -10 },
  progressTrack: {
    position: "absolute",
    top: spacing.xl,
    left: spacing.sm,
    right: spacing.sm,
    height: 3,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.3)",
    overflow: "hidden",
  },
  progressFill: { height: "100%", width: "100%", backgroundColor: "#fff", transformOrigin: "left" },
  retryButton: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radii.pill, borderWidth: 1, borderColor: "#fff" },
  retryLabel: { color: "#fff", fontWeight: "700" },
  addButton: { position: "absolute", alignSelf: "center", flexDirection: "row", alignItems: "center", gap: spacing.xs, backgroundColor: colors.accent, borderRadius: radii.pill, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  addLabel: { color: colors.onAccent, fontWeight: "700" },
  caption: {
    position: "absolute",
    bottom: spacing.xl,
    left: spacing.md,
    right: spacing.xxl * 2,
    color: "#fff",
  },
  closeButton: { position: "absolute", top: spacing.xl + 10, right: spacing.md, padding: spacing.xs },
  closeIcon: { color: "#fff", fontSize: 20 },
});
