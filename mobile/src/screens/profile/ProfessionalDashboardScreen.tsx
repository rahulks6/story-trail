import React, { useCallback, useEffect, useRef, useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../../navigation/types";
import { colors, radii, spacing, typography, ICONS } from "../../theme";
import { Icon } from "../../components/Icon";
import { useAuth } from "../../state/AuthContext";
import { ApiError } from "../../api/client";
import { mediaFileUrl } from "../../api/stories";
import { getDashboard, type Dashboard, type DashboardRange } from "../../api/professional";
import { Pressable } from "../../components/Pressable";
import { FadeInImage } from "../../components/FadeInImage";
import { EmptyState } from "../../components/EmptyState";
import { LoadFailed } from "../../components/LoadFailed";
import { Button } from "../../components/Form";
import { SkeletonBlock } from "../../components/Skeleton";
import { FollowerGrowthChart, dayLabel } from "../../components/charts/FollowerGrowthChart";
import { ActiveHoursChart, hourRange } from "../../components/charts/ActiveHoursChart";
import { formatCount } from "../../utils/formatCount";
import { timeAgo } from "../../utils/serverTime";
import { tapFeedback } from "../../utils/haptics";
import { track } from "../../analytics/analytics";

type Props = NativeStackScreenProps<RootStackParamList, "ProfessionalDashboard">;

const RANGES: { value: DashboardRange; label: string }[] = [
  { value: 7, label: "Last 7 days" },
  { value: 30, label: "Last 30 days" },
];

/**
 * "+12% vs the previous 7 days", or null when there's nothing honest to compare with (no
 * views in the period before: a percentage of zero means nothing).
 */
export function changeText(current: number, previous: number, days: number): string | null {
  if (previous <= 0) return null;
  const change = Math.round(((current - previous) / previous) * 100);
  if (change === 0) return `Same as the previous ${days} days`;
  return `${change > 0 ? "+" : "−"}${Math.abs(change)}% vs the previous ${days} days`;
}

/** "+3", "−2" or "0" for a net change. */
function signed(n: number): string {
  return n > 0 ? `+${formatCount(n)}` : n < 0 ? `−${formatCount(-n)}` : "0";
}

function Stat({ label, value }: { label: string; value: number }): React.JSX.Element {
  return (
    <View style={styles.stat} accessible accessibilityLabel={`${label}: ${value}`}>
      <Text style={styles.statValue} numberOfLines={1} adjustsFontSizeToFit>{formatCount(value)}</Text>
      <Text style={styles.statLabel} numberOfLines={1}>{label}</Text>
    </View>
  );
}

function Card({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle} accessibilityRole="header">{title}</Text>
      {subtitle ? <Text style={styles.cardSubtitle}>{subtitle}</Text> : null}
      {children}
    </View>
  );
}

/**
 * The professional dashboard (backend professional/dashboard.ts), opened from your profile's
 * Insights button once your account is professional. Only you see it. Every number is counted
 * from what really happened (never estimated), so a quiet week reads as a quiet week; when your
 * followers are online is shown only from 10 active followers up, as each hour's share of the
 * busiest, so it never says when one person is around.
 */
export function ProfessionalDashboardScreen({ navigation }: Props): React.JSX.Element {
  const { accessToken } = useAuth();
  const [range, setRange] = useState<DashboardRange>(7);
  const [data, setData] = useState<Dashboard | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "failed" | "notProfessional">("loading");
  const [refreshing, setRefreshing] = useState(false);
  // The newest request wins: switching ranges quickly never shows the older one's numbers.
  const latest = useRef(0);

  const load = useCallback(async (days: DashboardRange) => {
    if (!accessToken) return;
    const request = ++latest.current;
    try {
      const { dashboard } = await getDashboard(days, accessToken);
      if (request !== latest.current) return;
      setData(dashboard);
      setState("ready");
    } catch (error) {
      if (request !== latest.current) return;
      setState(error instanceof ApiError && error.status === 403 ? "notProfessional" : "failed");
    }
  }, [accessToken]);

  useEffect(() => {
    void load(range);
    track("professional_dashboard_viewed", { range: range === 7 ? "7d" : "30d" });
  }, [load, range]);

  const chooseRange = (next: DashboardRange) => {
    if (next === range) return;
    tapFeedback("select");
    setRange(next);
    // Keep the old numbers on screen (dimmed) until the new ones arrive, so nothing jumps.
    if (state === "ready") setState("loading");
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await load(range);
    setRefreshing(false);
  };

  if (state === "notProfessional") {
    return (
      <View style={styles.centered}>
        <EmptyState icon="insights" title="Switch to a professional account" message="It's free. You'll see your reach, follower growth, top Stories and when your followers are online.">
          <Button label="Switch to professional" onPress={() => navigation.replace("ProfessionalAccount")} />
        </EmptyState>
      </View>
    );
  }
  if (state === "failed" && !data) {
    return <LoadFailed message="Couldn't load your dashboard. Check your connection and try again." onRetry={() => { setState("loading"); void load(range); }} />;
  }

  const stale = state === "loading";
  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={colors.accentText} />}
    >
      <View style={styles.segments} accessibilityRole="tablist">
        {RANGES.map((r) => {
          const on = r.value === range;
          return (
            <Pressable
              key={r.value}
              style={[styles.segment, on && styles.segmentOn]}
              onPress={() => chooseRange(r.value)}
              accessibilityRole="tab"
              accessibilityLabel={r.label}
              accessibilityState={{ selected: on }}
            >
              <Text style={[styles.segmentLabel, on && styles.segmentLabelOn]}>{r.label}</Text>
            </Pressable>
          );
        })}
      </View>
      {state === "failed" ? <Text style={styles.error} accessibilityRole="alert">Couldn't refresh. Showing the last numbers loaded.</Text> : null}

      {!data ? (
        <View style={styles.skeleton} accessible accessibilityLabel="Loading your dashboard">
          <SkeletonBlock width="60%" height={44} />
          <SkeletonBlock width="100%" height={120} radius={radii.md} />
          <SkeletonBlock width="100%" height={200} radius={radii.md} />
        </View>
      ) : (
        <View style={[styles.body, stale && styles.stale]} accessibilityState={{ busy: stale }}>
          <Text style={styles.period}>{dayLabel(data.from, { day: "numeric", month: "short" })} – {dayLabel(data.to, { day: "numeric", month: "short" })}</Text>

          <View style={styles.hero} accessible accessibilityLabel={`Accounts reached: ${data.summary.accountsReached}. ${changeText(data.summary.accountsReached, data.previous.accountsReached, data.days) ?? ""}`}>
            <Text style={styles.heroValue}>{formatCount(data.summary.accountsReached)}</Text>
            <Text style={styles.heroLabel}>Accounts reached</Text>
            {changeText(data.summary.accountsReached, data.previous.accountsReached, data.days) ? (
              <Text style={styles.heroChange}>{changeText(data.summary.accountsReached, data.previous.accountsReached, data.days)}</Text>
            ) : null}
            {data.summary.accountsReached > 0 ? (
              <Text style={styles.heroNote}>
                {Math.round((data.summary.reachedFollowers / data.summary.accountsReached) * 100)}% already followed you · {formatCount(data.summary.accountsReached - data.summary.reachedFollowers)} didn't
              </Text>
            ) : (
              <Text style={styles.heroNote}>Post a Story and the people who watch it show up here.</Text>
            )}
          </View>

          <Card title="Your Stories" subtitle={changeText(data.summary.storyViews, data.previous.storyViews, data.days) ?? undefined}>
            <View style={styles.grid}>
              <Stat label="Story views" value={data.summary.storyViews} />
              <Stat label="Stories posted" value={data.summary.storiesPosted} />
              <Stat label="Likes" value={data.summary.likes} />
              <Stat label="Replies" value={data.summary.replies} />
              <Stat label="Comments" value={data.summary.comments} />
              <Stat label="Shares" value={data.summary.shares} />
            </View>
          </Card>

          <Card
            title="Followers"
            subtitle={data.summary.followersNet === null
              ? `${formatCount(data.summary.followers)} followers · changes counted since ${dayLabel(data.followerHistorySince, { day: "numeric", month: "short" })}`
              : `${formatCount(data.summary.followers)} followers · ${signed(data.summary.followersNet)} in this period`}
          >
            <FollowerGrowthChart days={data.daily} />
          </Card>

          <Card title="Top Stories" subtitle="Stories you posted in this period, by views">
            {data.topStories.length === 0 ? (
              <Text style={styles.muted}>No Stories in this period yet.</Text>
            ) : (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.topRow}>
                {data.topStories.map((s, i) => (
                  <Pressable
                    key={s.id}
                    style={styles.topStory}
                    onPress={() => navigation.navigate("ArchivedStoryViewer", { storyId: s.id })}
                    accessibilityRole="button"
                    accessibilityLabel={`Number ${i + 1}, posted ${timeAgo(s.createdAt)}: ${s.views} views, ${s.likes} likes, ${s.replies} replies, ${s.shares} shares`}
                    accessibilityHint="Opens the Story"
                  >
                    <FadeInImage
                      source={{ uri: mediaFileUrl(s.mediaId, "thumbnail"), headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined }}
                      style={styles.topThumb}
                      resizeMode="cover"
                    />
                    <View style={styles.topBadge}><Text style={styles.topBadgeText}>{formatCount(s.views)}</Text></View>
                    <View style={styles.topMetaRow}>
                      <Icon name={ICONS.like} size={11} color={colors.textSecondary} />
                      <Text style={styles.topMeta}>{formatCount(s.likes)}</Text>
                      <Icon name={ICONS.reply} size={11} color={colors.textSecondary} />
                      <Text style={styles.topMeta}>{formatCount(s.replies)}</Text>
                    </View>
                  </Pressable>
                ))}
              </ScrollView>
            )}
          </Card>

          <Card title="When your followers are online" subtitle="Your time, over the last 7 days">
            {data.audience.status === "ready" ? (
              <>
                <ActiveHoursChart hours={data.audience.hours} peakHour={data.audience.peakHour} />
                <Text style={styles.muted}>
                  Most active {hourRange(data.audience.peakHour)}.{data.audience.sampled ? " Based on your newest 10,000 followers." : ""}
                </Text>
              </>
            ) : (
              <Text style={styles.muted}>
                This appears once at least {data.audience.minimumFollowers} of your followers have used Katkee this week, so it never shows when one person is online.
              </Text>
            )}
          </Card>

          <Text style={styles.footer}>Only you can see this. Your own views, likes and replies aren't counted.</Text>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md, paddingBottom: spacing.xxl, gap: spacing.md },
  centered: { flex: 1, justifyContent: "center", backgroundColor: colors.background },
  segments: { flexDirection: "row", backgroundColor: colors.surface, borderRadius: radii.pill, padding: 3, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  segment: { flex: 1, minHeight: 40, borderRadius: radii.pill, alignItems: "center", justifyContent: "center" },
  segmentOn: { backgroundColor: colors.accent },
  segmentLabel: { color: colors.textSecondary, fontSize: 14, fontWeight: "600" },
  segmentLabelOn: { color: colors.onAccent, fontWeight: "700" },
  error: { ...typography.caption, color: colors.danger, textAlign: "center" },
  skeleton: { gap: spacing.md },
  body: { gap: spacing.md },
  stale: { opacity: 0.55 },
  period: { ...typography.caption, textAlign: "center" },
  hero: { alignItems: "center", paddingVertical: spacing.md, gap: 2 },
  heroValue: { color: colors.textPrimary, fontSize: 44, fontWeight: "800", letterSpacing: -1, fontVariant: ["tabular-nums"] },
  heroLabel: { ...typography.bodyStrong },
  heroChange: { color: colors.accentText, fontSize: 13, fontWeight: "700", marginTop: spacing.xs },
  heroNote: { ...typography.caption, marginTop: spacing.xs, textAlign: "center" },
  card: { backgroundColor: colors.surface, borderRadius: radii.md, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, padding: spacing.md, gap: spacing.sm },
  cardTitle: { ...typography.bodyStrong },
  cardSubtitle: { ...typography.caption, marginTop: -4 },
  grid: { flexDirection: "row", flexWrap: "wrap", rowGap: spacing.md },
  stat: { width: "33.33%", gap: 2 },
  statValue: { color: colors.textPrimary, fontSize: 20, fontWeight: "700", fontVariant: ["tabular-nums"] },
  statLabel: { color: colors.textSecondary, fontSize: 12 },
  muted: { ...typography.caption },
  topRow: { gap: spacing.sm },
  topStory: { width: 92, gap: 4 },
  topThumb: { width: 92, height: 150, borderRadius: radii.sm, backgroundColor: colors.surfaceElevated },
  topBadge: { position: "absolute", left: 6, top: 6, backgroundColor: "rgba(0,0,0,0.6)", borderRadius: radii.pill, paddingHorizontal: 6, paddingVertical: 2 },
  topBadgeText: { color: "#FFFFFF", fontSize: 11, fontWeight: "700" },
  topMetaRow: { flexDirection: "row", alignItems: "center", gap: 3 },
  topMeta: { color: colors.textSecondary, fontSize: 11, marginRight: 4 },
  footer: { ...typography.caption, textAlign: "center", color: colors.textDisabled },
});
