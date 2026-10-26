import { Icon } from "./Icon";
import React, { useMemo, useRef, useState } from "react";
import { PanResponder, Pressable, StyleSheet, Text, View, type GestureResponderEvent } from "react-native";
import { mediaColors as colors, radii, spacing, ICONS } from "../theme";
import type { DrawStroke, DrawTool } from "../models/storyDraft";
import { DrawingStrokes } from "./DrawingStrokes";
import { tapFeedback } from "../utils/haptics";

const TOOLS: DrawTool[] = ["pen", "marker", "highlighter", "eraser"];
const COLORS = ["#FFFFFF", "#000000", "#FCB020", "#E4483C", "#FF5DA2", "#A45CFF", "#3E7BFF", "#3FBF7F"];
const SIZE_STEPS = [0.006, 0.01, 0.016, 0.024, 0.034];
const ERASE_RADIUS_NORM = 0.035;
const MIN_POINT_SPACING_PX = 2.5;

interface Props {
  containerWidth: number;
  containerHeight: number;
  strokes: DrawStroke[];
  onChangeStrokes: (strokes: DrawStroke[]) => void;
  onDone: () => void;
  /** Room for the status bar and the home indicator. */
  insets?: { top: number; bottom: number };
}

/**
 * Freehand drawing (spec section 23): Pen, Marker, Highlighter and Eraser, colours, five sizes, and
 * Undo/Redo. Points are normalized (0..1) to the media container, like overlays, so the drawing is
 * published exactly where it was drawn. The tools hide while a finger is down, like Instagram.
 * The eraser removes whole strokes it passes over.
 *
 * The touch layer must stay a real native view (`collapsable={false}`): an empty view is otherwise
 * dropped on Android and every touch falls through to the photo underneath.
 */
export function DrawingCanvas({ containerWidth, containerHeight, strokes, onChangeStrokes, onDone, insets = { top: 0, bottom: 0 } }: Props): React.JSX.Element {
  const [tool, setTool] = useState<DrawTool>("pen");
  const [color, setColor] = useState(COLORS[0]!);
  const [sizeIndex, setSizeIndex] = useState(1);
  const [live, setLive] = useState<DrawStroke | null>(null);
  const [drawing, setDrawing] = useState(false);
  const past = useRef<DrawStroke[][]>([]);
  const future = useRef<DrawStroke[][]>([]);
  const [, setHistoryTick] = useState(0);

  // The latest values for the touch handlers, which are created once.
  const latest = useRef({ tool, color, sizeIndex, strokes, containerWidth, containerHeight, onChangeStrokes });
  latest.current = { tool, color, sizeIndex, strokes, containerWidth, containerHeight, onChangeStrokes };
  const stroke = useRef<DrawStroke | null>(null);
  const erased = useRef<Set<string>>(new Set());
  // The layer's position on screen, from the first touch: page coordinates stay right even when
  // the finger passes over something else.
  const origin = useRef({ x: 0, y: 0 });

  const commit = (next: DrawStroke[]) => {
    past.current.push(latest.current.strokes);
    future.current = [];
    setHistoryTick((t) => t + 1);
    latest.current.onChangeStrokes(next);
  };
  const commitRef = useRef(commit);
  commitRef.current = commit;

  const undo = () => {
    const previous = past.current.pop();
    if (previous === undefined) return;
    future.current.push(strokes);
    setHistoryTick((t) => t + 1);
    onChangeStrokes(previous);
  };

  const redo = () => {
    const next = future.current.pop();
    if (next === undefined) return;
    past.current.push(strokes);
    setHistoryTick((t) => t + 1);
    onChangeStrokes(next);
  };

  const panResponder = useMemo(() => {
    const point = (evt: GestureResponderEvent) => {
      const { containerWidth: w, containerHeight: h } = latest.current;
      return { x: (evt.nativeEvent.pageX - origin.current.x) / w, y: (evt.nativeEvent.pageY - origin.current.y) / h };
    };
    const eraseAt = (evt: GestureResponderEvent) => {
      const { containerWidth: w, containerHeight: h, strokes: all } = latest.current;
      const { x, y } = point(evt);
      const radius = ERASE_RADIUS_NORM * w;
      for (const s of all) {
        if (erased.current.has(s.id)) continue;
        if (s.points.some((p) => Math.hypot((p.x - x) * w, (p.y - y) * h) < radius)) erased.current.add(s.id);
      }
    };
    const finish = () => {
      const { tool: t, strokes: all } = latest.current;
      if (t === "eraser") {
        if (erased.current.size > 0) commitRef.current(all.filter((s) => !erased.current.has(s.id)));
        erased.current = new Set();
      } else if (stroke.current) {
        // A tap leaves a dot.
        commitRef.current([...all, stroke.current]);
      }
      stroke.current = null;
      setLive(null);
      setDrawing(false);
    };
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (evt) => {
        origin.current = { x: evt.nativeEvent.pageX - evt.nativeEvent.locationX, y: evt.nativeEvent.pageY - evt.nativeEvent.locationY };
        setDrawing(true);
        const { tool: t, color: c, sizeIndex: s } = latest.current;
        if (t === "eraser") {
          erased.current = new Set();
          eraseAt(evt);
          return;
        }
        stroke.current = { id: `stroke-${Date.now()}`, tool: t, color: c, width: SIZE_STEPS[s]!, points: [point(evt)] };
        setLive(stroke.current);
      },
      onPanResponderMove: (evt) => {
        if (latest.current.tool === "eraser") {
          eraseAt(evt);
          return;
        }
        const current = stroke.current;
        if (!current) return;
        const next = point(evt);
        const last = current.points[current.points.length - 1]!;
        const { containerWidth: w, containerHeight: h } = latest.current;
        if (Math.hypot((next.x - last.x) * w, (next.y - last.y) * h) < MIN_POINT_SPACING_PX) return;
        stroke.current = { ...current, points: [...current.points, next] };
        setLive(stroke.current);
      },
      onPanResponderRelease: finish,
      onPanResponderTerminate: finish,
    });
  }, []);

  const previewSize = 6 + sizeIndex * 5;
  const pick = (next: () => void) => () => {
    tapFeedback("select");
    next();
  };

  return (
    <View style={StyleSheet.absoluteFill}>
      <View
        style={StyleSheet.absoluteFill}
        collapsable={false}
        {...panResponder.panHandlers}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel="Drawing canvas"
        accessibilityHint="Draw with one finger"
      >
        <DrawingStrokes strokes={strokes} containerWidth={containerWidth} containerHeight={containerHeight} />
        {live ? <DrawingStrokes strokes={[live]} containerWidth={containerWidth} containerHeight={containerHeight} /> : null}
      </View>

      {drawing ? null : (
        <>
          <View style={[styles.topBar, { top: insets.top + spacing.md }]}>
            <Pressable onPress={undo} disabled={past.current.length === 0} hitSlop={8} style={[styles.iconButton, past.current.length === 0 && styles.disabled]} accessibilityRole="button" accessibilityLabel="Undo">
              <Icon style={styles.iconLabel} name={ICONS.undo} />
            </Pressable>
            <Pressable onPress={redo} disabled={future.current.length === 0} hitSlop={8} style={[styles.iconButton, future.current.length === 0 && styles.disabled]} accessibilityRole="button" accessibilityLabel="Redo">
              <Icon style={styles.iconLabel} name={ICONS.redo} />
            </Pressable>
            <Pressable onPress={onDone} style={styles.doneButton} accessibilityRole="button" accessibilityLabel="Done drawing">
              <Text style={styles.doneLabel}>Done</Text>
            </Pressable>
          </View>

          <View style={[styles.toolbar, { bottom: insets.bottom + spacing.xl }]}>
            {tool !== "eraser" ? (
              <View style={styles.colorRow}>
                {COLORS.map((c) => (
                  <Pressable
                    key={c}
                    onPress={pick(() => setColor(c))}
                    hitSlop={4}
                    style={[styles.colorSwatch, { backgroundColor: c }, color === c && styles.colorSwatchActive]}
                    accessibilityRole="button"
                    accessibilityLabel={`Draw colour ${c}`}
                    accessibilityState={{ selected: color === c }}
                  />
                ))}
              </View>
            ) : null}
            <View style={styles.toolRow}>
              {TOOLS.map((t) => (
                <Pressable
                  key={t}
                  onPress={pick(() => setTool(t))}
                  style={[styles.toolChip, tool === t && styles.toolChipActive]}
                  accessibilityRole="button"
                  accessibilityLabel={`${t} tool`}
                  accessibilityState={{ selected: tool === t }}
                >
                  <Text style={[styles.toolLabel, tool === t && styles.toolLabelActive]}>{t}</Text>
                </Pressable>
              ))}
              {tool !== "eraser" ? (
                <View style={styles.sizeRow}>
                  <Pressable onPress={() => setSizeIndex((i) => Math.max(0, i - 1))} hitSlop={8} accessibilityRole="button" accessibilityLabel="Thinner brush">
                    <Icon style={styles.sizeStepper} name="minus" />
                  </Pressable>
                  <View style={[styles.sizePreview, { width: previewSize, height: previewSize, borderRadius: previewSize / 2, backgroundColor: color }]} />
                  <Pressable onPress={() => setSizeIndex((i) => Math.min(SIZE_STEPS.length - 1, i + 1))} hitSlop={8} accessibilityRole="button" accessibilityLabel="Thicker brush">
                    <Icon style={styles.sizeStepper} name="add" />
                  </Pressable>
                </View>
              ) : null}
            </View>
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  topBar: { position: "absolute", top: spacing.xxl, left: spacing.md, right: spacing.md, flexDirection: "row", alignItems: "center", gap: spacing.md },
  toolbar: { position: "absolute", bottom: spacing.xxl, left: spacing.md, right: spacing.md, gap: spacing.md },
  toolRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs, flexWrap: "wrap" },
  toolChip: { borderWidth: 1, borderColor: "rgba(255,255,255,0.3)", backgroundColor: "rgba(0,0,0,0.35)", borderRadius: radii.pill, paddingHorizontal: spacing.sm, paddingVertical: 6 },
  toolChipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  toolLabel: { color: colors.textPrimary, fontSize: 12, textTransform: "capitalize" },
  toolLabelActive: { color: colors.onAccent, fontWeight: "700" },
  iconButton: { padding: spacing.xs, borderRadius: radii.pill, backgroundColor: "rgba(0,0,0,0.35)" },
  disabled: { opacity: 0.35 },
  iconLabel: { color: colors.textPrimary, fontSize: 22 },
  doneButton: { marginLeft: "auto", backgroundColor: colors.accent, borderRadius: radii.pill, paddingHorizontal: spacing.lg, paddingVertical: 8 },
  doneLabel: { color: colors.onAccent, fontWeight: "700" },
  colorRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  colorSwatch: { width: 28, height: 28, borderRadius: 14, borderWidth: 2, borderColor: "rgba(255,255,255,0.7)" },
  colorSwatchActive: { borderColor: colors.accentText, borderWidth: 3, transform: [{ scale: 1.2 }] },
  sizeRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginLeft: "auto" },
  sizeStepper: { color: colors.textPrimary, fontSize: 20, paddingHorizontal: spacing.xs },
  sizePreview: { borderWidth: 1, borderColor: "rgba(255,255,255,0.4)" },
});
