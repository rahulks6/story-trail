import { Icon } from "../../components/Icon";
import React, { useCallback, useState } from "react";
import { Pressable, RefreshControl, ScrollView, Share, StyleSheet, Text, View } from "react-native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { colors, radii, spacing, typography, ICONS } from "../../theme";
import { useAuth } from "../../state/AuthContext";
import { getProfile } from "../../api/users";
import { getMyActiveStories } from "../../api/stories";
import { HighlightsRow } from "../../components/HighlightsRow";
import { ProfileHeader, ProfileSkeleton } from "../../components/profile/ProfileHeader";
import { getPostingStreak, type PostingStreak } from "../../api/festivals";
import { profileButton } from "../../components/profile/profileButton";
import { profileShareLink } from "../../navigation/profileLinks";
import type { RootStackParamList } from "../../navigation/types";
import { useScreenInsets } from "../../hooks/useScreenInsets";

/**
 * Your own creator page (Phase 10). Your name and bio come from your account (so an edit shows
 * at once); counts and the Story ring are fetched each time the tab is opened, and pulling down
 * refreshes everything. Stories open only from the photo (spec sections 34 and 58: no post
 * grid). Archive and Insights are yours alone.
 */
export function ProfileScreen(): React.JSX.Element {
  const { user, accessToken } = useAuth();
  const insets = useScreenInsets();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [counts, setCounts] = useState<{ followerCount: number; followingCount: number; storyCount: number | null } | null>(null);
  const [, setHighlightCount] = useState<number | null>(null);
  const [hasActiveStory, setHasActiveStory] = useState(false);
  const [scrollEnabled, setScrollEnabled] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);

  const load = useCallback(async () => {
    if (!user || !accessToken) return;
    try {
      const { profile } = await getProfile(user.username, accessToken);
      setCounts({ followerCount: profile.followerCount, followingCount: profile.followingCount, storyCount: profile.storyCount ?? null });
    } catch {
      // Non-fatal: the counts show dashes and the rest of the page still works.
    }
    try {
      const { stories } = await getMyActiveStories(accessToken);
      setHasActiveStory(stories.length > 0);
    } catch {
      setHasActiveStory(false);
    }
  }, [user, accessToken]);

  // Your posting streak: consecutive days with a Story (India time, like the reminders).
  const [streak, setStreak] = useState<PostingStreak | null>(null);
  const loadStreak = useCallback(() => {
    if (!accessToken) return;
    getPostingStreak(accessToken).then(({ streak: s }) => setStreak(s)).catch(() => undefined);
  }, [accessToken]);

  // Each visit: back from posting a Story or following someone, the ring and counts are current.
  useFocusEffect(
    useCallback(() => {
      void load();
      loadStreak();
    }, [load, loadStreak]),
  );

  if (!user) {
    return (
      <View style={[styles.screen, { paddingTop: insets.top + spacing.lg, paddingHorizontal: spacing.lg }]}>
        <ProfileSkeleton />
      </View>
    );
  }

  const onRefresh = async () => {
    setRefreshing(true);
    setRefreshToken((n) => n + 1);
    await load();
    setRefreshing(false);
  };

  const onShareProfile = async () => {
    try {
      await Share.share({ message: `@${user.username} on Katkee: ${profileShareLink(user.username, user.id)}` });
    } catch {
      // Closing the share sheet isn't an error.
    }
  };

  return (
    <View style={styles.screen}>
      <View style={[styles.topBar, { paddingTop: insets.top + spacing.xs }]}>
        <View style={styles.topBarTitle}>
          {user.isPrivate ? (
            <View accessible accessibilityLabel="Private account">
              <Icon name={ICONS.privacy} size={16} color={colors.textPrimary} />
            </View>
          ) : null}
          <Text style={styles.topBarUsername} numberOfLines={1} accessibilityRole="header">{user.username}</Text>
        </View>
        <View style={styles.topBarActions}>
          <Pressable style={styles.topBarButton} onPress={() => navigation.navigate("Archive")} hitSlop={8} accessibilityRole="button" accessibilityLabel="Archive">
            <Icon name={ICONS.archive} size={24} color={colors.textPrimary} />
          </Pressable>
          <Pressable style={styles.topBarButton} onPress={() => navigation.navigate("Settings")} hitSlop={8} accessibilityRole="button" accessibilityLabel="Settings">
            <Icon name={ICONS.settings} size={24} color={colors.textPrimary} />
          </Pressable>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        scrollEnabled={scrollEnabled}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={colors.accent} />}
      >
        {user.email && user.emailVerified === false ? (
          // Until the email is confirmed: a gentle reminder, never a block.
          <Pressable
            style={({ pressed }) => [styles.verify, pressed && styles.dashboardPressed]}
            onPress={() => navigation.navigate("VerifyEmail")}
            accessibilityRole="button"
            accessibilityLabel="Verify your email"
            accessibilityHint={`Enter the code we sent to ${user.email}`}
          >
            <View style={styles.verifyText}>
              <Text style={styles.verifyTitle}>Verify your email</Text>
              <Text style={styles.verifyBody} numberOfLines={2}>Confirm {user.email} so you can always get back into your account.</Text>
            </View>
            <Text style={styles.verifyAction}>Verify</Text>
          </Pressable>
        ) : null}
        <ProfileHeader
          username={user.username}
          displayName={user.displayName}
          bio={user.bio}
          interests={user.interests ?? []}
          avatarMediaId={user.avatarMediaId}
          isPrivate={user.isPrivate}
          hasActiveStory={hasActiveStory}
          storyLabel="Open your Story"
          onOpenStory={() => navigation.navigate("StoryViewer", { creators: [user.username], startIndex: 0 })}
          onAddStory={() => navigation.navigate("Main", { screen: "Create" })}
          stats={[
            // Everyone sees how many Stories have been posted so far.
            { key: "stories", value: counts?.storyCount ?? null, singular: "Story", plural: "Stories" },
            {
              key: "followers", value: counts?.followerCount ?? null, singular: "Follower", plural: "Followers",
              onPress: () => navigation.navigate("FollowList", { username: user.username, mode: "followers" }),
            },
            {
              key: "following", value: counts?.followingCount ?? null, singular: "Following", plural: "Following",
              onPress: () => navigation.navigate("FollowList", { username: user.username, mode: "following" }),
            },
          ]}
        >
          {streak && streak.days > 0 ? (
            <View style={styles.streak} accessibilityLabel={`${streak.days}-day posting streak${streak.postedToday ? "" : ". Post today to keep it"}`}>
              <Text style={styles.streakLabel}>🔥 {streak.days}-day streak</Text>
              {!streak.postedToday ? <Text style={styles.streakHint}>Post today to keep it</Text> : null}
            </View>
          ) : null}
          <View style={styles.actions}>
            {profileButton({ label: "Edit profile", onPress: () => navigation.navigate("EditProfile") })}
            {profileButton({ label: "Share profile", onPress: () => void onShareProfile() })}
          </View>
        </ProfileHeader>

        <Pressable
          style={({ pressed }) => [styles.dashboard, pressed && styles.dashboardPressed]}
          onPress={() => navigation.navigate("SequenceInsights")}
          accessibilityRole="button"
          accessibilityLabel="Insights. See how your Stories are doing. Only you can see this."
        >
          <View style={styles.dashboardIcon}>
            <Icon name={ICONS.insights} size={20} color={colors.accent} />
          </View>
          <View style={styles.dashboardText}>
            <Text style={styles.dashboardTitle}>Insights</Text>
            <Text style={styles.dashboardBody}>See how your Stories are doing. Only you can see this.</Text>
          </View>
          <Icon name={ICONS.chevron} size={18} color={colors.textSecondary} />
        </Pressable>

        <HighlightsRow
          username={user.username}
          isOwner
          onReorderModeChange={(active) => setScrollEnabled(!active)}
          onCountChange={setHighlightCount}
          refreshToken={refreshToken}
        />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  streak: { flexDirection: "row", alignItems: "center", gap: spacing.sm, alignSelf: "flex-start", marginTop: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radii.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  streakLabel: { ...typography.body, color: colors.textPrimary, fontWeight: "700" },
  streakHint: { ...typography.caption, color: colors.textSecondary },
  screen: { flex: 1, backgroundColor: colors.background },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
    backgroundColor: colors.background,
  },
  topBarTitle: { flexDirection: "row", alignItems: "center", gap: spacing.xs, flexShrink: 1 },
  topBarUsername: { ...typography.title, flexShrink: 1 },
  topBarActions: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  topBarButton: { padding: spacing.xs },
  content: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.xxl, gap: spacing.md },
  actions: { flexDirection: "row", gap: spacing.sm },
  dashboard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 4,
  },
  dashboardPressed: { backgroundColor: colors.surfaceElevated },
  verify: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.accent,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 4,
  },
  verifyText: { flex: 1, gap: 2 },
  verifyTitle: { ...typography.bodyStrong },
  verifyBody: { ...typography.caption },
  verifyAction: { color: colors.accent, fontWeight: "700", fontSize: 15 },
  dashboardIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surfaceElevated,
    alignItems: "center",
    justifyContent: "center",
  },
  dashboardText: { flex: 1, gap: 2 },
  dashboardTitle: { ...typography.bodyStrong },
  dashboardBody: { ...typography.caption },
});
