import { Icon } from "../../components/Icon";
import { StorySkeleton } from "../../components/Skeleton";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Animated, AppState, Dimensions, Image, PanResponder, Pressable, StyleSheet, Text, View } from "react-native";
import { useIsFocused } from "@react-navigation/native";
import Video, {type VideoRef} from "react-native-video";
import { mediaColors as colors, radii, spacing, mediaTypography as typography, ICONS } from "../../theme";
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
import { MusicPlayer } from "../../components/MusicPlayer";
import { filterNameFromKey } from "../../models/filterPreviews";
import { mediaTransformStyle } from "../../models/storyDraft";
import { useReducedMotion } from "../../hooks/useReducedMotion";
import { SponsoredStory } from "../ads/SponsoredStory";
import { useScreenInsets } from "../../hooks/useScreenInsets";
import type { SponsoredPlacement } from "../../api/ads";
import { Avatar } from "../../components/Avatar";
import { ReplySheet } from "../../components/ReplySheet";
import { tapFeedback } from "../../utils/haptics";
import { timeAgo } from "../../utils/serverTime";
import { followUser } from "../../api/users";
import { AddToHighlightSheet } from "../../components/AddToHighlightSheet";

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
  /** Home's feed knows whom you follow: creators you don't get a Follow button beside their name. */
  following?: Record<string, boolean>;
}

/** Sound on or off for Stories with sound, kept while you watch (like Instagram). */
let viewerMuted = false;

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
/** The comment box (or your Story's Activity button) along the bottom. */
const BOTTOM_BAR_HEIGHT = 46;

export function StoryFeed({ creators, startIndex, initialStoryId, onClose, onOpenDM, onOpenProfile, onRefresh, onNeedMore, sponsored = [], following }: StoryFeedProps): React.JSX.Element {
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
  // The photo and its text and stickers appear together, with a short fade, once the photo has
  // loaded (never the photo first and the edits a moment later). A spinner shows only if that
  // takes a while; the next Stories are fetched ahead, so it usually doesn't.
  const reveal = useRef(new Animated.Value(0)).current;
  const [slowLoad, setSlowLoad] = useState(false);
  const [paused, setPaused] = useState(false);
  const [heartPulse] = useState(() => new Animated.Value(0));

  const [commentsOpen, setCommentsOpen] = useState(false);
  const [commentFocus, setCommentFocus] = useState(false);
  const [muted, setMuted] = useState(viewerMuted);
  const [followedNow, setFollowedNow] = useState<Record<string, boolean>>({});
  // The Story follows a finger swiping up or down to the next creator.
  const dragY = useRef(new Animated.Value(0)).current;
  const [shareOpen, setShareOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [insightsOpen, setInsightsOpen] = useState(false);
  const [highlightOpen, setHighlightOpen] = useState(false);
  // The Story just added to a Highlight, so its button says so.
  const [highlightAddedId, setHighlightAdded] = useState<string | null>(null);
  const [replyOpen, setReplyOpen] = useState(false);
  const [replySent, setReplySent] = useState<string | null>(null);
  const replySentTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (replySentTimer.current) clearTimeout(replySentTimer.current); }, []);

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

  const sheetOpen = commentsOpen || shareOpen || moreOpen || insightsOpen || replyOpen || highlightOpen;
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

  useEffect(() => {
    if (mediaReady) {
      setSlowLoad(false);
      Animated.timing(reveal, { toValue: 1, duration: 120, useNativeDriver: true }).start();
      return;
    }
    reveal.setValue(0);
    const t = setTimeout(() => setSlowLoad(true), 350);
    return () => clearTimeout(t);
  }, [mediaReady, reveal]);

  // Fetch ahead: the next Stories' photos, and the next person's Stories and first photo, so
  // moving on is instant. Signed CDN links only (the image cache can't send the sign-in header).
  useEffect(() => {
    if (!focused || !accessToken || !currentStories) return;
    const prefetch = (story: PublicStory | undefined) => {
      const url = story?.media?.imageUrl;
      if (url && !url.startsWith("/")) void Image.prefetch(url).catch(() => undefined);
    };
    currentStories.slice(currentStoryIndex + 1, currentStoryIndex + 3).forEach(prefetch);
    const next = creators[creatorIndex + 1];
    if (!next || storiesByCreator[next]) return;
    let cancelled = false;
    const isSelf = authUser?.username === next;
    (isSelf ? getMyActiveStories(accessToken) : getUserActiveStories(next, accessToken))
      .then(({ stories }) => {
        // An empty list is left for the normal load, which skips that person.
        if (cancelled || stories.length === 0) return;
        setStoriesByCreator((prev) => (prev[next] ? prev : { ...prev, [next]: stories }));
        prefetch(stories[0]);
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentStories, currentStoryIndex, creatorIndex, creators, focused, accessToken]);

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
        if (media) setMediaKind(media.kind === "video" ? "video" : "photo");
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

    // With a song, a photo stays up for the part of the song that plays (like Instagram).
    const durationMs = (currentStory.music?.durationMs ?? PHOTO_DURATION_MS) * (1 - progressValue.current);
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
    tapFeedback("tap");
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
    if (!wasLiked) tapFeedback("tap");
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
  // The handlers are created once and call the latest functions through this ref: rebuilding them
  // on a re-render (pausing re-renders) lost the gesture in progress, so letting go of a hold
  // could count as a tap and skip a Story.
  const g = useRef({ goNextStory, goPreviousStory, goNextCreator, goPreviousCreator, ensureLiked, currentStory, emit, reducedMotion });
  g.current = { goNextStory, goPreviousStory, goNextCreator, goPreviousCreator, ensureLiked, currentStory, emit, reducedMotion };
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
      onPanResponderMove: (evt) => {
        const dx = evt.nativeEvent.pageX - startX;
        const dy = evt.nativeEvent.pageY - startY;
        // A vertical swipe: the Story follows the finger (a hold that turns into a swipe stops pausing).
        if (!g.current.reducedMotion && Math.abs(dy) > TAP_MOVE_THRESHOLD && Math.abs(dy) > Math.abs(dx)) {
          if (holdTimer) clearTimeout(holdTimer);
          dragY.setValue(dy * 0.6);
        }
      },
      onPanResponderRelease: (evt) => {
        if (holdTimer) clearTimeout(holdTimer);

        if (didHold) {
          setPaused(false);
          dragY.setValue(0);
          return;
        }

        const dx = evt.nativeEvent.pageX - startX;
        const dy = evt.nativeEvent.pageY - startY;
        const height = Dimensions.get("window").height;
        // Slide out the way the finger went, then show the next creator in place.
        const slideOut = (to: number, then: () => void) => {
          if (g.current.reducedMotion) {
            then();
            return;
          }
          Animated.timing(dragY, { toValue: to, duration: 160, useNativeDriver: true }).start(() => {
            then();
            dragY.setValue(0);
          });
        };

        if (dy > SWIPE_CLOSE_THRESHOLD && Math.abs(dx) < SWIPE_CLOSE_THRESHOLD) {
          if (g.current.currentStory) g.current.emit("creator_swipe_previous", { creatorId: g.current.currentStory.ownerId });
          slideOut(height, g.current.goPreviousCreator);
          return;
        }
        if (dy < -SWIPE_CLOSE_THRESHOLD && Math.abs(dx) < SWIPE_CLOSE_THRESHOLD) {
          if (g.current.currentStory) g.current.emit("creator_swipe_next", { creatorId: g.current.currentStory.ownerId });
          slideOut(-height, g.current.goNextCreator);
          return;
        }
        // Not far enough: settle back.
        Animated.spring(dragY, { toValue: 0, useNativeDriver: true, bounciness: 4 }).start();
        if (Math.abs(dx) > TAP_MOVE_THRESHOLD || Math.abs(dy) > TAP_MOVE_THRESHOLD) return;

        const now = Date.now();
        if (now - lastTapAt < DOUBLE_TAP_WINDOW_MS) {
          if (pendingTapTimer) {
            clearTimeout(pendingTapTimer);
            pendingTapTimer = null;
          }
          lastTapAt = 0;
          void g.current.ensureLiked();
          return;
        }
        lastTapAt = now;
        const tapX = evt.nativeEvent.pageX;
        pendingTapTimer = setTimeout(() => {
          pendingTapTimer = null;
          if (!g.current.currentStory) return;
          // Like Instagram: the left third goes back, the rest goes forward.
          if (tapX < screenWidth / 3) {
            g.current.emit("story_previous", { storyId: g.current.currentStory.id, creatorId: g.current.currentStory.ownerId });
            g.current.goPreviousStory();
          } else {
            g.current.emit("story_next", { storyId: g.current.currentStory.id, creatorId: g.current.currentStory.ownerId });
            g.current.goNextStory();
          }
        }, DOUBLE_TAP_WINDOW_MS);
      },
      onPanResponderTerminate: () => {
        dispose();
        setPaused(false);
        dragY.setValue(0);
      },
    });
    return { ...responder, dispose };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragY]);

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
      <StorySkeleton />
    );
  }

  // Processed variants only: signed CDN URLs when present (no token sent), otherwise this API with the token.
  const authHeaders = accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined;
  const delivery = currentStory.media ?? null;
  const apiSource = (variant: "display" | "poster" | "video_720") => ({ uri: mediaFileUrl(currentStory.mediaId, variant), headers: authHeaders });
  const imageSource = delivery?.imageUrl ? mediaSource(delivery.imageUrl, accessToken) : apiSource(mediaKind === "video" ? "poster" : "display");
  const videoSource = delivery?.videos[0] ? mediaSource(delivery.videos[0].url, accessToken) : apiSource("video_720");
  const isOwnStory = authUser?.username === currentUsername;
  const highlightAdded = highlightAddedId === currentStory.id;

  const creatorMuted = detail?.audioMuted ?? currentStory.audioMuted;
  const showFollow = !isOwnStory && !!currentUsername && following?.[currentUsername] === false;
  const followed = !!currentUsername && followedNow[currentUsername] === true;
  const follow = async () => {
    if (!accessToken || !currentUsername) return;
    setFollowedNow((f) => ({ ...f, [currentUsername]: true }));
    tapFeedback("select");
    try {
      await followUser(currentUsername, accessToken);
    } catch {
      setFollowedNow((f) => ({ ...f, [currentUsername]: false }));
    }
  };
  // Holding to pause shows just the Story, like Instagram.
  const chrome = paused ? styles.chromeHidden : null;

  return (
    <Animated.View style={[styles.container, { transform: [{ translateY: dragY }] }]} onLayout={onContainerLayout}>
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: reveal }]} pointerEvents="none">
      {mediaKind === "video" ? (
        <Video
          ref={videoRef}
          source={videoSource}
          poster={{ source: imageSource, resizeMode: "cover" }}
          style={[StyleSheet.absoluteFill, mediaTransformStyle(detail?.crop ?? currentStory.crop, containerSize.width, containerSize.height)]}
          resizeMode="cover"
          muted={creatorMuted || muted}
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
      </Animated.View>

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

      {/* The list already carries the text, stickers, drawing and filter: no wait for the detail. */}
      {containerSize.width > 0 ? (
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: reveal }]} pointerEvents="box-none">
          <StoryOverlayLayer
            overlays={(detail ?? currentStory).overlays}
            drawing={(detail ?? currentStory).drawing}
            filter={filterNameFromKey((detail ?? currentStory).filter)}
            filterApplied={(detail ?? currentStory).filterApplied === true}
            containerWidth={containerSize.width}
            containerHeight={containerSize.height}
            onMentionPress={onOpenProfile}
          />
        </Animated.View>
      ) : null}
      {slowLoad && !mediaReady && !loadError ? (
        <View style={styles.loadingSpinner} pointerEvents="none">
          <ActivityIndicator color="#FFFFFF" size="large" />
        </View>
      ) : null}

      <Animated.View
        pointerEvents="none"
        style={[styles.heartBurst, { opacity: heartPulse, transform: [{ scale: heartPulse.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1.4] }) }] }]}
      >
        <Icon style={styles.heartBurstIcon} name={ICONS.liked} />
      </Animated.View>

      <View
        style={[styles.progressRow, chrome, { top: insets.top + spacing.sm }]}
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel={`Story ${currentStoryIndex + 1} of ${currentStories?.length ?? 1}`}
      >
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

      <View style={[styles.actionRail, chrome, { bottom: BOTTOM_BAR_HEIGHT + spacing.xl * 2 + insets.bottom }]} pointerEvents={paused ? "none" : "auto"}>
        {(mediaKind === "video" && !creatorMuted) || currentStory.music ? (
          <Pressable
            onPress={() => {
              viewerMuted = !muted;
              setMuted(viewerMuted);
            }}
            hitSlop={10}
            style={styles.actionButton}
            accessibilityRole="button"
            accessibilityLabel={muted ? "Sound off, tap to turn on" : "Sound on, tap to mute"}
          >
            <Icon style={styles.actionIcon} name={muted ? ICONS.audioMuted : ICONS.audioOn} />
          </Pressable>
        ) : null}
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
        {!isOwnStory ? (
          // How many have seen it; who they are is the owner's to see (StoryInsightsSheet).
          <View style={styles.actionButton} accessible accessibilityLabel={`${viewCount ?? 0} views`}>
            <Icon style={styles.actionIcon} name={ICONS.viewers} />
            <Text style={styles.actionCount}>{viewCount ?? "—"}</Text>
          </View>
        ) : null}
        <Pressable onPress={() => setShareOpen(true)} hitSlop={10} style={styles.actionButton} accessibilityRole="button" accessibilityLabel="Share">
          <Icon style={styles.actionIcon} name={ICONS.share} />
        </Pressable>
        <Pressable onPress={() => setMoreOpen(true)} hitSlop={10} style={styles.actionButton} accessibilityRole="button" accessibilityLabel="More">
          <Icon style={styles.actionIcon} name={ICONS.more} />
        </Pressable>
      </View>

      {/* Who posted it and when, at the top like Instagram; tap to open their profile. */}
      <View style={[styles.header, chrome, { top: insets.top + spacing.lg }]} pointerEvents={paused ? "none" : "box-none"}>
        <Pressable onPress={() => currentUsername && onOpenProfile(currentUsername)} hitSlop={8} style={styles.headerWho} accessibilityRole="button" accessibilityLabel={`Open @${currentUsername ?? ""}'s profile`}>
          <View style={styles.avatarRing}>
            <Avatar username={currentUsername ?? ""} size={30} />
          </View>
          <Text style={styles.username} numberOfLines={1}>{currentUsername}</Text>
          <Text style={styles.postedAgo}>{timeAgo(currentStory.createdAt).replace(" ago", "")}</Text>
        </Pressable>
        {showFollow ? (
          <Pressable onPress={followed ? undefined : () => void follow()} disabled={followed} hitSlop={8} style={[styles.followButton, followed && styles.followingButton]} accessibilityRole="button" accessibilityLabel={followed ? `Following @${currentUsername}` : `Follow @${currentUsername}`}>
            <Text style={styles.followLabel}>{followed ? "Following" : "Follow"}</Text>
          </Pressable>
        ) : null}
      </View>

      {currentStory.music ? (
        <>
          <MusicPlayer
            key={currentStory.id}
            url={currentStory.music.url}
            accessToken={accessToken}
            startMs={currentStory.music.startMs}
            durationMs={currentStory.music.durationMs}
            paused={!playbackActive || !mediaReady}
            muted={muted}
          />
          <View style={[styles.musicLine, chrome, { top: insets.top + spacing.lg + 40 }]} pointerEvents={paused ? "none" : "box-none"}>
            <Pressable
              style={styles.musicPill}
              hitSlop={6}
              onPress={() => Alert.alert(currentStory.music!.title, `${currentStory.music!.attribution}\n\nLicence: ${currentStory.music!.license}\n${currentStory.music!.licenseUrl}`)}
              accessibilityRole="button"
              accessibilityLabel={`Music: ${currentStory.music.title} by ${currentStory.music.artist}`}
              accessibilityHint="Shows the song's credit"
            >
              <Icon name={ICONS.music} size={13} color="#FFFFFF" />
              <Text style={styles.musicText} numberOfLines={1}>{currentStory.music.title} · {currentStory.music.artist}</Text>
            </Pressable>
          </View>
        </>
      ) : null}

      {currentStory.caption || currentStory.audience === "close_friends" ? (
        <View style={[styles.footer, chrome, { bottom: BOTTOM_BAR_HEIGHT + spacing.md + insets.bottom }]} pointerEvents="none">
          {currentStory.audience === "close_friends" ? (
            <View style={styles.closeFriendsBadge} accessible accessibilityLabel="Shared with Close Friends">
              <Icon name={ICONS.starFilled} size={11} color={colors.onAccent} />
              <Text style={styles.closeFriendsBadgeText}>Close Friends</Text>
            </View>
          ) : null}
          {currentStory.caption ? <Text style={styles.caption}>{currentStory.caption}</Text> : null}
        </View>
      ) : null}

      {/* Like Instagram: write a comment under someone's Story; your own shows who has seen it. */}
      <View style={[styles.bottomBar, chrome, { bottom: spacing.md + insets.bottom }]} pointerEvents={paused ? "none" : "auto"}>
        {isOwnStory ? (
          <Pressable onPress={() => setInsightsOpen(true)} style={styles.activityButton} accessibilityRole="button" accessibilityLabel={`Activity, ${viewCount ?? 0} views. Open viewers and Insights`}>
            <Icon name={ICONS.viewers} size={22} color={colors.textPrimary} />
            <Text style={styles.activityLabel}>{viewCount === null ? "Activity" : `${viewCount} ${viewCount === 1 ? "view" : "views"}`}</Text>
          </Pressable>
        ) : currentStory.allowComments === "disabled" ? (
          <Pressable onPress={() => setReplyOpen(true)} style={styles.commentBar} accessibilityRole="button" accessibilityLabel={`Send a message to @${currentUsername ?? ""}`}>
            <Text style={styles.commentPlaceholder}>Send a message…</Text>
          </Pressable>
        ) : (
          <Pressable
            onPress={() => {
              emit("comment_open", { storyId: currentStory.id, creatorId: currentStory.ownerId });
              setCommentFocus(true);
              setCommentsOpen(true);
            }}
            style={styles.commentBar}
            accessibilityRole="button"
            accessibilityLabel="Add a comment"
          >
            <Text style={styles.commentPlaceholder}>Add a comment…</Text>
          </Pressable>
        )}
        {!isOwnStory && currentStory.allowComments !== "disabled" ? (
          // A private reply goes to their messages (comments are public).
          <Pressable onPress={() => setReplyOpen(true)} hitSlop={8} style={styles.replyButton} accessibilityRole="button" accessibilityLabel={`Message @${currentUsername ?? ""} privately`}>
            <Icon name={ICONS.dm} size={26} color={colors.textPrimary} />
          </Pressable>
        ) : null}
        {isOwnStory ? (
          // Keep it after the 24 hours: add it to one of your Highlights, or start a new one.
          <Pressable onPress={() => setHighlightOpen(true)} style={[styles.activityButton, styles.highlightButton]} accessibilityRole="button" accessibilityLabel="Add this Story to a Highlight">
            <Icon name={ICONS.add} size={20} color={colors.textPrimary} />
            <Text style={styles.activityLabel}>{highlightAdded ? "Added" : "Highlight"}</Text>
          </Pressable>
        ) : null}
      </View>

      {onClose ? (
        <Pressable style={[styles.closeButton, { top: insets.top + spacing.lg }]} onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close">
          <Icon style={styles.closeIcon} name={ICONS.close} />
        </Pressable>
      ) : null}

      {replySent ? (
        <View style={styles.replyToast} pointerEvents="none" accessibilityLiveRegion="polite">
          <Text style={styles.replyToastText}>{replySent}</Text>
        </View>
      ) : null}

      {!isOwnStory ? (
        <ReplySheet
          visible={replyOpen}
          storyId={currentStory.id}
          ownerUsername={currentUsername ?? ""}
          onClose={() => setReplyOpen(false)}
          onSent={(kind) => {
            setReplySent(kind === "reaction" ? "Reaction sent" : "Reply sent");
            if (replySentTimer.current) clearTimeout(replySentTimer.current);
            replySentTimer.current = setTimeout(() => setReplySent(null), 1500);
          }}
        />
      ) : null}
      <CommentsSheet
        visible={commentsOpen}
        storyId={currentStory.id}
        storyOwnerId={currentStory.ownerId}
        commentsDisabled={currentStory.allowComments === "disabled"}
        followersOnly={currentStory.allowComments === "followers" && !isOwnStory && following?.[currentUsername ?? ""] === false && !followed}
        onOpenProfile={onOpenProfile}
        autoFocus={commentFocus}
        onClose={() => {
          setCommentsOpen(false);
          setCommentFocus(false);
        }}
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
        <AddToHighlightSheet
          visible={highlightOpen}
          storyIds={[currentStory.id]}
          onClose={() => setHighlightOpen(false)}
          onAdded={() => setHighlightAdded(currentStory.id)}
        />
      ) : null}
      {isOwnStory ? (
        <StoryInsightsSheet visible={insightsOpen} storyId={currentStory.id} onClose={() => setInsightsOpen(false)} />
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  musicLine: { position: "absolute", left: spacing.md, right: spacing.md, flexDirection: "row" },
  musicPill: { flexDirection: "row", alignItems: "center", gap: 5, maxWidth: "80%", paddingHorizontal: 10, height: 26, borderRadius: 13, backgroundColor: "rgba(0,0,0,0.35)" },
  musicText: { color: "#FFFFFF", fontSize: 12, fontWeight: "600", flexShrink: 1 },
  loadingSpinner: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center" },
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
  bottomBar: { position: "absolute", left: spacing.md, right: spacing.md, height: BOTTOM_BAR_HEIGHT, flexDirection: "row", alignItems: "center" },
  commentBar: {
    flex: 1,
    height: BOTTOM_BAR_HEIGHT,
    justifyContent: "center",
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.55)",
    backgroundColor: "rgba(0,0,0,0.25)",
  },
  commentPlaceholder: { color: "rgba(255,255,255,0.85)", fontSize: 15 },
  activityButton: { flexDirection: "row", alignItems: "center", gap: spacing.sm, height: BOTTOM_BAR_HEIGHT, paddingHorizontal: spacing.md, borderRadius: radii.pill, backgroundColor: "rgba(0,0,0,0.4)" },
  activityLabel: { color: colors.textPrimary, fontSize: 15, fontWeight: "700" },
  highlightButton: { marginLeft: "auto" },
  actionRail: {
    position: "absolute",
    right: spacing.md,
    bottom: spacing.xl * 3,
    alignItems: "center",
    gap: spacing.lg + 2,
  },
  actionButton: { alignItems: "center", gap: 3, minWidth: 44 },
  actionIcon: { color: colors.textPrimary, fontSize: 32 },
  actionIconLiked: { color: colors.accent },
  // Readable over any photo.
  actionCount: { color: colors.textPrimary, fontSize: 14, fontWeight: "700", textShadowColor: "rgba(0,0,0,0.6)", textShadowRadius: 3, textShadowOffset: { width: 0, height: 1 } },
  replyButton: { width: BOTTOM_BAR_HEIGHT, height: BOTTOM_BAR_HEIGHT, marginLeft: spacing.sm, alignItems: "center", justifyContent: "center" },
  footer: {
    position: "absolute",
    bottom: spacing.xl,
    left: spacing.md,
    right: spacing.xxl * 2,
    gap: spacing.xs,
    alignItems: "flex-start",
  },
  header: { position: "absolute", left: spacing.md, right: 72, flexDirection: "row", alignItems: "center", gap: spacing.sm },
  headerWho: { flexDirection: "row", alignItems: "center", gap: spacing.sm, flexShrink: 1 },
  postedAgo: { color: "rgba(255,255,255,0.8)", fontSize: 13, textShadowColor: "rgba(0,0,0,0.6)", textShadowRadius: 3 },
  followButton: { borderWidth: 1, borderColor: colors.textPrimary, borderRadius: radii.pill, paddingHorizontal: spacing.md, paddingVertical: 4 },
  followingButton: { borderColor: "rgba(255,255,255,0.5)" },
  followLabel: { color: colors.textPrimary, fontWeight: "700", fontSize: 13 },
  chromeHidden: { opacity: 0 },
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
  username: { color: colors.textPrimary, fontWeight: "700", fontSize: 15, flexShrink: 1, textShadowColor: "rgba(0,0,0,0.6)", textShadowRadius: 3 },
  caption: { color: colors.textPrimary, marginTop: 2 },
  closeButton: { position: "absolute", top: spacing.xl, right: spacing.md },
  closeFriendsBadge: { flexDirection: "row", alignItems: "center", gap: 3, alignSelf: "flex-start", backgroundColor: colors.success, borderRadius: radii.pill, paddingHorizontal: spacing.sm, paddingVertical: 2, marginTop: 4 },
  closeFriendsBadgeText: { color: colors.onAccent, fontSize: 11, fontWeight: "700" },
  replyToast: {
    position: "absolute",
    alignSelf: "center",
    top: "45%",
    backgroundColor: "rgba(0,0,0,0.7)",
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  replyToastText: { color: colors.textPrimary, fontWeight: "700" },
  closeIcon: { color: colors.textPrimary, fontSize: 22 },
});
