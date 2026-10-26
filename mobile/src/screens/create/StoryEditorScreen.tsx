import { useMediaStatusBar } from "../../hooks/useMediaStatusBar";
import { Icon } from "../../components/Icon";
import { KeyboardAvoider } from "../../components/KeyboardAvoider";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, BackHandler, Dimensions, Image, Keyboard, PanResponder, PixelRatio, StyleSheet, Text, TextInput, View, useWindowDimensions, type GestureResponderEvent, type LayoutChangeEvent } from "react-native";
import { Pressable } from "../../components/Pressable";
import Video from "react-native-video";
import type { NativeStackScreenProps, NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useFocusEffect, useIsFocused, useNavigation } from "@react-navigation/native";
import type { CreateStackParamList, RootStackParamList } from "../../navigation/types";
import { mediaColors as colors, radii, spacing, mediaTypography as typography, ICONS } from "../../theme";
import { useFestival } from "../../hooks/useFestival";
import { useAuth } from "../../state/AuthContext";
import {enqueueUpload} from '../../state/uploadQueue';
import { track } from "../../analytics/analytics";
import { ApiError } from "../../api/client";
import { FILTER_PREVIEWS, type FilterKey } from "../../models/filterPreviews";
import { tapFeedback } from "../../utils/haptics";
import { filteredPhotoUri, forgetFilteredPhoto } from "../../utils/filterPhoto";
import { filterSwipeStep, pinchPlacement, TAP_SLOP, type Placement, type Touch } from "../../models/canvasGestures";
import {
  clampOverlayPosition,
  createEmptyDraft,
  hasMeaningfulEdits,
  filterKey,
  mediaTransformStyle,
  type Overlay,
  type TextOverlayProperties,
  type LocationOverlayProperties,
  type DateTimeOverlayProperties,
} from "../../models/storyDraft";
import { DraggableCanvasObject } from "../../components/DraggableCanvasObject";
import { OverlayBody } from "../../components/OverlayBody";
import { PlacedOverlay } from "../../components/PlacedOverlay";
import { TextToolModal } from "../../components/TextToolModal";
import { StickerSheet, type StickerAddPayload, type StickerTab } from "../../components/StickerSheet";
import { MusicSheet, type ChosenMusic } from "../../components/MusicSheet";
import { MusicPlayer } from "../../components/MusicPlayer";
import { listMusic } from "../../api/music";
import { DrawingCanvas } from "../../components/DrawingCanvas";
import { OverlayAdjustSheet } from "../../components/OverlayAdjustSheet";
import { CropGestureLayer } from "../../components/CropGestureLayer";
import { CropAdjustControls } from "../../components/CropAdjustControls";
import { savePendingDraft, loadPendingDraft, clearPendingDraft } from "../../state/draftStorage";
import { useScreenInsets } from "../../hooks/useScreenInsets";
import { useScreenReader } from "../../hooks/useScreenReader";
import { DEFAULT_STORY_SETTINGS, loadStorySettings, saveStorySettings, StorySettingsSheet, storySettingsSummary, type StorySettings, type StoryVisibility } from "../../components/StorySettingsSheet";
import { Avatar } from "../../components/Avatar";
import { listCloseFriends } from "../../api/users";

type Props = NativeStackScreenProps<CreateStackParamList, "StoryEditor">;
type Audience = "public" | "followers" | "close_friends";

const TRASH_ZONE_SIZE = 80;
/**
 * Long edge of the editor's filtered photo preview, in pixels: the screen's own height in pixels,
 * at most 1080 (more is never seen, and each pass works through every pixel).
 */
const PREVIEW_EDGE = Math.min(
  1080,
  Math.max(320, Math.round(PixelRatio.getPixelSizeForLayoutSize(Math.max(Dimensions.get("window").width, Dimensions.get("window").height)) || 1080)),
);
/** How long after the finger lifts (and the filter settles) the exact filtered photo is worked out. */
const FILTER_SETTLE_MS = 300;
/**
 * Runs `work` once the JS thread is idle (requestIdleCallback; InteractionManager is gone from
 * React Native), or a little later where the runtime doesn't have it.
 */
function whenIdle(work: () => void): { cancel: () => void } {
  const g = globalThis as {
    requestIdleCallback?: (cb: () => void, options?: { timeout: number }) => number;
    cancelIdleCallback?: (handle: number) => void;
  };
  if (typeof g.requestIdleCallback === "function") {
    const handle = g.requestIdleCallback(work, { timeout: 2000 });
    return { cancel: () => g.cancelIdleCallback?.(handle) };
  }
  const timer = setTimeout(work, 500);
  return { cancel: () => clearTimeout(timer) };
}
/** Below this screen width the top tools shrink so all of them fit beside Close. */
const COMPACT_WIDTH = 370;

/**
 * What to tell the person when their Story couldn't be added to the upload queue. The queue's own
 * reasons (too large, too many pending) are said as they are; only a real network failure is
 * blamed on the connection.
 */
export function shareErrorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  const message = err instanceof Error ? err.message : "";
  if (err instanceof TypeError || /network|internet|offline|timed? ?out/i.test(message)) {
    return "Sharing failed — check your connection and try again.";
  }
  // The upload queue's reasons are short sentences meant for people; a raw system error isn't.
  if (/^[A-Z][^\n]{0,160}[.!]$/.test(message) && !/^E[A-Z]+[:\s]/.test(message)) return message;
  return "Couldn't get your Story ready to share. Try again.";
}

/**
 * Story editor (spec sections 19-30): text/emoji/mention/location/datetime/
 * sticker overlays sharing one gesture model, freehand drawing, filters,
 * discard protection, and real publishing that actually sends every one of
 * those edits to the backend (see onShare — this used to silently drop
 * overlays and the chosen filter on publish, the single most important
 * correctness bug this module closes; see backend migration 0015).
 */
/** The "Swipe for filters" hint shows once per app run. */
let filterHintShown = false;

/** Media already counted as a started Story in this app run. */
const startedStories = new Set<string>();

export function StoryEditorScreen({ route, navigation }: Props): React.JSX.Element {
  useMediaStatusBar();
  const { mediaUri, kind, mimeType } = route.params;
  // A Boomerang plays forward and back with no sound; the server makes it while processing.
  const boomerang = kind === "video" && route.params.effect === "boomerang";
  const { accessToken,user } = useAuth();
  const insets = useScreenInsets();
  const screenReader = useScreenReader();
  // A narrow phone (320–360 wide) can't fit seven 42-point tools beside Close: they shrink.
  const compact = useWindowDimensions().width < COMPACT_WIDTH;
  const toolButtonStyle = compact ? [styles.toolButton, styles.toolButtonCompact] : styles.toolButton;
  const topIconStyle = compact ? [styles.topIcon, styles.topIconCompact] : styles.topIcon;
  const submittingUpload=useRef(false);
  const rootNavigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [audience, setAudience] = useState<Audience>("public");
  // Who can comment and share, remembered from your last Story (Story settings sheet).
  const [settings, setSettings] = useState<StorySettings>(DEFAULT_STORY_SETTINGS);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // This Story's topic (Story settings sheet): chosen for each Story, never remembered for the next.
  const [topic, setTopic] = useState<string | null>(null);
  useEffect(() => {
    void loadStorySettings().then((saved) => {
      setSettings(saved);
      setAudience((current) => (current === "close_friends" ? current : saved.visibility));
    });
  }, []);
  const changeSettings = (next: StorySettings) => {
    setSettings(next);
    setAudience(next.visibility);
    saveStorySettings(next);
  };

  const [draft, setDraft] = useState(() => createEmptyDraft({ uri: mediaUri, kind, width: route.params.width, height: route.params.height }));
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [textModalVisible, setTextModalVisible] = useState(false);
  const [stickerSheetVisible, setStickerSheetVisible] = useState(false);
  const [stickerTab, setStickerTab] = useState<StickerTab | undefined>(undefined);
  // A song on the Story (like Instagram): it plays while you edit.
  const [music, setMusic] = useState<ChosenMusic | null>(null);
  const [musicSheetVisible, setMusicSheetVisible] = useState(false);
  const focused = useIsFocused();
  // The Music button shows once the library has songs.
  const [musicAvailable, setMusicAvailable] = useState(false);
  useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;
    listMusic(accessToken)
      .then((r) => { if (!cancelled) setMusicAvailable(r.tracks.length > 0); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [accessToken]);
  const [drawMode, setDrawMode] = useState(false);
  const [cropMode, setCropMode] = useState(false);
  const [editingOverlayId, setEditingOverlayId] = useState<string | null>(null);
  const [editingStickerOverlayId, setEditingStickerOverlayId] = useState<string | null>(null);
  const [selectedOverlayId, setSelectedOverlayId] = useState<string | null>(null);
  const [isDraggingOverlay, setIsDraggingOverlay] = useState(false);
  const [overTrash, setOverTrash] = useState(false);
  const [guides, setGuides] = useState({ x: false, y: false });
  // Whether you have anyone on your Close Friends list (sharing to an empty list reaches no one).
  const [hasCloseFriends, setHasCloseFriends] = useState<boolean | null>(null);
  useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;
    listCloseFriends(accessToken, { limit: 1 })
      .then((r) => { if (!cancelled) setHasCloseFriends(r.closeFriends.length > 0); })
      .catch(() => { if (!cancelled) setHasCloseFriends(null); });
    return () => { cancelled = true; };
  }, [accessToken]);
  // "Your story" goes to everyone or to followers only; Close Friends has its own button.
  const storyAudience: Audience = audience === "followers" ? "followers" : "public";
  // The object two fingers on the photo resize and rotate: the last one touched or added.
  const activeOverlayId = useRef<string | null>(null);
  const [uploadState, setUploadState] = useState<"idle" | "uploading" | "done" | "error">("idle");
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [filterToastName, setFilterToastName] = useState<string | null>(null);
  // The photo as it will be published: the filter applied on the phone with the server's own
  // arithmetic (utils/filterPhoto.ts). It takes a moment per filter, so while it is worked out
  // the photo shows the filter's light tint at once and the exact picture fades in over it.
  const [processedPhoto, setProcessedPhoto] = useState<{ filter: string; uri: string } | null>(null);
  const [shownProcessedFilter, setShownProcessedFilter] = useState<string | null>(null);

  const nextZIndex = useRef(1);
  const filterToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [restored, setRestored] = useState(false);

  useEffect(() => {
    return () => {
      if (filterToastTimer.current) clearTimeout(filterToastTimer.current);
    };
  }, []);

  // Whether a finger is on the photo (swiping filters or pinching): working out a filter blocks
  // the JS thread that follows the finger, so it waits until the finger lifts.
  const fingerDown = useRef(false);
  const afterFingerUp = useRef<(() => void) | null>(null);
  // The way the last swipe went, so the next filter that way is the one got ready.
  const swipeDirection = useRef<1 | -1>(1);

  useEffect(() => {
    if (kind !== "photo" || draft.filter === "Original") return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let prefetch: { cancel: () => void } | null = null;
    const filter = draft.filter;
    const index = FILTER_PREVIEWS.findIndex((f) => f.name === filter);
    const neighbour = (step: number) => FILTER_PREVIEWS[(index + step + FILTER_PREVIEWS.length) % FILTER_PREVIEWS.length]!.name;
    const run = () => {
      if (cancelled) return;
      if (fingerDown.current) {
        afterFingerUp.current = schedule;
        return;
      }
      filteredPhotoUri(mediaUri, filterKey(filter) as FilterKey, PREVIEW_EDGE)
        .then((uri) => {
          if (cancelled) return;
          setProcessedPhoto({ filter, uri });
          // Then, once nothing is moving, the next filter in the direction of the swipe.
          prefetch = whenIdle(() => {
            if (cancelled || fingerDown.current) return;
            const next = neighbour(swipeDirection.current);
            if (next !== "Original") void filteredPhotoUri(mediaUri, filterKey(next) as FilterKey, PREVIEW_EDGE).catch(() => undefined);
          });
        })
        // Couldn't process it on this phone: the tint stays on.
        .catch(() => undefined);
    };
    // Wait for swiping to settle (and the finger to lift), then work out this filter.
    function schedule() {
      if (timer) clearTimeout(timer);
      timer = setTimeout(run, FILTER_SETTLE_MS);
    }
    schedule();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      prefetch?.cancel();
      if (afterFingerUp.current === schedule) afterFingerUp.current = null;
    };
  }, [kind, mediaUri, draft.filter]);

  useEffect(() => () => forgetFilteredPhoto(mediaUri), [mediaUri]);

  // Admin analytics: a Story started in the editor (once per photo or video, even if the
  // editor reopens for the same draft).
  useEffect(() => {
    if (startedStories.has(mediaUri)) return;
    startedStories.add(mediaUri);
    track("story_created", { mediaKind: kind });
  }, [mediaUri, kind]);

  // Crash-safe autosave (spec section 42: "persist local draft" as its own
  // step, not just React state). Restore-on-mount runs once, before the
  // autosave effect below is allowed to write anything — otherwise the
  // freshly-mounted empty draft would overwrite a real saved one before
  // it's ever read.
  useEffect(() => {
    let cancelled = false;
    if (!user) return;
    loadPendingDraft(user.id, mediaUri).then((saved) => {
      if (cancelled) return;
      if (saved && hasMeaningfulEdits(saved.draft)) {
        setDraft(saved.draft);
        setAudience(saved.audience);
        if (saved.audience !== "close_friends") setSettings((current) => ({ ...current, visibility: saved.audience as StoryVisibility }));
        setTopic(saved.topic ?? null);
      }
      setRestored(true);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mediaUri, user?.id]);

  useEffect(() => {
    if (!restored || !user) return;
    const timer = setTimeout(() => {
      if (hasMeaningfulEdits(draft)) {
        void savePendingDraft(user.id, mediaUri, { draft, audience, mimeType, savedAt: new Date().toISOString(), ...(topic ? { topic } : {}) });
      } else {
        void clearPendingDraft(user.id, mediaUri);
      }
    }, 800);
    return () => clearTimeout(timer);
  }, [restored, draft, audience, topic, mediaUri, mimeType, user?.id]);

  const onContainerLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setContainerSize({ width, height });
  };

  const isOverTrash = useCallback(
    (pageX: number, pageY: number) => {
      // The trash sits bottom-centre of the full-screen editor, above the home indicator; a little
      // extra room around it so a finger doesn't have to land exactly on it.
      const slop = 24;
      const zoneLeft = containerSize.width / 2 - TRASH_ZONE_SIZE / 2 - slop;
      const zoneTop = containerSize.height - TRASH_ZONE_SIZE - spacing.xl - insets.bottom - slop;
      const size = TRASH_ZONE_SIZE + slop * 2;
      return pageX >= zoneLeft && pageX <= zoneLeft + size && pageY >= zoneTop && pageY <= zoneTop + size;
    },
    [containerSize, insets.bottom],
  );

  const addOrUpdateText = (text: string, properties: TextOverlayProperties) => {
    if (editingOverlayId) {
      setDraft((d) => ({
        ...d,
        overlays: d.overlays.map((o) => (o.id === editingOverlayId && o.type === "text" ? { ...o, properties } : o)),
      }));
    } else {
      const overlay: Overlay = {
        id: `text-${Date.now()}`,
        type: "text",
        x: 0.5,
        y: 0.5,
        scale: 1,
        rotation: 0,
        zIndex: nextZIndex.current++,
        properties,
      };
      activeOverlayId.current = overlay.id;
      setDraft((d) => ({ ...d, overlays: [...d.overlays, overlay] }));
    }
    setEditingOverlayId(null);
    setTextModalVisible(false);
  };

  // Today's festival: a greeting in the sticker sheet, and public Stories can join its ring.
  const festival = useFestival().current?.festival ?? null;
  const [joinFestival, setJoinFestival] = useState(true);

  const addSticker = useCallback((payload: StickerAddPayload) => {
    const overlay = {
      id: `${payload.type}-${Date.now()}`,
      x: 0.5,
      y: 0.5,
      scale: 1,
      rotation: 0,
      zIndex: nextZIndex.current++,
      ...payload,
    } as Overlay;
    activeOverlayId.current = overlay.id;
    setDraft((d) => ({ ...d, overlays: [...d.overlays, overlay] }));
  }, []);

  const updateOverlay = useCallback((id: string, patch: Partial<Pick<Overlay, "x" | "y" | "scale" | "rotation">>) => {
    setDraft((d) => ({ ...d, overlays: d.overlays.map((o) => (o.id === id ? { ...o, ...patch } : o)) }));
  }, []);

  /** Location/date-time content edit — geometry (position/scale/rotation) stays exactly where it was. */
  const updateOverlayContent = useCallback((id: string, properties: LocationOverlayProperties | DateTimeOverlayProperties) => {
    setDraft((d) => ({
      ...d,
      overlays: d.overlays.map((o) => ((o.type === "location" || o.type === "datetime") && o.id === id ? ({ ...o, properties } as Overlay) : o)),
    }));
  }, []);

  const deleteOverlay = useCallback((id: string) => {
    setDraft((d) => ({ ...d, overlays: d.overlays.filter((o) => o.id !== id) }));
  }, []);

  const editingOverlay = draft.overlays.find((o) => o.id === editingOverlayId && o.type === "text") as
    | (Overlay & { type: "text" })
    | undefined;

  const selectedOverlay = draft.overlays.find((o) => o.id === selectedOverlayId) ?? null;

  const editingStickerOverlay = draft.overlays.find((o) => o.id === editingStickerOverlayId) ?? null;

  const openStickerEditor = useCallback((id: string) => {
    setEditingStickerOverlayId(id);
    setStickerSheetVisible(true);
  }, []);

  const activeFilter = useMemo(() => FILTER_PREVIEWS.find((f) => f.name === draft.filter) ?? FILTER_PREVIEWS[0], [draft.filter]);

  const showFilterToast = useCallback((name: string) => {
    setFilterToastName(name);
    if (filterToastTimer.current) clearTimeout(filterToastTimer.current);
    filterToastTimer.current = setTimeout(() => setFilterToastName(null), 900);
  }, []);

  useEffect(() => {
    if (filterHintShown) return;
    filterHintShown = true;
    showFilterToast("Swipe for filters");
  }, [showFilterToast]);

  const currentFilter = useRef(draft.filter);
  currentFilter.current = draft.filter;
  const cycleFilter = useCallback(
    (direction: 1 | -1) => {
      swipeDirection.current = direction;
      const currentIndex = FILTER_PREVIEWS.findIndex((f) => f.name === currentFilter.current);
      const next = FILTER_PREVIEWS[(currentIndex + direction + FILTER_PREVIEWS.length) % FILTER_PREVIEWS.length]!;
      currentFilter.current = next.name;
      showFilterToast(next.name);
      tapFeedback("select");
      setDraft((d) => ({ ...d, filter: next.name }));
    },
    [showFilterToast],
  );

  /** Touching an object brings it to the front and makes it the one two fingers on the photo act on. */
  const raiseOverlay = useCallback((id: string) => {
    activeOverlayId.current = id;
    setDraft((d) => {
      const top = Math.max(0, ...d.overlays.map((o) => o.zIndex));
      const target = d.overlays.find((o) => o.id === id);
      if (!target || target.zIndex === top) return d;
      nextZIndex.current = top + 2;
      return { ...d, overlays: d.overlays.map((o) => (o.id === id ? { ...o, zIndex: top + 1 } : o)) };
    });
  }, []);

  const overlaysRef = useRef(draft.overlays);
  overlaysRef.current = draft.overlays;
  /** A tap on an object: text opens for editing, a location or date opens its editor. */
  const editOverlay = useCallback(
    (id: string) => {
      const o = overlaysRef.current.find((x) => x.id === id);
      if (o?.type === "text") {
        setEditingOverlayId(id);
        setTextModalVisible(true);
      } else if (o?.type === "location" || o?.type === "datetime") {
        openStickerEditor(id);
      }
    },
    [openStickerEditor],
  );

  // Stable callbacks for the objects on the photo, so moving one doesn't redraw the others.
  const onOverlayDeleted = useCallback(
    (id: string) => {
      deleteOverlay(id);
      setSelectedOverlayId((s) => (s === id ? null : s));
    },
    [deleteOverlay],
  );
  const onOverTrashChange = useCallback((over: boolean) => {
    if (over) tapFeedback("tap");
    setOverTrash(over);
  }, []);
  const openOverlayControls = useCallback((id: string) => setSelectedOverlayId(id), []);

  // Each object's way of showing a live place while two fingers on the photo move it; the place
  // is committed to the draft once, when the fingers lift.
  const liveOverlays = useRef(new Map<string, (placement: Placement | null) => void>());
  const registerLiveOverlay = useCallback((id: string, show: ((placement: Placement | null) => void) | null) => {
    if (show) liveOverlays.current.set(id, show);
    else liveOverlays.current.delete(id);
  }, []);

  // The photo itself (like Instagram): swipe sideways to change the filter as the finger moves,
  // tap to add text, and pinch with two fingers to resize and turn the last object touched. Objects
  // sit above this layer and take their own touches first. It must stay a real native view
  // (`collapsable={false}`): an empty view is dropped on Android and touches fall through.
  const canvasLatest = useRef({ cycleFilter, draft, containerSize });
  canvasLatest.current = { cycleFilter, draft, containerSize };
  const canvasGesture = useMemo(() => {
    let steps = 0;
    let moved = false;
    let pinch: { id: string; start: Placement; from: [Touch, Touch]; now?: Placement } | null = null;
    let pinched = false;
    let swipeStart = { x: 0, y: 0 };
    const touchesOf = (evt: GestureResponderEvent): Touch[] => evt.nativeEvent.touches.map((t) => ({ pageX: t.pageX, pageY: t.pageY }));
    /** Commits a pinch's last place (once, as the fingers lift) and stops the live one. */
    const endPinch = () => {
      if (pinch?.now) {
        updateOverlay(pinch.id, pinch.now);
        liveOverlays.current.get(pinch.id)?.(null);
      }
      pinch = null;
    };
    const fingerUp = () => {
      fingerDown.current = false;
      const pending = afterFingerUp.current;
      afterFingerUp.current = null;
      pending?.();
    };
    const startPinch = (touches: Touch[]) => {
      const id = activeOverlayId.current;
      const o = canvasLatest.current.draft.overlays.find((x) => x.id === id);
      pinch = o ? { id: o.id, start: { x: o.x, y: o.y, scale: o.scale, rotation: o.rotation }, from: [touches[0]!, touches[1]!] } : null;
      pinched = true;
    };
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (evt) => {
        steps = 0;
        moved = false;
        pinched = false;
        pinch = null;
        fingerDown.current = true;
        swipeStart = { x: evt.nativeEvent.pageX, y: evt.nativeEvent.pageY };
        const touches = touchesOf(evt);
        if (touches.length >= 2) startPinch(touches);
      },
      onPanResponderMove: (evt) => {
        const touches = touchesOf(evt);
        if (touches.length >= 2) {
          if (!pinch) startPinch(touches);
          if (!pinch) return;
          const { width, height } = canvasLatest.current.containerSize;
          const next = pinchPlacement(pinch.start, pinch.from, [touches[0]!, touches[1]!], width, height);
          pinch.now = { ...next, ...clampOverlayPosition(next.x, next.y) };
          liveOverlays.current.get(pinch.id)?.(pinch.now);
          return;
        }
        if (pinched || touches.length === 0) return;
        const dx = touches[0]!.pageX - swipeStart.x;
        const dy = touches[0]!.pageY - swipeStart.y;
        if (Math.hypot(dx, dy) > TAP_SLOP) moved = true;
        // Each further swipe distance moves one more filter, while the finger is still down.
        const step = filterSwipeStep(dx, dy);
        if (step !== 0) {
          canvasLatest.current.cycleFilter(step === -1 ? 1 : -1);
          steps += 1;
          swipeStart = { x: touches[0]!.pageX, y: touches[0]!.pageY };
        }
      },
      onPanResponderRelease: () => {
        if (!moved && !pinched && steps === 0) {
          // The first tap with the caption keyboard open only closes it.
          if (Keyboard.isVisible()) Keyboard.dismiss();
          else {
            setEditingOverlayId(null);
            setTextModalVisible(true);
          }
        }
        endPinch();
        fingerUp();
      },
      onPanResponderTerminate: () => {
        endPinch();
        fingerUp();
      },
    });
  }, [updateOverlay]);

  const confirmDiscard = useCallback(
    (onDiscard: () => void) => {
      if (!hasMeaningfulEdits(draft) && !music) {
        onDiscard();
        return;
      }
      Alert.alert("Discard Story?", undefined, [
        { text: "Keep Editing", style: "cancel" },
        { text: "Discard", style: "destructive", onPress: onDiscard },
      ]);
    },
    [draft, music],
  );

  // Discarding goes back to the camera (like Instagram). The camera was replaced by this
  // editor, so going "back" used to leave the Create tab with the discarded photo still open
  // behind it, and it came back the next time you tapped +.
  const onClose = () =>
    confirmDiscard(() => {
      if (user) void clearPendingDraft(user.id, mediaUri);
      navigation.reset({ index: 0, routes: [{ name: "Camera" }] });
    });
  const onCloseRef = useRef(onClose);
  onCloseRef.current = () => {
    // Back leaves drawing or cropping first, like their Done buttons.
    if (drawMode) setDrawMode(false);
    else if (cropMode) setCropMode(false);
    else onClose();
  };

  // Android's back button asks before throwing edits away, the same as the close button.
  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener("hardwareBackPress", () => {
        onCloseRef.current();
        return true;
      });
      return () => sub.remove();
    }, []),
  );

  const onShare = async (target: Audience = audience) => {
    if (!accessToken||!user||submittingUpload.current) return;
    submittingUpload.current=true;
    setAudience(target);
    setUploadState("uploading");
    setUploadError(null);
    try {
      await enqueueUpload(user.id,mediaUri,kind,mimeType,
        {
          caption: draft.caption,
          audience: target,
          allowComments: settings.allowComments,
          allowSharing: settings.allowSharing,
          overlays: draft.overlays,
          drawing: draft.drawing,
          filter: filterKey(draft.filter),
          audioMuted: draft.audioMuted,
          crop: draft.crop,
          ...(music ? { music: { trackId: music.track.id, startMs: music.startMs, durationMs: music.durationMs } } : {}),
          // Public festival Stories join the festival's ring on Home.
          ...(festival && joinFestival && target === "public" ? { festival: festival.slug } : {}),
          ...(topic ? { topic } : {}),
        },
        boomerang ? "boomerang" : undefined,
      );
      setUploadState("done");
      tapFeedback("success");
      void clearPendingDraft(user.id, mediaUri);
      // Back to Home, where a small status shows the Story sharing (components/UploadStatusPill).
      rootNavigation.reset({ index: 0, routes: [{ name: "Main" }] });
    } catch (err) {
      // Nothing is lost on failure — `draft` (media uri, overlays, drawing,
      // filter, caption, audience) stays exactly as it was so Retry can
      // simply call onShare again (spec section 43).
      setUploadState("error");
      setUploadError(shareErrorMessage(err));
    } finally {
      submittingUpload.current=false;
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.mediaContainer} onLayout={onContainerLayout}>
        {kind === "photo" ? (
          <>
            <Image
              source={{ uri: mediaUri }}
              style={[StyleSheet.absoluteFill, mediaTransformStyle(draft.crop, containerSize.width, containerSize.height)]}
              resizeMode="cover"
            />
            {processedPhoto && processedPhoto.filter === draft.filter ? (
              <Image
                key={processedPhoto.uri}
                source={{ uri: processedPhoto.uri }}
                onLoad={() => setShownProcessedFilter(processedPhoto.filter)}
                fadeDuration={0}
                style={[
                  StyleSheet.absoluteFill,
                  mediaTransformStyle(draft.crop, containerSize.width, containerSize.height),
                  shownProcessedFilter === processedPhoto.filter ? null : styles.hidden,
                ]}
                resizeMode="cover"
              />
            ) : null}
          </>
        ) : (
          <Video
            source={{ uri: mediaUri }}
            style={[StyleSheet.absoluteFill, mediaTransformStyle(draft.crop, containerSize.width, containerSize.height)]}
            resizeMode="cover"
            repeat
            muted={boomerang || draft.audioMuted}
            rate={boomerang ? 1.5 : 1}
            paused={false}
          />
        )}

        {activeFilter.overlayOpacity > 0 && (kind === "video" || shownProcessedFilter !== draft.filter) ? (
          <View
            pointerEvents="none"
            style={[StyleSheet.absoluteFill, { backgroundColor: activeFilter.overlayColor, opacity: activeFilter.overlayOpacity }]}
          />
        ) : null}

        {!drawMode && !cropMode ? (
          <View
            style={StyleSheet.absoluteFill}
            collapsable={false}
            {...canvasGesture.panHandlers}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          />
        ) : null}

        {boomerang ? (
          <View style={styles.boomerangBadge} pointerEvents="none">
            <Text style={styles.boomerangLabel} accessibilityLabel="Boomerang. It loops back and forth once you share it.">Boomerang</Text>
          </View>
        ) : null}

        {filterToastName ? (
          <View style={styles.filterToast} pointerEvents="none">
            <Text style={styles.filterToastLabel}>{filterToastName}</Text>
          </View>
        ) : null}

        {containerSize.width > 0 && cropMode ? (
          <CropGestureLayer
            crop={draft.crop}
            containerWidth={containerSize.width}
            containerHeight={containerSize.height}
            onChange={(crop) => setDraft((d) => ({ ...d, crop }))}
          />
        ) : null}

        {containerSize.width > 0 && !drawMode && !cropMode
          ? // The text being edited is shown only in the text tool, never twice.
            draft.overlays.filter((o) => !(textModalVisible && o.id === editingOverlayId)).map((overlay) => (
              <DraggableCanvasObject
                key={overlay.id}
                overlay={overlay}
                containerWidth={containerSize.width}
                containerHeight={containerSize.height}
                isOverTrash={isOverTrash}
                onChange={updateOverlay}
                onDeleted={onOverlayDeleted}
                onDragStateChange={setIsDraggingOverlay}
                onOverTrashChange={onOverTrashChange}
                onTouchStart={raiseOverlay}
                onGuidesChange={setGuides}
                onTap={editOverlay}
                onOpenControls={openOverlayControls}
                registerLive={registerLiveOverlay}
              />
            ))
          : containerSize.width > 0
            ? // While drawing or cropping, overlays render statically (no gesture handlers) so drag/pinch never fights with those gestures.
              draft.overlays.map((overlay) => (
                <PlacedOverlay key={overlay.id} overlay={overlay} containerWidth={containerSize.width} containerHeight={containerSize.height} pointerEvents="none">
                  <OverlayBody overlay={overlay} containerWidth={containerSize.width} containerHeight={containerSize.height} />
                </PlacedOverlay>
              ))
            : null}

        {containerSize.width > 0 && drawMode ? (
          <DrawingCanvas
            containerWidth={containerSize.width}
            containerHeight={containerSize.height}
            strokes={draft.drawing}
            onChangeStrokes={(strokes) => setDraft((d) => ({ ...d, drawing: strokes }))}
            onDone={() => setDrawMode(false)}
            insets={{ top: insets.top, bottom: insets.bottom }}
          />
        ) : null}

        {/* Centre guides while dragging, like Instagram. */}
        {guides.x ? <View pointerEvents="none" style={styles.guideVertical} /> : null}
        {guides.y ? <View pointerEvents="none" style={styles.guideHorizontal} /> : null}

        {isDraggingOverlay ? (
          <View
            pointerEvents="none"
            style={[styles.trashZone, overTrash && styles.trashZoneActive, { width: TRASH_ZONE_SIZE, height: TRASH_ZONE_SIZE, bottom: spacing.xl + insets.bottom }]}
          >
            <Icon style={styles.trashIcon} name={ICONS.trash} />
          </View>
        ) : null}
      </View>

      {cropMode ? (
        <>
          <View style={[styles.topBar, { top: insets.top + spacing.md }]}>
            <Text style={styles.cropHint}>Pinch to zoom · Drag to reposition</Text>
            <Pressable
              onPress={() => setCropMode(false)}
              hitSlop={12}
              style={styles.cropDoneButton}
              accessibilityRole="button"
              accessibilityLabel="Done cropping"
            >
              <Text style={styles.cropDoneLabel}>Done</Text>
            </Pressable>
          </View>
          {/* Pinch and drag crop the photo; the step buttons are for a screen reader. */}
          {screenReader ? (
            <View style={[styles.cropControlsBar, { bottom: spacing.xxl + insets.bottom }]}>
              <CropAdjustControls crop={draft.crop} onChange={(crop) => setDraft((d) => ({ ...d, crop }))} />
            </View>
          ) : null}
        </>
      ) : null}

      {!drawMode && !cropMode && !isDraggingOverlay && !textModalVisible ? (
        <View style={[styles.topBar, { top: insets.top + spacing.md }]}>
          <Pressable onPress={onClose} hitSlop={8} style={toolButtonStyle} accessibilityRole="button" accessibilityLabel="Close editor">
            <Icon style={topIconStyle} name={ICONS.close} />
          </Pressable>
          <View style={[styles.topRight, compact && styles.topRightCompact]}>
            <Pressable onPress={() => setCropMode(true)} hitSlop={8} style={toolButtonStyle} accessibilityRole="button" accessibilityLabel="Crop">
              <Icon style={topIconStyle} name={ICONS.crop} />
            </Pressable>
            <Pressable
              onPress={() => {
                setEditingOverlayId(null);
                setTextModalVisible(true);
              }}
              hitSlop={8} style={toolButtonStyle}
              accessibilityRole="button"
              accessibilityLabel="Add text"
            >
              <Icon style={topIconStyle} name={ICONS.text} />
            </Pressable>
            <Pressable
              onPress={() => {
                setEditingStickerOverlayId(null);
                setStickerTab(undefined);
                setStickerSheetVisible(true);
              }}
              hitSlop={8} style={toolButtonStyle}
              accessibilityRole="button"
              accessibilityLabel="Add sticker, emoji, mention, location, or date and time"
            >
              <Icon style={topIconStyle} name={ICONS.sticker} />
            </Pressable>
            {/* Tagging a friend is one tap, not a tab inside the sticker sheet. */}
            <Pressable
              onPress={() => {
                setEditingStickerOverlayId(null);
                setStickerTab("mention");
                setStickerSheetVisible(true);
              }}
              hitSlop={8} style={toolButtonStyle}
              accessibilityRole="button"
              accessibilityLabel="Mention someone"
            >
              <Icon style={topIconStyle} name={ICONS.mention} />
            </Pressable>
            <Pressable onPress={() => setDrawMode(true)} hitSlop={8} style={toolButtonStyle} accessibilityRole="button" accessibilityLabel="Draw">
              <Icon style={topIconStyle} name={ICONS.draw} />
            </Pressable>
            {musicAvailable || music ? <Pressable onPress={() => setMusicSheetVisible(true)} hitSlop={8} style={[toolButtonStyle, music && styles.toolButtonOn]} accessibilityRole="button" accessibilityLabel={music ? `Music: ${music.track.title}. Change` : "Add music"}>
              <Icon style={[topIconStyle, music && styles.topIconOn]} name={ICONS.music} />
            </Pressable> : null}
            {kind === "video" && !boomerang ? (
              <Pressable
                onPress={() => setDraft((d) => ({ ...d, audioMuted: !d.audioMuted }))}
                hitSlop={8} style={toolButtonStyle}
                accessibilityRole="button"
                accessibilityLabel={draft.audioMuted ? "Audio muted, tap to turn on" : "Audio on, tap to mute"}
              >
                <Icon style={topIconStyle} name={draft.audioMuted ? ICONS.audioMuted : ICONS.audioOn} />
              </Pressable>
            ) : null}
          </View>
        </View>
      ) : null}

      {music && !drawMode && !cropMode && !isDraggingOverlay && !textModalVisible ? (
        <View style={[styles.musicChipRow, { top: insets.top + spacing.md + 56 }]} pointerEvents="box-none">
          <Pressable style={styles.musicChip} onPress={() => setMusicSheetVisible(true)} accessibilityRole="button" accessibilityLabel={`${music.track.title} by ${music.track.artist}. Change the part that plays`}>
            <Icon name={ICONS.music} size={14} color="#FFFFFF" />
            <Text style={styles.musicChipText} numberOfLines={1}>{music.track.title} · {music.track.artist}</Text>
          </Pressable>
          <Pressable style={styles.musicRemove} onPress={() => setMusic(null)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Remove music">
            <Icon name={ICONS.close} size={14} color="#FFFFFF" />
          </Pressable>
        </View>
      ) : null}
      {music ? (
        <MusicPlayer url={music.track.url} accessToken={accessToken} startMs={music.startMs} durationMs={music.durationMs} paused={!focused || musicSheetVisible || uploadState !== "idle"} />
      ) : null}

      {!drawMode && !cropMode && !isDraggingOverlay && !textModalVisible ? (
        // Lifted above the keyboard while the caption is typed (the canvas behind stays put).
        <KeyboardAvoider
          behavior="position"
          style={[styles.bottomArea, { bottom: spacing.xl + insets.bottom }]}
          contentContainerStyle={styles.bottomAreaContent}
        >
          {/* Filters change by swiping the photo (like Instagram); a screen reader gets buttons instead. */}
          {screenReader ? (
            <View style={styles.filterButtons}>
              <Pressable onPress={() => cycleFilter(-1)} style={styles.filterButton} accessibilityRole="button" accessibilityLabel="Previous filter">
                <Icon name={ICONS.left} size={18} color={colors.textPrimary} />
              </Pressable>
              <Text style={styles.filterName} accessibilityLiveRegion="polite">{draft.filter}</Text>
              <Pressable onPress={() => cycleFilter(1)} style={styles.filterButton} accessibilityRole="button" accessibilityLabel="Next filter">
                <Icon name={ICONS.right} size={18} color={colors.textPrimary} />
              </Pressable>
            </View>
          ) : null}

          <TextInput
            style={styles.captionInput}
            accessibilityLabel="Caption"
            placeholder="Add a caption…"
            placeholderTextColor="rgba(255,255,255,0.5)"
            value={draft.caption}
            onChangeText={(text) => setDraft((d) => ({ ...d, caption: text }))}
            maxLength={280}
            returnKeyType="done"
          />

          {/* One quiet line for who can see, comment and share; the choices are in a sheet. */}
          <Pressable
            onPress={() => setSettingsOpen(true)}
            hitSlop={8}
            style={styles.visibility}
            accessibilityRole="button"
            accessibilityLabel={`Story settings: ${storySettingsSummary({ ...settings, visibility: storyAudience }, festival && joinFestival && storyAudience === "public" ? festival.name : null, topic)}`}
          >
            <Text style={styles.visibilityLabel} numberOfLines={1}>{storySettingsSummary({ ...settings, visibility: storyAudience }, festival && joinFestival && storyAudience === "public" ? festival.name : null, topic)}</Text>
            <Icon name={ICONS.chevron} size={14} color={colors.textPrimary} />
          </Pressable>

          {uploadError ? (
            <View>
              <Text style={styles.uploadError}>{uploadError}</Text>
              <Pressable style={styles.retryButton} onPress={() => void onShare()} accessibilityRole="button">
                <Text style={styles.retryButtonLabel}>Retry</Text>
              </Pressable>
            </View>
          ) : null}


          {/* Like Instagram: one tap shares to Your story or to Close Friends. */}
          <View style={styles.shareRow}>
            <Pressable
              style={[styles.shareButton, styles.shareYourStory, uploadState === "uploading" && styles.uploadButtonDisabled]}
              disabled={uploadState === "uploading" || uploadState === "done"}
              onPress={() => void onShare(storyAudience)}
              accessibilityRole="button"
              accessibilityLabel={`Share to Your story, ${storyAudience === "public" ? "everyone" : "followers only"}`}
              accessibilityState={{ busy: uploadState === "uploading" && audience !== "close_friends" }}
            >
              {uploadState === "uploading" && audience !== "close_friends" ? (
                <ActivityIndicator color={colors.background} />
              ) : (
                <>
                  <Avatar username={user?.username ?? ""} avatarMediaId={user?.avatarMediaId} size={24} />
                  <Text style={styles.shareYourStoryLabel} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>Your story</Text>
                </>
              )}
            </Pressable>
            <Pressable
              style={[styles.shareButton, styles.shareCloseFriends, uploadState === "uploading" && styles.uploadButtonDisabled]}
              disabled={uploadState === "uploading" || uploadState === "done"}
              onPress={() => {
                if (hasCloseFriends === false) {
                  Alert.alert("No Close Friends yet", "Add people to your Close Friends list, then share to them.", [
                    { text: "Not now", style: "cancel" },
                    { text: "Add people", onPress: () => rootNavigation.navigate("CloseFriends") },
                  ]);
                  return;
                }
                void onShare("close_friends");
              }}
              onLongPress={() => rootNavigation.navigate("CloseFriends")}
              accessibilityRole="button"
              accessibilityLabel="Share to Close Friends"
              accessibilityHint="Long press to edit your Close Friends list"
              accessibilityState={{ busy: uploadState === "uploading" && audience === "close_friends" }}
            >
              {uploadState === "uploading" && audience === "close_friends" ? (
                <ActivityIndicator color={colors.onAccent} />
              ) : (
                <>
                  <Icon name={ICONS.starFilled} size={18} color={colors.onAccent} />
                  <Text style={styles.shareCloseFriendsLabel} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>Close Friends</Text>
                </>
              )}
            </Pressable>
          </View>
        </KeyboardAvoider>
      ) : null}

      <StorySettingsSheet
        visible={settingsOpen}
        settings={{ ...settings, visibility: storyAudience }}
        onChange={changeSettings}
        onClose={() => setSettingsOpen(false)}
        festival={festival}
        joinFestival={joinFestival}
        onJoinFestival={setJoinFestival}
        topic={topic}
        onTopicChange={setTopic}
      />
      <TextToolModal
        // Starts fresh each time it opens: new text, or the text being edited.
        key={textModalVisible ? editingOverlayId ?? "new" : "closed"}
        visible={textModalVisible}
        initialText={editingOverlay?.properties.text}
        initialProperties={editingOverlay?.properties}
        onCancel={() => {
          setTextModalVisible(false);
          setEditingOverlayId(null);
        }}
        onDone={addOrUpdateText}
        canvasHeight={containerSize.height}
      />
      <MusicSheet visible={musicSheetVisible} current={music} onClose={() => setMusicSheetVisible(false)} onChoose={setMusic} />
      <StickerSheet
        visible={stickerSheetVisible}
        onClose={() => {
          setStickerSheetVisible(false);
          setEditingStickerOverlayId(null);
        }}
        onAdd={addSticker}
        festival={festival}
        editingOverlay={editingStickerOverlay}
        initialTab={stickerTab}
        onEditDone={updateOverlayContent}
      />
      <OverlayAdjustSheet
        overlay={selectedOverlay}
        onChange={updateOverlay}
        onEditText={(id) => {
          setEditingOverlayId(id);
          setTextModalVisible(true);
        }}
        onEditLocationOrDateTime={openStickerEditor}
        onDelete={(id) => deleteOverlay(id)}
        onClose={() => setSelectedOverlayId(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
  mediaContainer: { flex: 1 },
  topBar: {
    position: "absolute",
    top: spacing.xl,
    left: spacing.md,
    right: spacing.md,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  topRight: { flexDirection: "row", gap: spacing.sm },
  topRightCompact: { gap: spacing.xs },
  // Big, round and readable over any photo, like Instagram's editing tools.
  toolButton: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.35)" },
  toolButtonCompact: { width: 36, height: 36, borderRadius: 18 },
  toolButtonOn: { backgroundColor: "#FFFFFF" },
  topIconOn: { color: "#000000" },
  musicChipRow: { position: "absolute", left: 0, right: 0, flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 6 },
  musicChip: { flexDirection: "row", alignItems: "center", gap: 6, maxWidth: "70%", paddingHorizontal: 12, paddingVertical: 6, minHeight: 32, borderRadius: 16, backgroundColor: "rgba(0,0,0,0.5)" },
  musicChipText: { color: "#FFFFFF", fontSize: 13, fontWeight: "600", flexShrink: 1 },
  musicRemove: { width: 28, height: 28, borderRadius: 14, backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center" },
  topIcon: { color: colors.textPrimary, fontSize: 24, fontWeight: "600" },
  topIconCompact: { fontSize: 20 },
  cropHint: { color: "rgba(255,255,255,0.85)", fontSize: 13 },
  cropDoneButton: { backgroundColor: colors.accent, borderRadius: radii.pill, paddingHorizontal: spacing.md, paddingVertical: 6 },
  cropDoneLabel: { color: colors.onAccent, fontWeight: "700" },
  cropControlsBar: {
    position: "absolute",
    bottom: spacing.xxl,
    left: 0,
    right: 0,
    alignItems: "center",
  },
  trashZone: {
    position: "absolute",
    bottom: spacing.xl,
    alignSelf: "center",
    borderRadius: radii.pill,
    backgroundColor: "rgba(237,82,70,0.85)",
    alignItems: "center",
    justifyContent: "center",
  },
  guideVertical: { position: "absolute", top: 0, bottom: 0, left: "50%", width: 1, marginLeft: -0.5, backgroundColor: "rgba(80,190,255,0.9)" },
  guideHorizontal: { position: "absolute", left: 0, right: 0, top: "50%", height: 1, marginTop: -0.5, backgroundColor: "rgba(80,190,255,0.9)" },
  trashZoneActive: { backgroundColor: colors.danger, transform: [{ scale: 1.25 }] },
  trashIcon: { fontSize: 28, color: colors.textPrimary },
  hidden: { opacity: 0 },
  filterToast: {
    position: "absolute",
    alignSelf: "center",
    top: "45%",
    backgroundColor: "rgba(0,0,0,0.55)",
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  boomerangBadge: {
    position: "absolute",
    top: "12%",
    alignSelf: "center",
    backgroundColor: "rgba(0,0,0,0.5)",
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  filterButtons: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.md },
  filterButton: { padding: spacing.sm, borderRadius: radii.pill, backgroundColor: "rgba(0,0,0,0.35)" },
  filterName: { color: colors.textPrimary, fontWeight: "700", minWidth: 90, textAlign: "center" },
  visibility: { alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radii.pill, backgroundColor: "rgba(0,0,0,0.35)" },
  visibilityLabel: { color: colors.textPrimary, fontSize: 13, fontWeight: "600" },
  shareRow: { flexDirection: "row", gap: spacing.sm },
  shareButton: { flex: 1, minHeight: 48, paddingVertical: spacing.sm, paddingHorizontal: spacing.sm, borderRadius: radii.pill, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm },
  shareYourStory: { backgroundColor: colors.textPrimary },
  shareYourStoryLabel: { color: colors.background, fontWeight: "700", fontSize: 15, flexShrink: 1 },
  shareCloseFriends: { backgroundColor: colors.success },
  shareCloseFriendsLabel: { color: colors.onAccent, fontWeight: "700", fontSize: 15, flexShrink: 1 },
  boomerangLabel: { color: colors.textPrimary, fontWeight: "700" },
  filterToastLabel: { color: colors.textPrimary, fontSize: 18, fontWeight: "700" },
  bottomArea: { position: "absolute", bottom: spacing.xl, left: 0, right: 0 },
  bottomAreaContent: { gap: spacing.sm, paddingHorizontal: spacing.md },
  captionInput: {
    color: colors.textPrimary,
    backgroundColor: "rgba(0,0,0,0.35)",
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  uploadError: { ...typography.caption, color: colors.danger, textAlign: "center" },
  retryButton: { alignSelf: "center", marginTop: spacing.xs, paddingHorizontal: spacing.md, paddingVertical: 4 },
  retryButtonLabel: { color: colors.accentText, fontWeight: "700" },
  uploadButtonDisabled: { opacity: 0.7 },
});
