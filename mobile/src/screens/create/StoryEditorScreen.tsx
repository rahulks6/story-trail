import { Icon } from "../../components/Icon";
import { KeyboardAvoider } from "../../components/KeyboardAvoider";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  Image,
  Keyboard,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent,
} from "react-native";
import Video from "react-native-video";
import type { NativeStackScreenProps, NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { CreateStackParamList, RootStackParamList } from "../../navigation/types";
import { colors, radii, spacing, typography, ICONS } from "../../theme";
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
import { StickerSheet, type StickerAddPayload } from "../../components/StickerSheet";
import { DrawingCanvas } from "../../components/DrawingCanvas";
import { OverlayAdjustSheet } from "../../components/OverlayAdjustSheet";
import { CropGestureLayer } from "../../components/CropGestureLayer";
import { CropAdjustControls } from "../../components/CropAdjustControls";
import { savePendingDraft, loadPendingDraft, clearPendingDraft } from "../../state/draftStorage";
import { useScreenInsets } from "../../hooks/useScreenInsets";
import { useScreenReader } from "../../hooks/useScreenReader";
import { Avatar } from "../../components/Avatar";
import { listCloseFriends } from "../../api/users";

type Props = NativeStackScreenProps<CreateStackParamList, "StoryEditor">;
type Audience = "public" | "followers" | "close_friends";

const TRASH_ZONE_SIZE = 80;
/** Long edge of the editor's filtered photo preview, in pixels. */
const PREVIEW_EDGE = 1080;

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
  const { mediaUri, kind, mimeType } = route.params;
  // A Boomerang plays forward and back with no sound; the server makes it while processing.
  const boomerang = kind === "video" && route.params.effect === "boomerang";
  const { accessToken,user } = useAuth();
  const insets = useScreenInsets();
  const screenReader = useScreenReader();
  const submittingUpload=useRef(false);
  const rootNavigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [audience, setAudience] = useState<Audience>("public");

  const [draft, setDraft] = useState(() => createEmptyDraft({ uri: mediaUri, kind, width: route.params.width, height: route.params.height }));
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [textModalVisible, setTextModalVisible] = useState(false);
  const [stickerSheetVisible, setStickerSheetVisible] = useState(false);
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
  // arithmetic (utils/filterPhoto.ts). Until a preview is ready the previous one stays on screen.
  const [photoPreviewUri, setPhotoPreviewUri] = useState(mediaUri);
  const [photoPreviewFailed, setPhotoPreviewFailed] = useState(false);

  const nextZIndex = useRef(1);
  const filterToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [restored, setRestored] = useState(false);

  useEffect(() => {
    return () => {
      if (filterToastTimer.current) clearTimeout(filterToastTimer.current);
    };
  }, []);

  useEffect(() => {
    if (kind !== "photo") return;
    let cancelled = false;
    filteredPhotoUri(mediaUri, filterKey(draft.filter) as FilterKey, PREVIEW_EDGE)
      .then((uri) => {
        if (cancelled) return;
        setPhotoPreviewUri(uri);
        setPhotoPreviewFailed(false);
      })
      .catch(() => {
        if (cancelled) return;
        // Couldn't process it on this phone: show the photo with the filter's tint instead.
        setPhotoPreviewUri(mediaUri);
        setPhotoPreviewFailed(true);
      });
    return () => {
      cancelled = true;
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
        void savePendingDraft(user.id, mediaUri, { draft, audience, mimeType, savedAt: new Date().toISOString() });
      } else {
        void clearPendingDraft(user.id, mediaUri);
      }
    }, 800);
    return () => clearTimeout(timer);
  }, [restored, draft, audience, mediaUri, mimeType, user?.id]);

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

  /** A tap on an object: text opens for editing, a location or date opens its editor. */
  const editOverlay = useCallback(
    (id: string) => {
      const o = draft.overlays.find((x) => x.id === id);
      if (o?.type === "text") {
        setEditingOverlayId(id);
        setTextModalVisible(true);
      } else if (o?.type === "location" || o?.type === "datetime") {
        openStickerEditor(id);
      }
    },
    [draft.overlays, openStickerEditor],
  );

  // The photo itself (like Instagram): swipe sideways to change the filter as the finger moves,
  // tap to add text, and pinch with two fingers to resize and turn the last object touched. Objects
  // sit above this layer and take their own touches first. It must stay a real native view
  // (`collapsable={false}`): an empty view is dropped on Android and touches fall through.
  const canvasLatest = useRef({ cycleFilter, draft, containerSize });
  canvasLatest.current = { cycleFilter, draft, containerSize };
  const canvasGesture = useMemo(() => {
    let steps = 0;
    let moved = false;
    let pinch: { id: string; start: Placement; from: [Touch, Touch] } | null = null;
    let pinched = false;
    let swipeStart = { x: 0, y: 0 };
    const touchesOf = (evt: GestureResponderEvent): Touch[] => evt.nativeEvent.touches.map((t) => ({ pageX: t.pageX, pageY: t.pageY }));
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
          updateOverlay(pinch.id, { ...next, ...clampOverlayPosition(next.x, next.y) });
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
        pinch = null;
      },
      onPanResponderTerminate: () => {
        pinch = null;
      },
    });
  }, [updateOverlay]);

  const confirmDiscard = useCallback(
    (onDiscard: () => void) => {
      if (!hasMeaningfulEdits(draft)) {
        onDiscard();
        return;
      }
      Alert.alert("Discard Story?", undefined, [
        { text: "Keep Editing", style: "cancel" },
        { text: "Discard", style: "destructive", onPress: onDiscard },
      ]);
    },
    [draft],
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
          allowComments: "everyone",
          allowSharing: true,
          overlays: draft.overlays,
          drawing: draft.drawing,
          filter: filterKey(draft.filter),
          audioMuted: draft.audioMuted,
          crop: draft.crop,
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
      setUploadError(err instanceof ApiError ? err.message : "Sharing failed — check your connection and try again.");
    } finally {
      submittingUpload.current=false;
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.mediaContainer} onLayout={onContainerLayout}>
        {kind === "photo" ? (
          <Image
            source={{ uri: photoPreviewUri }}
            style={[StyleSheet.absoluteFill, mediaTransformStyle(draft.crop, containerSize.width, containerSize.height)]}
            resizeMode="cover"
          />
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

        {activeFilter.overlayOpacity > 0 && (kind === "video" || photoPreviewFailed) ? (
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
          ? draft.overlays.map((overlay) => (
              <DraggableCanvasObject
                key={overlay.id}
                overlay={overlay}
                containerWidth={containerSize.width}
                containerHeight={containerSize.height}
                isOverTrash={isOverTrash}
                onChange={updateOverlay}
                onDeleted={(id) => {
                  deleteOverlay(id);
                  setSelectedOverlayId((s) => (s === id ? null : s));
                }}
                onDragStateChange={setIsDraggingOverlay}
                onOverTrashChange={(over) => {
                  if (over) tapFeedback("tap");
                  setOverTrash(over);
                }}
                onTouchStart={raiseOverlay}
                onGuidesChange={setGuides}
                onTap={editOverlay}
                onOpenControls={(id) => setSelectedOverlayId(id)}
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

      {!drawMode && !cropMode && !isDraggingOverlay ? (
        <View style={[styles.topBar, { top: insets.top + spacing.md }]}>
          <Pressable onPress={onClose} hitSlop={8} style={styles.toolButton} accessibilityRole="button" accessibilityLabel="Close editor">
            <Icon style={styles.topIcon} name={ICONS.close} />
          </Pressable>
          <View style={styles.topRight}>
            <Pressable onPress={() => setCropMode(true)} hitSlop={8} style={styles.toolButton} accessibilityRole="button" accessibilityLabel="Crop">
              <Icon style={styles.topIcon} name={ICONS.crop} />
            </Pressable>
            <Pressable
              onPress={() => {
                setEditingOverlayId(null);
                setTextModalVisible(true);
              }}
              hitSlop={8} style={styles.toolButton}
              accessibilityRole="button"
              accessibilityLabel="Add text"
            >
              <Icon style={styles.topIcon} name={ICONS.text} />
            </Pressable>
            <Pressable
              onPress={() => {
                setEditingStickerOverlayId(null);
                setStickerSheetVisible(true);
              }}
              hitSlop={8} style={styles.toolButton}
              accessibilityRole="button"
              accessibilityLabel="Add sticker, emoji, mention, location, or date and time"
            >
              <Icon style={styles.topIcon} name={ICONS.sticker} />
            </Pressable>
            <Pressable onPress={() => setDrawMode(true)} hitSlop={8} style={styles.toolButton} accessibilityRole="button" accessibilityLabel="Draw">
              <Icon style={styles.topIcon} name={ICONS.draw} />
            </Pressable>
            {kind === "video" && !boomerang ? (
              <Pressable
                onPress={() => setDraft((d) => ({ ...d, audioMuted: !d.audioMuted }))}
                hitSlop={8} style={styles.toolButton}
                accessibilityRole="button"
                accessibilityLabel={draft.audioMuted ? "Audio muted, tap to turn on" : "Audio on, tap to mute"}
              >
                <Icon style={styles.topIcon} name={draft.audioMuted ? ICONS.audioMuted : ICONS.audioOn} />
              </Pressable>
            ) : null}
          </View>
        </View>
      ) : null}

      {!drawMode && !cropMode && !isDraggingOverlay ? (
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

          <Pressable
            onPress={() => setAudience(storyAudience === "public" ? "followers" : "public")}
            hitSlop={8}
            style={styles.visibility}
            accessibilityRole="switch"
            accessibilityLabel="Your story for followers only"
            accessibilityState={{ checked: storyAudience === "followers" }}
          >
            <Text style={styles.visibilityLabel}>Your story: {storyAudience === "public" ? "Everyone" : "Followers only"}</Text>
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
                  <Text style={styles.shareYourStoryLabel}>Your story</Text>
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
                  <Text style={styles.shareCloseFriendsLabel}>Close Friends</Text>
                </>
              )}
            </Pressable>
          </View>
        </KeyboardAvoider>
      ) : null}

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
      />
      <StickerSheet
        visible={stickerSheetVisible}
        onClose={() => {
          setStickerSheetVisible(false);
          setEditingStickerOverlayId(null);
        }}
        onAdd={addSticker}
        editingOverlay={editingStickerOverlay}
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
  // Big, round and readable over any photo, like Instagram's editing tools.
  toolButton: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.35)" },
  topIcon: { color: colors.textPrimary, fontSize: 24, fontWeight: "600" },
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
  trashIcon: { fontSize: 28 },
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
  shareButton: { flex: 1, height: 48, borderRadius: radii.pill, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm },
  shareYourStory: { backgroundColor: colors.textPrimary },
  shareYourStoryLabel: { color: colors.background, fontWeight: "700", fontSize: 15 },
  shareCloseFriends: { backgroundColor: colors.success },
  shareCloseFriendsLabel: { color: colors.onAccent, fontWeight: "700", fontSize: 15 },
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
  retryButtonLabel: { color: colors.accent, fontWeight: "700" },
  uploadButtonDisabled: { opacity: 0.7 },
});
