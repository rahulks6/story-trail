import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Linking, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { Avatar } from "../../components/Avatar";
import { Pressable } from "../../components/Pressable";
import { useAuth } from "../../state/AuthContext";
import { contestDate, daysLeft, prizeAmount, useContest } from "../../state/contest";
import { inviteMessage, myInviteUrl, shareInvite, shareTextToWhatsApp } from "../../state/invites";
import { track } from "../../analytics/analytics";
import { colors, radii, spacing, typography } from "../../theme";
import { t } from "../../i18n";
import type { Contest } from "../../api/growth";

/**
 * The invite contest (backend growth/contest.ts): the prize and dates, your place and how many
 * more friends you need, each friend's progress to counting (days on Katkee), the top 10 and the
 * rules. Opened from Home's 🏆, Settings and the contest's pushes (katkee://contest).
 */
export function InviteContestScreen(): React.JSX.Element {
  const { user, accessToken } = useAuth();
  const { contest, reload } = useContest();
  const [refreshing, setRefreshing] = useState(false);
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await reload();
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      setRefreshing(false);
      setLoaded(true);
    }
  }, [reload]);
  // Always fresh on open: friends may have counted since Home loaded it.
  useEffect(() => { void refresh(); }, [refresh]);

  const inviteOnWhatsApp = async () => {
    if (!accessToken) return;
    try {
      const url = await myInviteUrl(accessToken, user?.id);
      if (await shareTextToWhatsApp(inviteMessage(url))) track("invite_shared", { from: "contest" });
    } catch {
      void shareInvite("contest", accessToken, user?.id);
    }
  };

  if (!contest) {
    return (
      <View style={styles.center}>
        {!loaded ? <ActivityIndicator color={colors.accentText} /> : <Text style={styles.muted}>{failed ? t("contest.couldntLoad") : t("contest.notRunning")}</Text>}
      </View>
    );
  }
  const left = daysLeft(contest);
  const running = contest.state === "running";
  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.textPrimary} colors={[colors.accentText]} />} testID="invite-contest">
      <View style={styles.hero}>
        <Text style={styles.trophy} accessibilityElementsHidden importantForAccessibility="no">🏆</Text>
        <Text style={styles.headline} accessibilityRole="header">{t("contest.headline", { prize: prizeAmount(contest) })}</Text>
        <Text style={styles.howItWorks}>{t("contest.howItWorks", { end: contestDate(contest.endsAt, true), days: contest.qualifyDays })}</Text>
        <Text style={styles.when} testID="contest-when">
          {running ? (left <= 1 ? t("contest.lastDay") : t("contest.daysLeft", { count: left }))
            : contest.state === "counting" ? t("contest.counting", { date: contestDate(contest.countsUntil, true) })
            : contest.winner ? t("contest.winnerIs", { username: contest.winner.username }) : t("contest.final")}
        </Text>
      </View>

      <Mine contest={contest} />

      {running ? (
        <View style={styles.buttons}>
          <Pressable onPress={() => void inviteOnWhatsApp()} style={styles.primary} accessibilityRole="button" testID="contest-whatsapp">
            <Text style={styles.primaryLabel}>{t("contest.inviteOnWhatsApp")}</Text>
          </Pressable>
          <Pressable onPress={() => void shareInvite("contest", accessToken, user?.id)} style={styles.secondary} accessibilityRole="button" testID="contest-share">
            <Text style={styles.secondaryLabel}>{t("contest.shareLink")}</Text>
          </Pressable>
        </View>
      ) : null}

      <Text style={styles.section} accessibilityRole="header">{t("contest.yourFriends")}</Text>
      {contest.me.friends.length ? (
        <>
          {contest.me.friends.map((f) => (
            <View key={f.username} style={styles.row} testID={`contest-friend-${f.username}`}>
              <Avatar username={f.username} displayName={f.displayName} size={36} />
              <View style={styles.rowText}>
                <Text style={styles.name} numberOfLines={1}>{f.displayName}</Text>
                <Text style={styles.muted} numberOfLines={1}>@{f.username}</Text>
              </View>
              <Text style={f.counted ? styles.counts : styles.progress}>
                {f.counted ? t("contest.countsNow") : t("contest.daysProgress", { days: f.activeDays, total: contest.qualifyDays })}
              </Text>
            </View>
          ))}
          {contest.me.pending > 0 && running ? <Text style={styles.tip}>{t("contest.friendsTip", { days: contest.qualifyDays })}</Text> : null}
        </>
      ) : <Text style={styles.muted}>{t("contest.noFriendsYet")}</Text>}

      <Text style={styles.section} accessibilityRole="header">{t("contest.leaderboard")}</Text>
      {contest.leaders.length ? contest.leaders.map((l) => (
        <View key={l.userId} style={[styles.row, l.userId === user?.id && styles.meRow]} testID={`contest-leader-${l.username}`}>
          <Text style={styles.rank}>#{l.rank}</Text>
          <Avatar username={l.username} displayName={l.displayName} avatarMediaId={l.avatarMediaId} size={36} />
          <View style={styles.rowText}>
            <Text style={styles.name} numberOfLines={1}>{l.displayName}</Text>
            <Text style={styles.muted} numberOfLines={1}>@{l.username}</Text>
          </View>
          <Text style={styles.score}>{t("contest.friendsCounted", { count: l.counted })}</Text>
        </View>
      )) : <Text style={styles.muted}>{t("contest.noLeadersYet")}</Text>}

      <Pressable onPress={() => void Linking.openURL(contest.rulesUrl)} style={styles.rules} accessibilityRole="link" testID="contest-rules">
        <Text style={styles.rulesLabel}>{t("contest.fullRules")}</Text>
      </Pressable>
    </ScrollView>
  );
}

function Mine({ contest }: { contest: Contest }): React.JSX.Element {
  const { counted, pending, rank, toFirst } = contest.me;
  return (
    <View style={styles.mine} testID="contest-mine">
      <View style={styles.stat}>
        <Text style={styles.statValue}>{counted}</Text>
        <Text style={styles.statLabel}>{t("contest.counted")}</Text>
      </View>
      <View style={styles.stat}>
        <Text style={styles.statValue}>{pending}</Text>
        <Text style={styles.statLabel}>{t("contest.onTheWay")}</Text>
      </View>
      <View style={styles.stat}>
        <Text style={styles.statValue}>{rank ? `#${rank}` : "–"}</Text>
        <Text style={styles.statLabel}>{t("contest.yourPlace")}</Text>
      </View>
      {contest.state === "running" ? (
        <Text style={styles.goal} testID="contest-goal">
          {toFirst === 0 ? t("contest.youLead") : t("contest.toFirst", { count: toFirst ?? 1 })}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl * 2, gap: spacing.sm },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl, backgroundColor: colors.background },
  hero: { alignItems: "center", gap: spacing.xs, paddingVertical: spacing.md },
  trophy: { fontSize: 56 },
  headline: { ...typography.title, fontSize: 24, fontWeight: "900", textAlign: "center" },
  howItWorks: { ...typography.body, color: colors.textSecondary, textAlign: "center" },
  when: { ...typography.body, color: colors.accentText, fontWeight: "800", textAlign: "center", marginTop: spacing.xs },
  mine: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-around", padding: spacing.md, borderRadius: radii.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  stat: { alignItems: "center", minWidth: 80 },
  statValue: { ...typography.title, fontSize: 26, fontWeight: "900" },
  statLabel: { ...typography.caption },
  goal: { width: "100%", textAlign: "center", marginTop: spacing.sm, ...typography.body, fontWeight: "700" },
  buttons: { gap: spacing.sm, marginTop: spacing.sm },
  primary: { alignItems: "center", paddingVertical: 14, borderRadius: 14, backgroundColor: colors.accent },
  primaryLabel: { fontSize: 16, fontWeight: "800", color: colors.onAccent },
  secondary: { alignItems: "center", paddingVertical: 12, borderRadius: 14, borderWidth: 1, borderColor: colors.border },
  secondaryLabel: { ...typography.body, fontWeight: "700" },
  section: { ...typography.title, marginTop: spacing.lg },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.xs, paddingHorizontal: spacing.xs, borderRadius: 12 },
  meRow: { backgroundColor: colors.surface },
  rowText: { flex: 1 },
  name: { ...typography.body, fontWeight: "700" },
  muted: { ...typography.caption },
  rank: { ...typography.body, fontWeight: "900", width: 32 },
  score: { ...typography.body, fontWeight: "800" },
  counts: { ...typography.caption, color: colors.accentText, fontWeight: "800" },
  progress: { ...typography.caption },
  tip: { ...typography.caption, marginTop: spacing.xs },
  rules: { alignSelf: "center", marginTop: spacing.lg, padding: spacing.sm },
  rulesLabel: { ...typography.body, color: colors.accentText, fontWeight: "700", textDecorationLine: "underline" },
});
