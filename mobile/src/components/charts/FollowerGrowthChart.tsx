import React, { useState } from "react";
import { StyleSheet, Text, View, type LayoutChangeEvent } from "react-native";
import Svg, { Line, Path } from "react-native-svg";
import { Pressable } from "../Pressable";
import { colors, spacing } from "../../theme";
import { tapFeedback } from "../../utils/haptics";
import type { DashboardDay } from "../../api/professional";
import { barPath, growthColors } from "./barPath";
import { localeTag, t } from "../../i18n";

const HEIGHT = 140;
const GAP = 2;

/** "Tue 28 Oct" for a YYYY-MM-DD day (a calendar day, so it is read without a time zone). */
export function dayLabel(day: string, options: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short" }): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y!, (m ?? 1) - 1, d ?? 1)).toLocaleDateString(localeTag(), { ...options, timeZone: "UTC" });
}

/** What one day says, for the line above the chart and for screen readers. */
export function growthDayText(day: DashboardDay): string {
  if (day.followersGained === null || day.followersLost === null) return t("followerGrowthChart.dayNotCountedYet", { day: dayLabel(day.day) });
  return t("followerGrowthChart.dayFollowersgainedGainedFollowerslos", { day: dayLabel(day.day), followersGained: day.followersGained, followersLost: day.followersLost });
}

/**
 * Followers gained (up, amber) and lost (down, blue) per day, around one baseline: direction
 * and colour both say which is which, and the legend names them. Tapping a day shows its
 * numbers above the chart (the busiest day until then). Days before follower changes were
 * counted have no bars and say so, rather than looking like quiet days.
 */
export function FollowerGrowthChart({ days }: { days: DashboardDay[] }): React.JSX.Element {
  const [width, setWidth] = useState(0);
  const counted = days.filter((d) => d.followersGained !== null);
  const busiest = counted.reduce<DashboardDay | null>((best, d) => (!best || (d.followersGained ?? 0) + (d.followersLost ?? 0) > (best.followersGained ?? 0) + (best.followersLost ?? 0) ? d : best), null);
  const [selected, setSelected] = useState<string | null>(null);
  const shown = days.find((d) => d.day === selected) ?? busiest ?? days.at(-1) ?? null;
  const palette = growthColors();

  const maxUp = Math.max(1, ...counted.map((d) => d.followersGained ?? 0));
  const maxDown = Math.max(0, ...counted.map((d) => d.followersLost ?? 0));
  // The baseline sits where gains and losses share the height in proportion, never squashing gains to nothing.
  const upShare = maxDown === 0 ? 1 : Math.max(0.5, maxUp / (maxUp + maxDown));
  const baseline = Math.round(HEIGHT * upShare) - (maxDown === 0 ? 1 : 0);
  const scale = maxDown === 0 ? (baseline - 4) / maxUp : Math.min((baseline - 4) / maxUp, (HEIGHT - baseline - 4) / Math.max(1, maxDown));
  const column = days.length ? width / days.length : 0;
  const barWidth = Math.max(2, column - GAP);

  return (
    <View>
      <Text style={styles.detail} accessibilityLiveRegion="polite">{shown ? growthDayText(shown) : ""}</Text>
      <View style={styles.plot} onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}>
        {width > 0 ? (
          <Svg width={width} height={HEIGHT} accessible={false} importantForAccessibility="no-hide-descendants">
            {days.map((d, i) => {
              if (d.followersGained === null) return null;
              const x = i * column + GAP / 2;
              const dim = shown && shown.day !== d.day ? 0.55 : 1;
              return (
                <React.Fragment key={d.day}>
                  <Path d={barPath(x, baseline - 1, barWidth, (d.followersGained ?? 0) * scale)} fill={palette.gained} opacity={dim} />
                  <Path d={barPath(x, baseline + 1, barWidth, -(d.followersLost ?? 0) * scale)} fill={palette.lost} opacity={dim} />
                </React.Fragment>
              );
            })}
            <Line x1={0} x2={width} y1={baseline} y2={baseline} stroke={colors.border} strokeWidth={1} />
          </Svg>
        ) : null}
        {/* Whole-height tap targets, wider than the bars. */}
        <View style={StyleSheet.absoluteFill}>
          <View style={styles.columns}>
            {days.map((d) => (
              <Pressable
                key={d.day}
                pressEffect="none"
                style={styles.column}
                onPress={() => {
                  tapFeedback("select");
                  setSelected(d.day);
                }}
                accessibilityRole="button"
                accessibilityLabel={growthDayText(d)}
                accessibilityState={{ selected: shown?.day === d.day }}
              />
            ))}
          </View>
        </View>
      </View>
      <View style={styles.axis} importantForAccessibility="no-hide-descendants">
        <Text style={styles.axisLabel}>{days[0] ? dayLabel(days[0].day, { day: "numeric", month: "short" }) : ""}</Text>
        <Text style={styles.axisLabel}>{days.at(-1) ? dayLabel(days.at(-1)!.day, { day: "numeric", month: "short" }) : ""}</Text>
      </View>
      <View style={styles.legend} accessible accessibilityLabel={t("followerGrowthChart.amberBarsAboveTheLine")}>
        <View style={[styles.swatch, { backgroundColor: palette.gained }]} />
        <Text style={styles.legendLabel}>{t("followerGrowthChart.gained")}</Text>
        <View style={[styles.swatch, { backgroundColor: palette.lost }]} />
        <Text style={styles.legendLabel}>{t("followerGrowthChart.lost")}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  detail: { color: colors.textPrimary, fontSize: 13, fontWeight: "600", marginBottom: spacing.sm, fontVariant: ["tabular-nums"] },
  plot: { height: HEIGHT },
  columns: { flex: 1, flexDirection: "row" },
  column: { flex: 1 },
  axis: { flexDirection: "row", justifyContent: "space-between", marginTop: spacing.xs },
  axisLabel: { color: colors.textSecondary, fontSize: 11 },
  legend: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: spacing.sm },
  swatch: { width: 10, height: 10, borderRadius: 2 },
  legendLabel: { color: colors.textSecondary, fontSize: 12, marginRight: spacing.sm },
});
