import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PanResponder, StyleSheet, View, type AccessibilityActionEvent, type GestureResponderEvent } from "react-native";
import { clampOverlayPosition, type Overlay } from "../models/storyDraft";
import { pinchPlacement, TAP_SLOP, type Placement, type Touch } from "../models/canvasGestures";
import { OverlayBody } from "./OverlayBody";
import { PlacedOverlay } from "./PlacedOverlay";
import { tapFeedback } from "../utils/haptics";

interface Props {
  overlay: Overlay;
  containerWidth: number;
  containerHeight: number;
  isOverTrash: (pageX: number, pageY: number) => boolean;
  onChange: (id: string, patch: Partial<Pick<Overlay, "x" | "y" | "scale" | "rotation">>) => void;
  /** A finger landed on the object: bring it to the front and make it the one two-finger gestures on the photo act on. */
  onTouchStart: (id: string) => void;
  /** A clean tap (no movement): edit text, a location or a date. */
  onTap: (id: string) => void;
  /** The screen reader's "activate": the buttons for moving, resizing, rotating and deleting. */
  onOpenControls: (id: string) => void;
  onDragStateChange: (dragging: boolean) => void;
  /** While dragging: whether the finger is over the trash. */
  onOverTrashChange: (over: boolean) => void;
  onDeleted: (id: string) => void;
  /** While dragging: whether it has snapped to the middle across (x) or down (y). */
  onGuidesChange?: (guides: { x: boolean; y: boolean }) => void;
  /**
   * Hands the editor a way to move this object live (its two-finger pinch on the photo) without
   * committing every movement to the draft. Called with null when the object goes away.
   */
  registerLive?: (id: string, show: ((placement: Placement | null) => void) | null) => void;
}

/** How close (px) to the middle a drag snaps onto it. */
export const SNAP_PX = 10;

/** A dragged position, snapped to the middle when it's close: Instagram's centre guides. */
export function snapToCentre(x: number, y: number, width: number, height: number): { x: number; y: number; guides: { x: boolean; y: boolean } } {
  const gx = Math.abs(x - 0.5) * width < SNAP_PX;
  const gy = Math.abs(y - 0.5) * height < SNAP_PX;
  return { x: gx ? 0.5 : x, y: gy ? 0.5 : y, guides: { x: gx, y: gy } };
}

const HIT_SLOP = { top: 16, bottom: 16, left: 16, right: 16 };
const ACCESSIBILITY_ACTIONS = [{ name: "activate", label: "Open controls" }];

const touchesOf = (evt: GestureResponderEvent): Touch[] => evt.nativeEvent.touches.map((t) => ({ pageX: t.pageX, pageY: t.pageY }));

/**
 * One gesture model for every object on a Story (text, emoji, mention, location, date, sticker),
 * like Instagram: touch and drag to move it with the finger; two fingers to resize, turn and move
 * it at once (a second finger can join at any time); tap text to edit it; drag onto the trash to
 * delete. The same OverlayBody renders it in the viewer, so it publishes exactly as placed.
 *
 * The touch handlers are created once and read the latest values from a ref: recreating them
 * during a drag (as this did before) restarted the gesture on every movement.
 *
 * While a finger moves, the object follows it from its own state (`live`), so only this object
 * redraws; the new place is committed with `onChange` once, when the finger lifts. Committing on
 * every movement redrew the whole editor (and every other object) many times a second.
 */
function DraggableCanvasObjectImpl(props: Props): React.JSX.Element {
  const { overlay, containerWidth, containerHeight } = props;
  const [dragging, setDragging] = useState(false);
  const [live, setLive] = useState<Placement | null>(null);
  const liveRef = useRef<Placement | null>(null);
  const showLive = useRef((next: Placement | null) => {
    liveRef.current = next;
    setLive(next);
  }).current;
  const latest = useRef(props);
  latest.current = props;

  const { registerLive } = props;
  useEffect(() => {
    if (!registerLive) return;
    registerLive(overlay.id, showLive);
    return () => registerLive(overlay.id, null);
  }, [registerLive, overlay.id, showLive]);

  const panResponder = useMemo(() => {
    let mode: "drag" | "pinch" = "drag";
    let start: Placement = { x: 0, y: 0, scale: 1, rotation: 0 };
    let from: Touch[] = [];
    let moved = false;
    let pinched = false;
    let overTrash = false;
    let guides = { x: false, y: false };
    const setGuides = (next: { x: boolean; y: boolean }) => {
      if (next.x === guides.x && next.y === guides.y) return;
      if ((next.x && !guides.x) || (next.y && !guides.y)) tapFeedback("select");
      guides = next;
      latest.current.onGuidesChange?.(next);
    };

    const current = (): Placement => {
      if (liveRef.current) return liveRef.current;
      const o = latest.current.overlay;
      return { x: o.x, y: o.y, scale: o.scale, rotation: o.rotation };
    };
    /** Commits where the finger left it (once per gesture), then stops showing the live place. */
    const commit = () => {
      const placed = liveRef.current;
      if (!placed) return;
      const p = latest.current;
      const o = p.overlay;
      const patch: Partial<Placement> = {};
      if (placed.x !== o.x) patch.x = placed.x;
      if (placed.y !== o.y) patch.y = placed.y;
      if (placed.scale !== o.scale) patch.scale = placed.scale;
      if (placed.rotation !== o.rotation) patch.rotation = placed.rotation;
      if (Object.keys(patch).length > 0) p.onChange(o.id, patch);
      showLive(null);
    };
    const begin = (touches: Touch[]) => {
      start = current();
      from = touches.slice(0, 2);
      mode = touches.length >= 2 ? "pinch" : "drag";
      if (mode === "pinch") pinched = true;
    };
    const end = (deleteIfOverTrash: boolean) => {
      const p = latest.current;
      if (moved && deleteIfOverTrash && overTrash) {
        p.onDeleted(p.overlay.id);
        showLive(null);
      } else {
        commit();
        if (!moved && !pinched && deleteIfOverTrash) p.onTap(p.overlay.id);
      }
      setGuides({ x: false, y: false });
      if (moved) {
        setDragging(false);
        p.onDragStateChange(false);
        p.onOverTrashChange(false);
      }
      moved = false;
      pinched = false;
      overTrash = false;
    };

    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (evt) => {
        moved = false;
        pinched = false;
        overTrash = false;
        latest.current.onTouchStart(latest.current.overlay.id);
        begin(touchesOf(evt));
      },
      onPanResponderMove: (evt) => {
        const p = latest.current;
        const touches = touchesOf(evt);
        if (touches.length === 0) return;
        // A finger joined or left: carry on from where the object is now.
        if ((touches.length >= 2) !== (mode === "pinch")) begin(touches);

        if (mode === "pinch") {
          const next = pinchPlacement(start, [from[0]!, from[1]!], [touches[0]!, touches[1]!], p.containerWidth, p.containerHeight);
          moved = true;
          showLive({ ...next, ...clampOverlayPosition(next.x, next.y) });
          return;
        }

        const dx = touches[0]!.pageX - from[0]!.pageX;
        const dy = touches[0]!.pageY - from[0]!.pageY;
        if (!moved) {
          if (Math.hypot(dx, dy) < TAP_SLOP) return;
          moved = true;
          setDragging(true);
          p.onDragStateChange(true);
        }
        const placed = clampOverlayPosition(start.x + dx / p.containerWidth, start.y + dy / p.containerHeight);
        const snapped = snapToCentre(placed.x, placed.y, p.containerWidth, p.containerHeight);
        setGuides(snapped.guides);
        showLive({ ...current(), x: snapped.x, y: snapped.y });
        const over = p.isOverTrash(touches[0]!.pageX, touches[0]!.pageY);
        if (over !== overTrash) {
          overTrash = over;
          p.onOverTrashChange(over);
        }
      },
      onPanResponderRelease: () => end(true),
      onPanResponderTerminate: () => end(false),
    });
  }, []);

  // The body doesn't change while it moves, so moving redraws only the frame around it.
  const body = useMemo(
    () => <OverlayBody overlay={overlay} containerWidth={containerWidth} containerHeight={containerHeight} />,
    [overlay, containerWidth, containerHeight],
  );
  const placement = live ? { ...overlay, ...live } : overlay;
  const onAccessibilityAction = useCallback((event: AccessibilityActionEvent) => {
    if (event.nativeEvent.actionName === "activate") latest.current.onOpenControls(latest.current.overlay.id);
  }, []);

  return (
    <PlacedOverlay
      overlay={placement}
      containerWidth={containerWidth}
      containerHeight={containerHeight}
      dimmed={dragging}
      {...panResponder.panHandlers}
      collapsable={false}
      hitSlop={HIT_SLOP}
      accessible
      accessibilityRole="button"
      accessibilityLabel={overlayDescription(overlay)}
      accessibilityHint="Drag to move, pinch with two fingers to resize and rotate, or activate for button controls"
      // A screen reader takes raw touches for its own navigation, so its "activate" opens the
      // buttons for moving, resizing, rotating and deleting instead.
      accessibilityActions={ACCESSIBILITY_ACTIONS}
      onAccessibilityAction={onAccessibilityAction}
    >
      {body}
    </PlacedOverlay>
  );
}

/** Memoised: an object redraws only when its own overlay (or the canvas size) changes. */
export const DraggableCanvasObject = memo(DraggableCanvasObjectImpl);

/** A short, human description for screen readers — the on-canvas glyph/text alone isn't always self-describing (an emoji, a sticker glyph). */
function overlayDescription(overlay: Overlay): string {
  switch (overlay.type) {
    case "text":
      return `Text: ${overlay.properties.text}`;
    case "emoji":
      return `Emoji ${overlay.properties.emoji}`;
    case "mention":
      return `Mention of @${overlay.properties.username ?? "unknown"}`;
    case "location":
      return `Location: ${overlay.properties.label}`;
    case "datetime":
      return overlay.properties.display;
    case "sticker":
      return "Sticker";
    default:
      return "Story object";
  }
}

const styles = StyleSheet.create({
});
