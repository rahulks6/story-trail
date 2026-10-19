import { useMediaStatusBar } from "../../hooks/useMediaStatusBar";
import { Icon } from "../../components/Icon";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, Animated, Image, Pressable, StyleSheet, Text, View } from "react-native";
import Video from "react-native-video";
import type { NativeStackScreenProps, NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { RootStackParamList } from "../../navigation/types";
import { mediaColors as colors, spacing, ICONS } from "../../theme";
import { useAuth } from "../../state/AuthContext";
import { deleteHighlight, getHighlightDetail, getHighlightItemDetail, updateHighlight, type HighlightItem } from "../../api/highlights";
import { ActionSheet } from "../../components/ActionSheet";
import { tapFeedback } from "../../utils/haptics";
import { track } from "../../analytics/analytics";
import { getMedia } from "../../api/media";
import { mediaFileUrl } from "../../api/stories";
import { MusicPlayer } from "../../components/MusicPlayer";
import { ApiError } from "../../api/client";
import { EmptyState } from "../../components/EmptyState";
import { StoryOverlayLayer, useContainerLayout } from "../../components/StoryOverlayLayer";
import { filterNameFromKey } from "../../models/filterPreviews";
import { mediaTransformStyle, DEFAULT_CROP } from "../../models/storyDraft";
import type { StoryDetail } from "../../api/engagement";
import { useScreenInsets } from "../../hooks/useScreenInsets";

type Props = NativeStackScreenProps<RootStackParamList, "HighlightViewer">;

const PHOTO_DURATION_MS = 5000;

/**
 * Sequential, view-only playback of a Highlight's items. Deliberately a
 * separate, simpler screen from StoryViewerScreen rather than a mode
 * switch on it: StoryViewerScreen's fetches (getStoryDetail, recordView,
 * like/comment/share) all go through the *normal* per-Story endpoints,
 * which enforce the 24h expiry a Highlight exists specifically to
 * outlive. Reusing it here would mean threading an expiry-bypass through
 * every one of those calls; a Highlight is about persisting visibility,
 * not full interactive parity with a live Story, so this pass keeps
 * Highlight playback intentionally read-only — no like/comment/share,
 * no view recording (the normal view-record endpoint would 404 an
 * expired Story for a non-owner the same way the old fetch did) — see
 * mobile/README.md's "Phase 9 specifically" for this tradeoff spelled out.
 */
export function HighlightViewerScreen({ route, navigation }: Props): React.JSX.Element {
  useMediaStatusBar();
  const { highlightId, title } = route.params;
  const { accessToken, user } = useAuth();
  const insets = useScreenInsets();
  const rootNavigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  const [items, setItems] = useState<HighlightItem[] | null>(null);
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [mediaKind, setMediaKind] = useState<"photo" | "video" | null>(null);
  const [videoDurationMs, setVideoDurationMs] = useState<number | null>(null);
  const [detail, setDetail] = useState<StoryDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [containerSize, onContainerLayout] = useContainerLayout();
  const progress = useRef(new Animated.Value(0)).current;
  const animationRef = useRef<Animated.CompositeAnimation | null>(null);
  const countedView = useRef(false);

  const [optionsOpen, setOptionsOpen] = useState(false);
  const currentItem = items?.[index] ?? null;
  const showingRef = useRef<string | null>(null);
  showingRef.current = currentItem?.storyId ?? null;
  const [shownTitle, setShownTitle] = useState(title);

  // Loaded on every visit, so coming back from editing shows the Highlight as it now is.
  useFocusEffect(
    useCallback(() => {
      if (!accessToken) return;
      let cancelled = false;
      getHighlightDetail(highlightId, accessToken)
        .then(({ highlight }) => {
          if (cancelled) return;
          // Keep showing the same Story if it's still there; otherwise start from the first.
          const showing = showingRef.current;
          const at = showing ? highlight.items.findIndex((item) => item.storyId === showing) : -1;
          setItems(highlight.items);
          setIndex(at >= 0 ? at : 0);
          setOwnerId(highlight.ownerId);
          setShownTitle(highlight.title);
          // Admin analytics: someone else's Highlight opened (once per visit, not per token refresh).
          if (!countedView.current && highlight.ownerId !== user?.id && highlight.items.length) {
            countedView.current = true;
            track("highlight_viewed");
          }
        })
        .catch(() => {
          if (!cancelled) setItems((previous) => previous ?? []);
        });
      return () => {
        cancelled = true;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [highlightId, accessToken]),
  );

  // Where the progress bar stopped when the options sheet opened, to carry on from there.
  const resumeFrom = useRef(0);
  useEffect(() => {
    if (optionsOpen) progress.stopAnimation((value) => { resumeFrom.current = value > 0 && value < 1 ? value : 0; });
  }, [optionsOpen, progress]);

  useEffect(() => {
    if (!currentItem || !accessToken) return;
    let cancelled = false;
    setMediaKind(null);
    setVideoDurationMs(null);
    setDetail(null);
    setError(null);
    Promise.all([
      getHighlightItemDetail(highlightId, currentItem.storyId, accessToken),
      getMedia(currentItem.mediaId, accessToken),
    ])
      .then(([{ story }, media]) => {
        if (!cancelled) {
          setDetail(story);
          setMediaKind(media.kind === "video" ? "video" : "photo");
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : "Couldn't load this Story.");
      });
    return () => {
      cancelled = true;
    };
  }, [currentItem, highlightId, accessToken]);

  const goNext = useCallback(() => {
    if (!items) return;
    if (index >= items.length - 1) {
      navigation.goBack();
      return;
    }
    setIndex((i) => i + 1);
  }, [items, index, navigation]);

  const goPrevious = useCallback(() => {
    setIndex((i) => Math.max(0, i - 1));
  }, []);

  useEffect(() => {
    if (!currentItem || mediaKind === null || optionsOpen) return;
    if (mediaKind === "video" && videoDurationMs === null) return;
    const durationMs = mediaKind === "video" ? (videoDurationMs as number) : detail?.music?.durationMs ?? PHOTO_DURATION_MS;

    const from = resumeFrom.current;
    resumeFrom.current = 0;
    progress.setValue(from);
    animationRef.current = Animated.timing(progress, { toValue: 1, duration: durationMs * (1 - from), useNativeDriver: false });
    animationRef.current.start(({ finished }) => {
      if (finished) goNext();
    });
    return () => animationRef.current?.stop();
  }, [currentItem, mediaKind, videoDurationMs, goNext, progress, detail?.music?.durationMs, optionsOpen]);

  const removeCurrent = () => {
    if (!accessToken || !items || !currentItem) return;
    const remaining = items.filter((item) => item.storyId !== currentItem.storyId).map((item) => item.storyId);
    if (remaining.length === 0) {
      confirmDelete("This is the only Story in it, so removing it deletes the Highlight. The Story stays in your Archive.");
      return;
    }
    updateHighlight(highlightId, { storyIds: remaining }, accessToken)
      .then(({ highlight }) => {
        tapFeedback("success");
        setItems(highlight.items);
        setIndex((i) => Math.min(i, highlight.items.length - 1));
      })
      .catch(() => Alert.alert("Couldn't remove", "Check your connection and try again."));
  };

  const confirmDelete = (message = "The Stories in it stay in your Archive.") => {
    Alert.alert(`Delete "${shownTitle}"?`, message, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          if (!accessToken) return;
          deleteHighlight(highlightId, accessToken)
            .then(() => {
              tapFeedback("success");
              navigation.goBack();
            })
            .catch(() => Alert.alert("Couldn't delete", "Check your connection and try again."));
        },
      },
    ]);
  };

  if (items === null) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  if (items.length === 0) {
    return <EmptyState title="Nothing here" message="This Highlight has no Stories left to show." />;
  }

  if (!currentItem) return <View style={styles.container} />;

  // Processed variants: 720p video (poster first) or the display-size photo.
  const mediaUrl = mediaFileUrl(currentItem.mediaId, mediaKind === "video" ? "video_720" : "display");
  const authHeaders = accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined;

  return (
    <View style={styles.container} onLayout={onContainerLayout}>
      {detail?.music && mediaKind !== null ? (
        <MusicPlayer key={detail.id} url={detail.music.url} accessToken={accessToken} startMs={detail.music.startMs} durationMs={detail.music.durationMs} paused={false} />
      ) : null}
      {mediaKind === "video" ? (
        <Video
          source={{ uri: mediaUrl, headers: authHeaders }}
          poster={{ source: { uri: mediaFileUrl(currentItem.mediaId, "poster"), headers: authHeaders }, resizeMode: "cover" }}
          style={[StyleSheet.absoluteFill, mediaTransformStyle(detail?.crop ?? DEFAULT_CROP, containerSize.width, containerSize.height)]}
          resizeMode="cover"
          onLoad={(meta) => setVideoDurationMs(Math.max(1000, meta.duration * 1000))}
          paused={false}
          muted={detail?.audioMuted ?? false}
        />
      ) : mediaKind === "photo" ? (
        <Image
          source={{ uri: mediaUrl, headers: authHeaders }}
          style={[StyleSheet.absoluteFill, mediaTransformStyle(detail?.crop ?? DEFAULT_CROP, containerSize.width, containerSize.height)]}
          resizeMode="cover"
        />
      ) : (
        <View style={styles.centered}>
          {error ? <Text style={styles.errorText}>{error}</Text> : <ActivityIndicator color={colors.accent} />}
        </View>
      )}

      <View style={[styles.progressRow, { top: insets.top + spacing.sm }]}>
        {items.map((item, i) => (
          <View key={item.storyId} style={styles.progressTrack}>
            <Animated.View
              style={[
                styles.progressFill,
                {
                  width:
                    i < index
                      ? "100%"
                      : i === index
                        ? progress.interpolate({ inputRange: [0, 1], outputRange: ["0%", "100%"] })
                        : "0%",
                },
              ]}
            />
          </View>
        ))}
      </View>
      <Text style={[styles.title, { top: insets.top + spacing.sm + 14 }]} numberOfLines={1}>
        {shownTitle}
      </Text>

      {ownerId === user?.id ? (
        <Pressable
          style={[styles.editButton, { top: insets.top + spacing.sm + 10 }]}
          onPress={() => setOptionsOpen(true)}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Highlight options"
        >
          <Icon style={styles.editIcon} name={ICONS.more} />
        </Pressable>
      ) : null}
      <Pressable
        style={[styles.closeButton, { top: insets.top + spacing.sm + 10 }]}
        onPress={() => navigation.goBack()}
        hitSlop={12}
        accessibilityRole="button"
        accessibilityLabel="Close"
      >
        <Icon style={styles.closeIcon} name={ICONS.close} />
      </Pressable>

      <View style={styles.tapZones}>
        <Pressable style={styles.tapZone} onPress={goPrevious} accessibilityRole="button" accessibilityLabel="Previous item" />
        <Pressable style={styles.tapZone} onPress={goNext} accessibilityRole="button" accessibilityLabel="Next item" />
      </View>

      {detail && containerSize.width > 0 ? (
        <StoryOverlayLayer
          overlays={detail.overlays}
          drawing={detail.drawing}
          filter={filterNameFromKey(detail.filter)}
          filterApplied={detail.filterApplied === true}
          containerWidth={containerSize.width}
          containerHeight={containerSize.height}
          onMentionPress={(username) =>
            rootNavigation.navigate("Main", { screen: "Search", params: { screen: "UserProfile", params: { username } } })
          }
        />
      ) : null}
      {ownerId === user?.id ? (
        <ActionSheet
          visible={optionsOpen}
          title={shownTitle}
          groups={[
            [
              { label: "Edit Highlight", onPress: () => navigation.navigate("HighlightEditor", { highlightId }) },
              { label: "Remove this Story from the Highlight", onPress: removeCurrent },
            ],
            [{ label: "Delete Highlight", destructive: true, onPress: () => confirmDelete() }],
          ]}
          onClose={() => setOptionsOpen(false)}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background },
  errorText: { color: colors.danger },
  progressRow: {
    position: "absolute",
    top: spacing.xl,
    left: spacing.sm,
    right: spacing.sm,
    flexDirection: "row",
    gap: spacing.xs,
  },
  progressTrack: {
    flex: 1,
    height: 3,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.3)",
    overflow: "hidden",
  },
  progressFill: { height: "100%", backgroundColor: "#fff" },
  title: { position: "absolute", top: spacing.xl + 14, left: spacing.md, color: "#fff", fontWeight: "700" },
  // Above the tap zones and the Story's own text, which are drawn after them.
  closeButton: { position: "absolute", top: spacing.xl + 10, right: spacing.md, padding: spacing.xs, zIndex: 10, elevation: 10 },
  closeIcon: { color: "#fff", fontSize: 20 },
  editButton: { position: "absolute", top: spacing.xl + 10, right: spacing.xxl + spacing.sm, padding: spacing.xs, zIndex: 10, elevation: 10 },
  editIcon: { color: "#fff", fontSize: 20 },
  tapZones: { ...StyleSheet.absoluteFill, flexDirection: "row" },
  tapZone: { flex: 1 },
});
