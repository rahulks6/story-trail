import React, { useMemo, useRef, useState } from "react";
import { PanResponder, StyleSheet, Text, View, type LayoutChangeEvent } from "react-native";
import { mediaColors as colors, radii, spacing } from "../theme";
import { t } from "../i18n";
import { formatTrimTime, moveTrim, type TrimRange, type TrimPart } from "../models/trim";

const HANDLE = 22;

/**
 * The part of a video to keep: two yellow handles on a bar the length of the video, the kept part
 * between them. Drag a handle to move that end, or the middle to slide the whole part along a
 * longer video. A thin line shows where the preview is playing.
 */
export function TrimBar({ durationMs, value, positionMs, maxMs, onChange }: {
  durationMs: number;
  value: TrimRange;
  positionMs: number;
  maxMs: number;
  onChange: (next: TrimRange) => void;
}): React.JSX.Element {
  const [width, setWidth] = useState(0);
  const live = useRef({ value, width, durationMs, maxMs, onChange });
  live.current = { value, width, durationMs, maxMs, onChange };

  const responder = (part: TrimPart) =>
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => { start.current = live.current.value; },
      onPanResponderMove: (_e, g) => {
        const { width: w, durationMs: d, maxMs: m, onChange: change } = live.current;
        if (!w || !start.current) return;
        change(moveTrim(start.current, part, (g.dx / w) * d, d, m));
      },
    });
  const start = useRef<TrimRange | null>(null);
  const handlers = useMemo(() => ({ start: responder("start"), end: responder("end"), middle: responder("middle") }), []); // eslint-disable-line react-hooks/exhaustive-deps

  const x = (ms: number) => (durationMs > 0 ? (ms / durationMs) * width : 0);
  const left = x(value.startMs), right = x(value.endMs);
  const keptSeconds = Math.round((value.endMs - value.startMs) / 1000);

  return (
    <View style={styles.wrap}>
      <Text style={styles.label} accessibilityLiveRegion="polite">
        {t("trimBar.range", { start: formatTrimTime(value.startMs), end: formatTrimTime(value.endMs), seconds: keptSeconds })}
      </Text>
      <View style={styles.track} onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}>
        {width > 0 ? (
          <>
            <View style={[styles.dim, { left: 0, width: Math.max(0, left) }]} />
            <View style={[styles.dim, { left: right, right: 0 }]} />
            <View {...handlers.middle.panHandlers} style={[styles.kept, { left, width: Math.max(0, right - left) }]}
              accessible accessibilityRole="adjustable" accessibilityLabel={t("trimBar.keptPart")}
              accessibilityValue={{ text: t("trimBar.range", { start: formatTrimTime(value.startMs), end: formatTrimTime(value.endMs), seconds: keptSeconds }) }}
              accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
              onAccessibilityAction={(e) => onChange(moveTrim(value, "middle", e.nativeEvent.actionName === "increment" ? 1000 : -1000, durationMs, maxMs))}
            />
            <View style={[styles.playhead, { left: Math.min(Math.max(x(positionMs), left), right) }]} pointerEvents="none" />
            <View {...handlers.start.panHandlers} hitSlop={12} style={[styles.handle, { left: left - HANDLE / 2 }]}
              accessible accessibilityRole="adjustable" accessibilityLabel={t("trimBar.start")}
              accessibilityValue={{ text: formatTrimTime(value.startMs) }}
              accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
              onAccessibilityAction={(e) => onChange(moveTrim(value, "start", e.nativeEvent.actionName === "increment" ? 1000 : -1000, durationMs, maxMs))}
            >
              <View style={styles.grip} />
            </View>
            <View {...handlers.end.panHandlers} hitSlop={12} style={[styles.handle, { left: right - HANDLE / 2 }]}
              accessible accessibilityRole="adjustable" accessibilityLabel={t("trimBar.end")}
              accessibilityValue={{ text: formatTrimTime(value.endMs) }}
              accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
              onAccessibilityAction={(e) => onChange(moveTrim(value, "end", e.nativeEvent.actionName === "increment" ? 1000 : -1000, durationMs, maxMs))}
            >
              <View style={styles.grip} />
            </View>
          </>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm, paddingHorizontal: HANDLE / 2 },
  label: { color: colors.textPrimary, fontSize: 14, fontWeight: "700", textAlign: "center", textShadowColor: "rgba(0,0,0,0.6)", textShadowRadius: 4 },
  track: { height: 52, borderRadius: radii.sm, backgroundColor: "rgba(255,255,255,0.18)" },
  dim: { position: "absolute", top: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.45)", borderRadius: radii.sm },
  kept: { position: "absolute", top: 0, bottom: 0, borderTopWidth: 3, borderBottomWidth: 3, borderColor: colors.accent },
  playhead: { position: "absolute", top: 4, bottom: 4, width: 2, marginLeft: -1, borderRadius: 1, backgroundColor: "#FFFFFF" },
  handle: { position: "absolute", top: 0, bottom: 0, width: HANDLE, borderRadius: 6, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center" },
  grip: { width: 3, height: 18, borderRadius: 2, backgroundColor: colors.onAccent },
});
