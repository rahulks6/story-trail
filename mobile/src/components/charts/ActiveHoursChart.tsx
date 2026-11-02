import React, { useState } from "react";
import { StyleSheet, Text, View, type LayoutChangeEvent } from "react-native";
import Svg, { Line, Path } from "react-native-svg";
import { Pressable } from "../Pressable";
import { colors, spacing } from "../../theme";
import { tapFeedback } from "../../utils/haptics";
import { barPath } from "./barPath";
import { localeTag, t } from "../../i18n";

const HEIGHT = 110;
const GAP = 2;

/** "8 PM" (or "20:00" where the phone uses a 24-hour clock) for an hour of the day. */
export function hourLabel(hour: number): string {
  return new Date(Date.UTC(2026, 0, 1, hour)).toLocaleTimeString(localeTag(), { hour: "numeric", timeZone: "UTC" });
}

/** "8 PM – 9 PM". */
export function hourRange(hour: number): string {
  return `${hourLabel(hour)} – ${hourLabel((hour + 1) % 24)}`;
}

/** What one hour says: its share of the busiest hour, never a count of people. */
export function hourText(hour: number, share: number, peakHour: number): string {
  return hour === peakHour ? t("activeHoursChart.hourYourFollowersBusiestHour", { hour: hourRange(hour) }) : t("activeHoursChart.hourShareAsBusyAs", { hour: hourRange(hour), share });
}

/**
 * When your followers have Katkee open, by hour of your day: one amber bar per hour, as a share of
 * the busiest one (the server never sends counts, see backend professional/dashboard.ts). The
 * busiest hour is shown above the chart; tapping another hour shows that one instead.
 */
export function ActiveHoursChart({ hours, peakHour }: { hours: number[]; peakHour: number }): React.JSX.Element {
  const [width, setWidth] = useState(0);
  const [selected, setSelected] = useState(peakHour);
  const column = width / 24;
  const barWidth = Math.max(2, column - GAP);
  return (
    <View>
      <Text style={styles.detail} accessibilityLiveRegion="polite">{hourText(selected, hours[selected] ?? 0, peakHour)}</Text>
      <View style={styles.plot} onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}>
        {width > 0 ? (
          <Svg width={width} height={HEIGHT} accessible={false} importantForAccessibility="no-hide-descendants">
            {hours.map((share, h) => (
              <Path
                key={h}
                d={barPath(h * column + GAP / 2, HEIGHT - 1, barWidth, Math.max(share > 0 ? 2 : 0, ((HEIGHT - 6) * share) / 100))}
                fill={colors.accentText}
                opacity={h === selected ? 1 : 0.45}
              />
            ))}
            <Line x1={0} x2={width} y1={HEIGHT - 0.5} y2={HEIGHT - 0.5} stroke={colors.border} strokeWidth={1} />
          </Svg>
        ) : null}
        <View style={[StyleSheet.absoluteFill, styles.columns]}>
          {hours.map((share, h) => (
            <Pressable
              key={h}
              pressEffect="none"
              style={styles.column}
              onPress={() => {
                tapFeedback("select");
                setSelected(h);
              }}
              accessibilityRole="button"
              accessibilityLabel={hourText(h, share, peakHour)}
              accessibilityState={{ selected: h === selected }}
            />
          ))}
        </View>
      </View>
      <View style={styles.axis} importantForAccessibility="no-hide-descendants">
        {[0, 6, 12, 18].map((h) => (
          <Text key={h} style={[styles.axisLabel, { left: `${(h / 24) * 100}%` }]}>{hourLabel(h)}</Text>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  detail: { color: colors.textPrimary, fontSize: 13, fontWeight: "600", marginBottom: spacing.sm },
  plot: { height: HEIGHT },
  columns: { flexDirection: "row" },
  column: { flex: 1 },
  // Each label starts under its own hour.
  axis: { height: 16, marginTop: spacing.xs },
  axisLabel: { position: "absolute", color: colors.textSecondary, fontSize: 11 },
});
