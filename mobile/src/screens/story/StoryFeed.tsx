import { Icon } from "../../components/Icon";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Animated, AppState, Dimensions, Image, PanResponder, Pressable, StyleSheet, Text, Vibration, View } from "react-native";
import { useIsFocused } from "@react-navigation/native";
import Video, {type VideoRef} from "react-native-video";
import { colors, radii, spacing, typography, ICONS } from "../../theme";
import { useAuth } from "../../state/AuthContext";
import { getMyActiveStories, getUserActiveStories, getViewCount, mediaFileUrl, recordStoryView, type PublicStory } from "../../api/stories";
import { getMedia, mediaSource } from "../../api/media";
import { getStoryDetail, likeStory, unlikeStory, type StoryDetail } from "../../api/engagement";
import { recordEvent } from "../../api/events";
import { EmptyState } from "../../components/EmptyState";
import { CommentsSheet } from "../../components/CommentsSheet";
import { ShareSheet } from "../../components/ShareSheet";
import { StoryMoreMenu } from "../../components/StoryMoreMenu";
import { StoryInsightsSheet } from "../../components/StoryInsightsSheet";
import { StoryOverlayLayer, useContainerLayout } from "../../components/StoryOverlayLayer";
import { filterNameFromKey } from "../../models/filterPreviews";
import { mediaTransformStyle } from "../../models/storyDraft";
import { useReducedMotion } from "../../hooks/useReducedMotion";
import { SponsoredStory } from "../ads/SponsoredStory";
import { useScreenInsets } from "../../hooks/useScreenInsets";
import type { SponsoredPlacement } from "../../api/ads";
import { Avatar } from "../../components/Avatar";

const PHOTO_DURATION_MS = 5000;
const HOLD_DELAY_MS = 250;
const SWIPE_CLOSE_THRESHOLD = 100;
const TAP_MOVE_THRESHOLD = 10;
const DOUBLE_TAP_WINDOW_MS = 250;
const QUALIFIED_VIEW_MS = 2000; // spec section 13: "2-second view = tiny positive"
const QUICK_SKIP_MS = 1500; // spec section 8: leaving a creator this fast is a real negative signal

export interface StoryFeedProps {
  creators: string[];
  startIndex: number;
  initialStoryId?: string;
  onRefresh?: () => void;
  onNeedMore?: () => void;
  sponsored?: SponsoredPlacement[];
  /**
   * Present only when this feed was pushed on top of something to return
   * to (a profile's Story ring, a notification, a DM share) — shows the
   * close (X) button, and reaching either edge of `creators` calls this
   * instead of the embedded "you're all caught up" end state below.
   */
  onClose?: () => void;
  onOpenDM: (params: { storyId: string; ownerUsername: string }) => void;
  /** A mention overlay was tapped — navigate to that user's live profile (spec section 30). */
  onOpenProfile: (username: string) => void;
}

/**
 * Full-screen Story feed with the complete gesture set (spec section 4):
 * tap right/left move within a creator's Stories (crossing to the next
 * creator only at the end of their sequence, per spec), swipe up/down move
 * between creators outright, hold pauses, double-tap ensures a like (never
 * unlikes), and the right-side action rail (Heart/Comment/Share/More —
 * spec section 5) is real, not decorative.
 *
 * This is the shared core behind both Home (spec sections 4-6: a
 * zero-tap, full-screen, auto-advancing feed — `onClose` omitted, no tap
 * needed to reach it) and StoryViewerScreen (a single creator's Stories
 * opened from their profile, a notification, or a DM share — `onClose`
 * provided so there's something to return to).
 */
export function StoryFeed({ creators, startIndex, initialStoryId, onClose, onOpenDM, onOpenProfile, onRefresh, onNeedMore, sponsored = [] }: StoryFeedProps): React.JSX.Element {
  // Overlays clear the status bar / notch; the bottom ones also the home indicator when no tab bar is below.
  const insets = useScreenInsets();
  const { user: authUser, accessToken } = useAuth();
  const reducedMotion = useReducedMotion();
  const focused = useIsFocused();
  const [foreground, setForeground] = useState(AppState.currentState === "active");
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (next) => setForeground(next === "active"));
    return () => subscription.remove();
  }, []);
  const [containerSize, onContainerLayout] = useContainerLayout();

  const [creatorIndex, setCreatorIndex] = useState(startIndex);
  const [storiesByCreator, setStoriesByCreator] = useState<Record<string, PublicStory[]>>({});
  const [storyIndexByCreator, setStoryIndexByCreator] = useState<Record<string, number>>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [caughtUp, setCaughtUp] = useState(false);
  useEffect(()=>{if(creatorIndex>=creators.length-3)onNeedMore?.();},[creatorIndex,creators.length,onNeedMore]);
  useEffect(()=>{if(creatorIndex<creators.length-1)setCaughtUp(false);},[creators.length,creatorIndex]);
  const [currentAd, setCurrentAd] = useState<SponsoredPlacement | null>(null);
  const hiddenAds = useRef(new Set<string>());
  const visitedAds = useRef(new Set<string>());

  const [detail, setDetail] = useState<StoryDetail | null>(null);
  const [viewCount, setViewCount] = useState<number | null>(null);
  const [mediaKind, setMediaKind] = useState<"photo" | "video" | null>(null);
  const [videoDurationMs, setVideoDurationMs] = useState<number | null>(null);
  const videoRef = useRef<VideoRef>(null);
  const videoResume = useRef<{id:string;seconds:number}|null>(null);
  const [mediaReady, setMediaReady] = useState(false);
  const [paused, setPaused] = useState(false);
  const [heartPulse] = useState(() => new Animated.Value(0));

  const [commentsOpen, setCommentsOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [insightsOpen, setInsightsOpen] = useState(false);

  const progress = useRef(new Animated.Value(0)).current;
  const animationRef = useRef<Animated.CompositeAnimation | null>(null);
  const storyShownAtRef = useRef<number>(Date.now());
  const watchedStoriesRef = useRef(new Set<string>());
  const lastShownStoryRef = useRef<string | null>(null);
  const creatorArrivedAtRef = useRef<number>(Date.now());

  const currentUsername = creators[creatorIndex];
  const currentStories = currentUsername ? storiesByCreator[currentUsername] : undefined;
  const currentStoryIndex = currentUsername ? (storyIndexByCreator[currentUsername] ?? 0) : 0;
  const currentStory = currentStories?.[currentStoryIndex] ?? null;

  const sheetOpen = commentsOpen || shareOpen || moreOpen || insightsOpen;
  const playbackActive = focused && foreground && !paused && !sheetOpen && !caughtUp && !loadError && !currentAd;
  const progressValue = useRef(0);
  useEffect(() => {
    const listener = progress.addListener(({ value }) => { progressValue.current = value; });
    return () => progress.removeListener(listener);
  }, [progress]);
  useEffect(() => {
    progressValue.current = 0;
    progress.setValue(0);
  }, [currentStory?.id, progress]);

  // Every analytics call is fire-and-forget on purpose (spec section 12: real,
  // server-validated events — but a dropped one must never interrupt viewing).
  const emit = useCallback(
    (eventType: Parameters<typeof recordEvent>[0]["eventType"], extra: { creatorId?: string; storyId?: string; valueMs?: number } = {}) => {
      if (!accessToken) return;
      void recordEvent({ eventType, ...extra }, accessToken).catch(() => undefined);
    },
    [accessToken],
  );

  // The escape hatch for "nothing left to show here": returns to whatever
  // this feed was opened from when there is one (onClose), otherwise (Home)
  // there's nowhere to go back to, so a fresh creator/story is the only move.
  const leaveCurrentCreator = useCallback(
    (direction: "forward" | "backward") => {
      if (onClose) {
        onClose();
        return;
      }
      if (direction === "forward") {
        setCaughtUp(true);
      }
      // Backward past the first creator, with nothing above Home, is a no-op (bounce).
    },
    [onClose],
  );

  // Fetch (and cache) a creator's active Stories the first time we reach them.
  useEffect(() => {
    if (!focused || !foreground || !currentUsername || !accessToken || storiesByCreator[currentUsername]) return;
    setLoadError(null);
    let cancelled = false;
    (async () => {
      try {
        const isSelf = authUser?.username === currentUsername;
        const { stories } = isSelf
          ? await getMyActiveStories(accessToken)
          : await getUserActiveStories(currentUsername, accessToken);
        if (cancelled) return;
        if (stories.length === 0) {
          if (creatorIndex < creators.length - 1) setCreatorIndex((index) => index + 1);
          else leaveCurrentCreator("forward");
          return;
        }
        setStoriesByCreator((prev) => ({ ...prev, [currentUsername]: stories }));
        if (creatorIndex === startIndex && initialStoryId) {
          const idx = stories.findIndex((s) => s.id === initialStoryId);
          if (idx >= 0) setStoryIndexByCreator((prev) => ({ ...prev, [currentUsername]: idx }));
        }
      } catch {
        if (!cancelled) setLoadError("Couldn't load this Story.");
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUsername, accessToken, focused, foreground, retry]);

  // Fires once per arrival at a creator (including a return visit after
  // swiping away and back — `currentStories` is a different array
  // reference each time storiesByCreator's key selection changes).
  useEffect(() => {
    if (!currentStories || currentStories.length === 0) return;
    creatorArrivedAtRef.current = Date.now();
    const ownerId = currentStories[0]?.ownerId;
    if (ownerId) {
      emit("creator_impression", { creatorId: ownerId });
      emit("creator_sequence_started", { creatorId: ownerId });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentStories]);

  // Fetch full engagement detail + media kind for whichever story is now current, and record the view.
  useEffect(() => {
    setDetail(null);
    setMediaKind(null);
    setVideoDurationMs(null);
    setMediaReady(false);
    setViewCount(null);
    if (!focused || !foreground || !currentStory || !accessToken) return;
    setLoadError(null);
    // Story lists carry the media's kind and URLs, so the media starts loading now, alongside the detail request.
    if (currentStory.media?.kind) setMediaKind(currentStory.media.kind);
    let cancelled = false;
    (async () => {
      try {
        const [{ story }, media] = await Promise.all([
          getStoryDetail(currentStory.id, accessToken),
          currentStory.media ? Promise.resolve(null) : getMedia(currentStory.mediaId, accessToken),
        ]);
        if (cancelled) return;
        setDetail(story);
        // Show the public aggregate immediately from Story detail. After this viewer is recorded,
        // the count is refreshed; identities are never requested unless this is the owner Insights sheet.
        setViewCount(story.viewCount);
        if (media) setMediaKind(media.kind);
      } catch {
        if (!cancelled) setLoadError("Couldn't load this Story.");
      }
    })();
    return () => { cancelled = true; };
  }, [currentStory, accessToken, focused, foreground, retry]);

  useEffect(() => {
    if (!currentStory || !accessToken || !playbackActive || !mediaReady) return;
    let cancelled = false;
    void recordStoryView(currentStory.id, accessToken)
      .then(() => getViewCount(currentStory.id, accessToken))
      .then(({ views }) => {
        if (!cancelled) setViewCount(views);
      })
      .catch(() => undefined);
    emit("story_impression", { storyId: currentStory.id, creatorId: currentStory.ownerId });
    storyShownAtRef.current = Date.now();
    // Coming back to a Story already watched in this feed is a replay (spec section 15). Pausing
    // and resuming the same Story re-runs this effect, so only a change of Story counts.
    if (lastShownStoryRef.current !== currentStory.id) {
      if (watchedStoriesRef.current.has(currentStory.id)) emit("story_replay", { storyId: currentStory.id, creatorId: currentStory.ownerId });
      watchedStoriesRef.current.add(currentStory.id);
      lastShownStoryRef.current = currentStory.id;
    }

    // On leaving this Story (a real navigation away, or the component
    // unmounting), report how long it was actually on screen.
    return () => {
      cancelled = true;
      const elapsed = Date.now() - storyShownAtRef.current;
      emit("watch_duration", { storyId: currentStory.id, valueMs: Math.min(elapsed, 30 * 60 * 1000) });
      if (elapsed >= QUALIFIED_VIEW_MS) {
        emit("qualified_view", { storyId: currentStory.id, creatorId: currentStory.ownerId });
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentStory, accessToken, playbackActive, mediaReady]);

  // spec section 8: leaving a creator within QUICK_SKIP_MS of arriving is a real negative signal.
  const maybeEmitQuickSkip = useCallback(() => {
    if (!currentStory) return;
    if (Date.now() - creatorArrivedAtRef.current < QUICK_SKIP_MS) {
      emit("quick_creator_skip", { creatorId: currentStory.ownerId });
    }
  }, [currentStory, emit]);

  const goNextCreator = useCallback(() => {
    maybeEmitQuickSkip();
    const ad = sponsored.find((item) => item.afterOrganic === creatorIndex + 1 && !hiddenAds.current.has(item.creativeId) && !visitedAds.current.has(item.deliveryId));
    if (ad) { visitedAds.current.add(ad.deliveryId); setCurrentAd(ad); return; }
    if (creatorIndex >= creators.length - 1) {
      leaveCurrentCreator("forward");
      return;
    }
    setCreatorIndex((i) => i + 1);
  }, [creatorIndex, creators.length, leaveCurrentCreator, maybeEmitQuickSkip, sponsored]);

  const goPreviousCreator = useCallback(() => {
    maybeEmitQuickSkip();
    const ad = sponsored.find((item) => item.afterOrganic === creatorIndex && !hiddenAds.current.has(item.creativeId));
    if (ad) { visitedAds.current.add(ad.deliveryId); setCurrentAd(ad); return; }
    if (creatorIndex <= 0) {
      leaveCurrentCreator("backward");
      return;
    }
    setCreatorIndex((i) => i - 1);
  }, [creatorIndex, leaveCurrentCreator, maybeEmitQuickSkip, sponsored]);

  const goNextStory = useCallback(() => {
    if (!currentUsername || !currentStories) return;
    if (currentStoryIndex >= currentStories.length - 1) {
      if (currentStory) emit("creator_sequence_completed", { creatorId: currentStory.ownerId });
      goNextCreator(); // spec section 4: a right tap past the last Story moves to the next creator
      return;
    }
    if (currentStory) emit("creator_sequence_continued", { creatorId: currentStory.ownerId });
    setStoryIndexByCreator((prev) => ({ ...prev, [currentUsername]: currentStoryIndex + 1 }));
  }, [currentUsername, currentStories, currentStoryIndex, currentStory, goNextCreator, emit]);

  const goPreviousStory = useCallback(() => {
    if (!currentUsername) return;
    if (currentStory && currentStoryIndex > 0) {
      emit("creator_sequence_continued", { creatorId: currentStory.ownerId });
    }
    setStoryIndexByCreator((prev) => ({ ...prev, [currentUsername]: Math.max(0, currentStoryIndex - 1) }));
  }, [currentUsername, currentStoryIndex, currentStory, emit]);

  // Auto-advance progress bar.
  useEffect(() => {
    if (!playbackActive || !mediaReady || !currentStory || mediaKind === null) return;
    // Video progress and completion come from the player, avoiding two competing timers.
    if (mediaKind === "video") return;

    const durationMs = PHOTO_DURATION_MS * (1 - progressValue.current);
    animationRef.current?.stop();
    const anim = Animated.timing(progress, { toValue: 1, duration: durationMs, useNativeDriver: false });
    animationRef.current = anim;
    anim.start(({ finished }) => {
      if (finished) {
        if (currentStory) emit("story_complete", { storyId: currentStory.id, creatorId: currentStory.ownerId });
        goNextStory();
      }
    });
    return () => anim.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentStory, playbackActive, mediaReady, mediaKind, goNextStory]);

  const ensureLiked = useCallback(async () => {
    if (!accessToken || !currentStory || !detail || detail.viewerHasLiked) return;
    setDetail((d) => (d ? { ...d, viewerHasLiked: true, likeCount: d.likeCount + 1 } : d));
    Vibration.vibrate(10); // no haptics package available — a short vibration is a real, if blunter, substitute
    // Reduce Motion (spec: "reduced-motion support where practical") — the
    // pulse is purely decorative, so it collapses to an instant flash
    // (duration 0) rather than the scaling/fading animation. The
    // confirmation itself (the heart briefly appearing) still happens;
    // only its motion is removed.
    const pulseDuration = reducedMotion ? 0 : 150;
    Animated.sequence([
      Animated.timing(heartPulse, { toValue: 1, duration: pulseDuration, useNativeDriver: true }),
      Animated.timing(heartPulse, { toValue: 0, duration: pulseDuration, useNativeDriver: true, delay: reducedMotion ? 300 : 0 }),
    ]).start();
    try {
      await likeStory(currentStory.id, accessToken);
    } catch {
      setDetail((d) => (d ? { ...d, viewerHasLiked: false, likeCount: Math.max(0, d.likeCount - 1) } : d));
    }
  }, [accessToken, currentStory, detail, heartPulse, reducedMotion]);

  const toggleLike = useCallback(async () => {
    if (!accessToken || !currentStory || !detail) return;
    const wasLiked = detail.viewerHasLiked;
    setDetail((d) => (d ? { ...d, viewerHasLiked: !wasLiked, likeCount: d.likeCount + (wasLiked ? -1 : 1) } : d));
    if (!wasLiked) Vibration.vibrate(10);
    try {
      if (wasLiked) await unlikeStory(currentStory.id, accessToken);
      else await likeStory(currentStory.id, accessToken);
    } catch {
      setDetail((d) => (d ? { ...d, viewerHasLiked: wasLiked, likeCount: d.likeCount + (wasLiked ? 1 : -1) } : d));
    }
  }, [accessToken, currentStory, detail]);

  // Combined tap(left/right) / double-tap(like) / hold(pause) / swipe(creator) recognizer.
  // Single-tap navigation is deliberately delayed behind the double-tap
  // window so a double-tap is never misread as two single taps first
  // (same rule as spec section 4's Home gestures).
  const gesture = useMemo(() => {
    const screenWidth = Dimensions.get("window").width;
    let startX = 0;
    let startY = 0;
    let holdTimer: ReturnType<typeof setTimeout> | null = null;
    let pendingTapTimer: ReturnType<typeof setTimeout> | null = null;
    let didHold = false;
    let lastTapAt = 0;

    const dispose = () => {
      if (holdTimer) clearTimeout(holdTimer);
      if (pendingTapTimer) clearTimeout(pendingTapTimer);
      holdTimer = null;
      pendingTapTimer = null;
      lastTapAt = 0;
    };
    const responder = PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => {
        startX = evt.nativeEvent.pageX;
        startY = evt.nativeEvent.pageY;
        didHold = false;
        holdTimer = setTimeout(() => {
          didHold = true;
          setPaused(true);
        }, HOLD_DELAY_MS);
      },
      onPanResponderRelease: (evt) => {
        if (holdTimer) clearTimeout(holdTimer);

        if (didHold) {
          setPaused(false);
          return;
        }

        const dx = evt.nativeEvent.pageX - startX;
        const dy = evt.nativeEvent.pageY - startY;

        if (dy > SWIPE_CLOSE_THRESHOLD && Math.abs(dx) < SWIPE_CLOSE_THRESHOLD) {
          if (currentStory) emit("creator_swipe_previous", { creatorId: currentStory.ownerId });
          goPreviousCreator();
          return;
        }
        if (dy < -SWIPE_CLOSE_THRESHOLD && Math.abs(dx) < SWIPE_CLOSE_THRESHOLD) {
          if (currentStory) emit("creator_swipe_next", { creatorId: currentStory.ownerId });
          goNextCreator();
          return;
        }
        if (Math.abs(dx) > TAP_MOVE_THRESHOLD || Math.abs(dy) > TAP_MOVE_THRESHOLD) return;

        const now = Date.now();
        if (now - lastTapAt < DOUBLE_TAP_WINDOW_MS) {
          if (pendingTapTimer) {
            clearTimeout(pendingTapTimer);
            pendingTapTimer = null;
          }
          lastTapAt = 0;
          void ensureLiked();
          return;
        }
        lastTapAt = now;
        const tapX = evt.nativeEvent.pageX;
        pendingTapTimer = setTimeout(() => {
          pendingTapTimer = null;
          if (!currentStory) return;
          if (tapX < screenWidth / 2) {
            emit("story_previous", { storyId: currentStory.id, creatorId: currentStory.ownerId });
            goPreviousStory();
          } else {
            emit("story_next", { storyId: currentStory.id, creatorId: currentStory.ownerId });
            goNextStory();
          }
        }, DOUBLE_TAP_WINDOW_MS);
      },
      onPanResponderTerminate: () => {
        dispose();
        setPaused(false);
      },
    });
    return { ...responder, dispose };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goNextStory, goPreviousStory, goNextCreator, goPreviousCreator, ensureLiked, currentStory, emit]);

  useEffect(() => () => gesture.dispose(), [gesture]);
  useEffect(() => {
    if (!focused || !foreground) {
      gesture.dispose();
      setPaused(false);
    }
  }, [focused, foreground, gesture]);

  if (currentAd) return <SponsoredStory key={currentAd.deliveryId} ad={currentAd} active={focused && foreground}
    onNext={() => { setCreatorIndex(currentAd.afterOrganic); setCurrentAd(null); }}
    onPrevious={() => { setCreatorIndex(Math.max(0, currentAd.afterOrganic - 1)); setCurrentAd(null); }}
    onHide={(id) => hiddenAds.current.add(id)} onOpenProfile={onOpenProfile} />;

  if (caughtUp) {
    return <View style={styles.centered}>
      <EmptyState title="You're all caught up" message="No more Stories right now — check back soon." />
      {onRefresh ? <Pressable onPress={onRefresh} accessibilityRole="button"><Text style={typography.body}>Check for new Stories</Text></Pressable> : null}
    </View>;
  }
  if (loadError) {
    return <View style={styles.centered}>
      <EmptyState title="Story unavailable" message={loadError} />
      <Pressable onPress={() => { setLoadError(null); setRetry((value) => value + 1); }} accessibilityRole="button"><Text style={typography.body}>Try again</Text></Pressable>
      <Pressable onPress={() => { setLoadError(null); goNextCreator(); }} accessibilityRole="button"><Text style={typography.body}>Skip Story</Text></Pressable>
      {onClose ? <Pressable onPress={onClose} accessibilityRole="button"><Text style={typography.body}>Close</Text></Pressable> : null}
    </View>;
  }
  if (!currentStory) {
    return (
      <View style={styles.centered}>
        <Text style={typography.body}>Loading…</Text>
      </View>
    );
  }

  // Processed variants only: signed CDN URLs when present (no token sent), otherwise this API with the token.
  const authHeaders = accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined;
  const delivery = currentStory.media ?? null;
  const apiSource = (variant: "display" | "poster" | "video_720") => ({ uri: mediaFileUrl(currentStory.mediaId, variant), headers: authHeaders });
  const imageSource = delivery?.imageUrl ? mediaSource(delivery.imageUrl, accessToken) : apiSource(mediaKind === "video" ? "poster" : "display");
  const videoSource = delivery?.videos[0] ? mediaSource(delivery.videos[0].url, accessToken) : apiSource("video_720");
  const isOwnStory = authUser?.username === currentUsername;

  return (
    <View style={styles.container} onLayout={onContainerLayout}>
      {mediaKind === "video" ? (
        <Video
          ref={videoRef}
          source={videoSource}
          poster={{ source: imageSource, resizeMode: "cover" }}
          style={[StyleSheet.absoluteFill, mediaTransformStyle(detail?.crop ?? currentStory.crop, containerSize.width, containerSize.height)]}
          resizeMode="cover"
          muted={detail?.audioMuted ?? currentStory.audioMuted}
          paused={!playbackActive}
          onLoad={(meta) => { setVideoDurationMs(Math.max(meta.duration * 1000, 1000)); if(videoResume.current?.id===currentStory.id&&videoResume.current.seconds>0)videoRef.current?.seek(Math.min(videoResume.current.seconds,Math.max(0,meta.duration-0.1))); setMediaReady(true); }}
          onProgress={({ currentTime }) => { videoResume.current={id:currentStory.id,seconds:currentTime}; if (videoDurationMs) progress.setValue(Math.min(1, currentTime * 1000 / videoDurationMs)); }}
          onError={() => setLoadError("Couldn't play this Story.")}
          onEnd={() => {
            if (!playbackActive) return;
            videoResume.current=null;
            emit("story_complete", { storyId: currentStory.id, creatorId: currentStory.ownerId });
            goNextStory();
          }}
        />
      ) : mediaKind === "photo" ? (
        <Image
          onLoad={() => setMediaReady(true)}
          onError={() => setLoadError("Couldn't load this photo.")}
          source={imageSource}
          style={[StyleSheet.absoluteFill, mediaTransformStyle(detail?.crop ?? currentStory.crop, containerSize.width, containerSize.height)]}
          resizeMode="cover"
        />
      ) : null}

      {/*
        The tap/double-tap/hold/swipe recognizer, as its own layer rather
        than on the outer container: a screen reader collapses whatever
        View it's marked `accessible` on into one opaque node, which would
        have swallowed the like/comment/share/more buttons, the progress
        bar, and the close button — all later siblings here — into
        unreachability. Sitting *beneath* StoryOverlayLayer (rendered
        earlier in JSX) in paint order means a tap on a mention is still
        claimed by the mention's own touch target first (RN's
        topmost-sibling hit-testing), the same technique the editor's own
        swipe-to-cycle-filter layer already uses relative to canvas
        objects. accessibilityActions gives a screen reader the same four
        moves the gesture recognizer offers a sighted touch — next/previous
        Story, next/previous creator — reusing the same navigation and
        analytics-emit calls the gesture handler itself calls, so the
        resulting analytics event is identical either way.
      */}
      <View
        style={StyleSheet.absoluteFill}
        {...gesture.panHandlers}
        accessible
        accessibilityRole="button"
        accessibilityLabel="Story"
        accessibilityHint="Use the actions menu to move between Stories or creators"
        accessibilityActions={[
          { name: "nextStory", label: "Next Story" },
          { name: "previousStory", label: "Previous Story" },
          { name: "nextCreator", label: "Next creator" },
          { name: "previousCreator", label: "Previous creator" },
        ]}
        onAccessibilityAction={(event) => {
          switch (event.nativeEvent.actionName) {
            case "nextStory":
              emit("story_next", { storyId: currentStory.id, creatorId: currentStory.ownerId });
              goNextStory();
              break;
            case "previousStory":
              emit("story_previous", { storyId: currentStory.id, creatorId: currentStory.ownerId });
              goPreviousStory();
              break;
            case "nextCreator":
              emit("creator_swipe_next", { creatorId: currentStory.ownerId });
              goNextCreator();
              break;
            case "previousCreator":
              emit("creator_swipe_previous", { creatorId: currentStory.ownerId });
              goPreviousCreator();
              break;
          }
        }}
      />

      {detail && containerSize.width > 0 ? (
        <StoryOverlayLayer
          overlays={detail.overlays}
          drawing={detail.drawing}
          filter={filterNameFromKey(detail.filter)}
          containerWidth={containerSize.width}
          containerHeight={containerSize.height}
          onMentionPress={onOpenProfile}
        />
      ) : null}

      <Animated.View
        pointerEvents="none"
        style={[styles.heartBurst, { opacity: heartPulse, transform: [{ scale: heartPulse.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1.4] }) }] }]}
      >
        <Icon style={styles.heartBurstIcon} name={ICONS.liked} />
      </Animated.View>

      <View style={[styles.progressRow, { top: insets.top + spacing.sm }]}>
        {currentStories?.map((s, i) => (
          <View key={s.id} style={styles.progressTrack}>
            <Animated.View
              style={[
                styles.progressFill,
                {
                  width:
                    i < currentStoryIndex
                      ? "100%"
                      : i > currentStoryIndex
                        ? "0%"
                        : progress.interpolate({ inputRange: [0, 1], outputRange: ["0%", "100%"] }),
                },
              ]}
            />
          </View>
        ))}
      </View>

      <View style={[styles.actionRail, { bottom: spacing.xl * 3 + insets.bottom }]}>
        <Pressable onPress={toggleLike} hitSlop={10} style={styles.actionButton} accessibilityRole="button" accessibilityLabel={detail?.viewerHasLiked ? "Unlike" : "Like"}>
          <Icon style={[styles.actionIcon, detail?.viewerHasLiked && styles.actionIconLiked]} name={detail?.viewerHasLiked ? ICONS.liked : ICONS.like} />
          <Text style={styles.actionCount}>{detail?.likeCount ?? "—"}</Text>
        </Pressable>
        <Pressable
          onPress={() => {
            emit("comment_open", { storyId: currentStory.id, creatorId: currentStory.ownerId });
            setCommentsOpen(true);
          }}
          hitSlop={10}
          style={styles.actionButton}
          accessibilityRole="button"
          accessibilityLabel="Comments"
        >
          <Icon style={styles.actionIcon} name={ICONS.comment} />
          <Text style={styles.actionCount}>{detail?.commentCount ?? "—"}</Text>
        </Pressable>
        <Pressable onPress={() => setShareOpen(true)} hitSlop={10} style={styles.actionButton} accessibilityRole="button" accessibilityLabel="Share">
          <Icon style={styles.actionIcon} name={ICONS.share} />
        </Pressable>
        <Pressable onPress={() => setMoreOpen(true)} hitSlop={10} style={styles.actionButton} accessibilityRole="button" accessibilityLabel="More">
          <Icon style={styles.actionIcon} name={ICONS.more} />
        </Pressable>
      </View>

      <View style={[styles.footer, { bottom: spacing.xl + insets.bottom }]}>
        <View style={styles.avatarRing}>
          <Avatar username={currentUsername ?? ""} size={30} />
        </View>
        <View style={styles.footerText}>
          <Text style={styles.username}>@{currentUsername}</Text>
          {currentStory.caption ? <Text style={styles.caption}>{currentStory.caption}</Text> : null}
          {currentStories && currentStories.length > 1 ? (
            <Text style={styles.sequence}>
              {currentStoryIndex + 1} of {currentStories.length} today
            </Text>
          ) : null}
        </View>
        {/* Visible to any authorized viewer — who's behind the number, and the rest of Insights, is owner-only (StoryInsightsSheet). */}
        {isOwnStory ? (
          <Pressable onPress={() => setInsightsOpen(true)} hitSlop={8} style={[styles.viewCountButton, styles.viewCountRow]} accessibilityRole="button" accessibilityLabel={`${viewCount ?? 0} views. Open viewers and Insights`}>
            <Icon name={ICONS.viewers} size={14} color={styles.viewCount.color} />
            <Text style={styles.viewCount}>{viewCount ?? "—"}</Text>
          </Pressable>
        ) : (
          <View style={styles.viewCountRow} accessible accessibilityLabel={`${viewCount ?? 0} views`}>
            <Icon name={ICONS.viewers} size={14} color={styles.viewCount.color} />
            <Text style={styles.viewCount}>{viewCount ?? "—"}</Text>
          </View>
        )}
      </View>

      {onClose ? (
        <Pressable style={[styles.closeButton, { top: insets.top + spacing.lg }]} onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close">
          <Icon style={styles.closeIcon} name={ICONS.close} />
        </Pressable>
      ) : null}

      <CommentsSheet
        visible={commentsOpen}
        storyId={currentStory.id}
        storyOwnerId={currentStory.ownerId}
        commentsDisabled={currentStory.allowComments === "disabled"}
        onClose={() => setCommentsOpen(false)}
        onCommentCountChange={(delta) => setDetail((d) => (d ? { ...d, commentCount: Math.max(0, d.commentCount + delta) } : d))}
      />
      <ShareSheet
        visible={shareOpen}
        storyId={currentStory.id}
        ownerUsername={currentUsername ?? ""}
        isPublic={currentStory.audience === "public" && currentStory.allowSharing}
        onClose={() => setShareOpen(false)}
        onSendToUser={() => {
          setShareOpen(false);
          onOpenDM({ storyId: currentStory.id, ownerUsername: currentUsername ?? "" });
        }}
      />
      <StoryMoreMenu
        visible={moreOpen}
        storyId={currentStory.id}
        isOwnStory={isOwnStory}
        otherUsername={isOwnStory ? null : (currentUsername ?? null)}
        otherUserId={isOwnStory ? null : currentStory.ownerId}
        onClose={() => setMoreOpen(false)}
        onDeleted={() => {
          setMoreOpen(false);
          goNextCreator();
        }}
      />
      {isOwnStory ? (
        <StoryInsightsSheet visible={insightsOpen} storyId={currentStory.id} onClose={() => setInsightsOpen(false)} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background },
  heartBurst: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center" },
  heartBurstIcon: { fontSize: 96, color: colors.textPrimary },
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
    borderRadius: radii.pill,
    backgroundColor: "rgba(255,255,255,0.3)",
    overflow: "hidden",
  },
  progressFill: { height: "100%", backgroundColor: colors.textPrimary },
  actionRail: {
    position: "absolute",
    right: spacing.md,
    bottom: spacing.xl * 3,
    alignItems: "center",
    gap: spacing.lg,
  },
  actionButton: { alignItems: "center", gap: 2 },
  actionIcon: { color: colors.textPrimary, fontSize: 26 },
  actionIconLiked: { color: colors.accent },
  actionCount: { color: colors.textPrimary, fontSize: 12 },
  footer: {
    position: "absolute",
    bottom: spacing.xl,
    left: spacing.md,
    right: spacing.xxl * 2,
    flexDirection: "row",
    gap: spacing.sm,
    alignItems: "center",
  },
  // The creator's photo inside the accent Story ring.
  avatarRing: {
    width: 36,
    height: 36,
    borderRadius: radii.pill,
    borderWidth: 2,
    borderColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
  },
  footerText: { flex: 1 },
  username: { color: colors.textPrimary, fontWeight: "700" },
  caption: { color: colors.textPrimary, marginTop: 2 },
  sequence: { color: "rgba(255,255,255,0.7)", fontSize: 12, marginTop: 2 },
  viewCountButton: { alignItems: "flex-end" },
  viewCount: { color: "rgba(255,255,255,0.85)", fontSize: 12, fontWeight: "600" },
  viewCountRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  closeButton: { position: "absolute", top: spacing.xl, right: spacing.md },
  closeIcon: { color: colors.textPrimary, fontSize: 22 },
});
