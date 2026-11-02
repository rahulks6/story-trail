import React, { useEffect, useMemo, useRef, useState } from "react";
import { Modal, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Pressable } from "./Pressable";
import { Button } from "./Form";
import { colors, radii, spacing, typography } from "../theme";
import { tapFeedback } from "../utils/haptics";
import { MINUTE_STEP, atTime, dayName, defaultScheduleTime, scheduleDays, scheduleProblem, scheduleText } from "../models/schedule";
import { t } from "../i18n";

interface Props {
  visible: boolean;
  /** The time already chosen, if any; otherwise the next whole hour at least an hour away. */
  initial: Date | null;
  title?: string;
  confirmLabel?: string;
  onConfirm: (at: Date) => void;
  onClose: () => void;
  /** Shown when a time is already set: posts it as soon as it's shared instead. */
  onClear?: () => void;
  busy?: boolean;
}

const HOURS = Array.from({ length: 24 }, (_, h) => h);
const MINUTES = Array.from({ length: 60 / MINUTE_STEP }, (_, i) => i * MINUTE_STEP);
const ROW = 44;

function hourText(hour: number): string {
  return new Date(2026, 0, 1, hour).toLocaleTimeString(undefined, { hour: "numeric" });
}

/**
 * Choosing when a Story posts: a day (today and the next 7) and a time on the phone's own clock,
 * as pills that are easy to hit and to read aloud. Times too soon or past the 7 days can't be
 * confirmed, and the reason shows under the summary. Used by the editor's Schedule and by
 * Reschedule in the Scheduled list.
 */
export function ScheduleSheet({ visible, initial, title = "Schedule your Story", confirmLabel = "Schedule", onConfirm, onClose, onClear, busy }: Props): React.JSX.Element {
  const { bottom } = useSafeAreaInsets();
  const [now, setNow] = useState(() => new Date());
  const [chosen, setChosen] = useState<Date>(() => initial ?? defaultScheduleTime());
  const hourList = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const minuteList = useRef<React.ComponentRef<typeof ScrollView>>(null);

  // Each opening starts from the current time and the given choice.
  useEffect(() => {
    if (!visible) return;
    const fresh = new Date();
    setNow(fresh);
    const start = initial ?? defaultScheduleTime(fresh);
    setChosen(start);
    const id = setTimeout(() => {
      hourList.current?.scrollTo({ y: Math.max(0, (start.getHours() - 1) * ROW), animated: false });
      minuteList.current?.scrollTo({ y: Math.max(0, (Math.floor(start.getMinutes() / MINUTE_STEP) - 1) * ROW), animated: false });
    }, 0);
    return () => clearTimeout(id);
  }, [visible, initial]);

  const days = useMemo(() => scheduleDays(now), [now]);
  const chosenDay = days.findIndex((d) => d.toDateString() === chosen.toDateString());
  const problem = scheduleProblem(chosen, now);
  const pick = (next: Date) => {
    tapFeedback("select");
    setChosen(next);
  };
  const minuteOf = Math.floor(chosen.getMinutes() / MINUTE_STEP) * MINUTE_STEP;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.fill}>
        <Pressable pressEffect="none" style={styles.backdrop} onPress={onClose} accessibilityRole="button" accessibilityLabel={t("common.close")} />
        <View style={[styles.sheet, { paddingBottom: spacing.md + bottom }]} accessibilityViewIsModal>
          <View style={styles.handle} />
          <Text style={styles.title} accessibilityRole="header">{title}</Text>
          <Text style={styles.subtitle}>{t("scheduleSheet.itPostsByItselfAt")}</Text>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.days} accessibilityLabel={t("common.day")}>
            {days.map((day, i) => {
              const on = i === chosenDay;
              return (
                <Pressable
                  key={day.toDateString()}
                  style={[styles.day, on && styles.dayOn]}
                  onPress={() => pick(atTime(day, chosen.getHours(), minuteOf))}
                  accessibilityRole="button"
                  accessibilityLabel={dayName(day, now)}
                  accessibilityState={{ selected: on }}
                >
                  <Text style={[styles.dayLabel, on && styles.dayLabelOn]}>{dayName(day, now)}</Text>
                </Pressable>
              );
            })}
          </ScrollView>

          <View style={styles.time}>
            <ScrollView ref={hourList} style={styles.column} showsVerticalScrollIndicator={false} accessibilityLabel={t("common.hour")}>
              {HOURS.map((h) => {
                const on = chosen.getHours() === h;
                return (
                  <Pressable key={h} style={[styles.cell, on && styles.cellOn]} onPress={() => pick(atTime(chosen, h, minuteOf))} accessibilityRole="button" accessibilityLabel={hourText(h)} accessibilityState={{ selected: on }}>
                    <Text style={[styles.cellLabel, on && styles.cellLabelOn]}>{hourText(h)}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
            <Text style={styles.colon}>:</Text>
            <ScrollView ref={minuteList} style={styles.column} showsVerticalScrollIndicator={false} accessibilityLabel={t("scheduleSheet.minutes")}>
              {MINUTES.map((m) => {
                const on = minuteOf === m;
                return (
                  <Pressable key={m} style={[styles.cell, on && styles.cellOn]} onPress={() => pick(atTime(chosen, chosen.getHours(), m))} accessibilityRole="button" accessibilityLabel={`${m} minutes`} accessibilityState={{ selected: on }}>
                    <Text style={[styles.cellLabel, on && styles.cellLabelOn]}>{String(m).padStart(2, "0")}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>

          <Text style={styles.summary} accessibilityLiveRegion="polite">{t("scheduleSheet.postsChosen", { chosen: scheduleText(chosen, now) })}</Text>
          {problem ? <Text style={styles.problem} accessibilityRole="alert">{problem}</Text> : null}
          <View style={styles.actions}>
            <Button label={confirmLabel} onPress={() => onConfirm(chosen)} disabled={!!problem} busy={busy} />
            {onClear ? <Button label={t("scheduleSheet.dontSchedule")} variant="text" onPress={onClear} /> : null}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, justifyContent: "flex-end" },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: "rgba(0,0,0,0.55)" },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radii.lg, borderTopRightRadius: radii.lg, paddingHorizontal: spacing.md, gap: spacing.sm },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: "center", marginTop: spacing.sm },
  title: { ...typography.title, textAlign: "center" },
  subtitle: { ...typography.caption, textAlign: "center" },
  days: { gap: spacing.xs, paddingVertical: spacing.xs },
  day: { minHeight: 40, paddingHorizontal: spacing.md, borderRadius: radii.pill, backgroundColor: colors.surfaceElevated, justifyContent: "center" },
  dayOn: { backgroundColor: colors.accent },
  dayLabel: { color: colors.textPrimary, fontSize: 14, fontWeight: "600" },
  dayLabelOn: { color: colors.onAccent, fontWeight: "700" },
  time: { flexDirection: "row", alignItems: "center", height: ROW * 4, gap: spacing.sm },
  column: { flex: 1, height: ROW * 4, borderRadius: radii.md, backgroundColor: colors.surfaceElevated },
  colon: { ...typography.title },
  cell: { height: ROW, alignItems: "center", justifyContent: "center", borderRadius: radii.sm },
  cellOn: { backgroundColor: colors.accent },
  cellLabel: { color: colors.textPrimary, fontSize: 16, fontVariant: ["tabular-nums"] },
  cellLabelOn: { color: colors.onAccent, fontWeight: "700" },
  summary: { ...typography.bodyStrong, textAlign: "center", marginTop: spacing.xs },
  problem: { ...typography.caption, color: colors.danger, textAlign: "center" },
  actions: { gap: spacing.xs, marginTop: spacing.xs },
});
