import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Alert, Pressable, RefreshControl, ScrollView, Share, StyleSheet, Text, View } from "react-native";
import Clipboard from "@react-native-clipboard/clipboard";
import type { NativeStackScreenProps, NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useNavigation } from "@react-navigation/native";
import type { SearchStackParamList, RootStackParamList } from "../../navigation/types";
import { colors, radii, spacing, typography, ICONS } from "../../theme";
import { useAuth } from "../../state/AuthContext";
import { blockUser, followUser, getProfile, muteUser, unfollowUser, unmuteUser, type ProfileView } from "../../api/users";
import { track } from "../../analytics/analytics";
import { ApiError } from "../../api/client";
import { getUserActiveStories } from "../../api/stories";
import { openConversation } from "../../api/conversations";
import { HighlightsRow } from "../../components/HighlightsRow";
import { ReportSheet } from "../../components/ReportSheet";
import { Icon } from "../../components/Icon";
import { ProfileHeader, ProfileSkeleton } from "../../components/profile/ProfileHeader";
import { ProfileMoreSheet } from "../../components/profile/ProfileMoreSheet";
import { profileButton } from "../../components/profile/profileButton";
import { profileShareLink } from "../../navigation/profileLinks";

type Props = NativeStackScreenProps<SearchStackParamList, "UserProfile">;

/**
 * Someone's creator page (Phase 10), from Search, Activity or a shared link. Follow (with a
 * confirmation before unfollowing), Message, and More (share, copy link, mute, block, report).
 * A private account you don't follow shows only who it is. Stories open only from the photo
 * (spec sections 34 and 58).
 */
export function UserProfileScreen({ route, navigation }: Props): React.JSX.Element {
  // A shared link also carries the account ID, which finds the person after a rename. When it
  // does, the ID decides: the old name may belong to someone else by now.
  const { username: linkedUsername, userId } = route.params;
  const { accessToken } = useAuth();
  // StoryViewer, DM and the follow lists live on the root stack, above this Search stack.
  const rootNavigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [profile, setProfile] = useState<ProfileView | null>(null);
  const [hasActiveStory, setHasActiveStory] = useState(false);
  const [highlightCount, setHighlightCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionPending, setActionPending] = useState(false);
  const [messagePending, setMessagePending] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [scrollEnabled, setScrollEnabled] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);
  const countedProfile = useRef<string | null>(null);
  const username = profile?.username ?? linkedUsername;

  const load = useCallback(async (quiet = false) => {
    if (!accessToken) return;
    if (!quiet) setLoading(true);
    setError(null);
    try {
      const { profile: fetched } = await getProfile(userId ?? linkedUsername, accessToken);
      setProfile(fetched);
      // Admin analytics: someone else's profile opened (once per profile, not per refresh).
      if (!fetched.isSelf && countedProfile.current !== fetched.id) {
        countedProfile.current = fetched.id;
        track("profile_viewed");
      }
      // A private account not yet followed refuses its Stories list: that just means no ring.
      try {
        const { stories } = await getUserActiveStories(fetched.username, accessToken);
        setHasActiveStory(stories.length > 0);
      } catch {
        setHasActiveStory(false);
      }
    } catch (err) {
      setProfile(null);
      setError(err instanceof ApiError && err.status === 404 ? "This account isn't available." : "Couldn't load this profile.");
    } finally {
      setLoading(false);
    }
  }, [linkedUsername, userId, accessToken]);

  useEffect(() => {
    void load();
  }, [load]);

  useLayoutEffect(() => {
    navigation.setOptions({
      title: profile?.username ?? linkedUsername,
      headerRight:
        profile && !profile.isSelf
          ? () => (
              <Pressable onPress={() => setMoreOpen(true)} hitSlop={10} accessibilityRole="button" accessibilityLabel={`More options for @${profile.username}`}>
                <Icon name={ICONS.more} size={24} color={colors.textPrimary} />
              </Pressable>
            )
          : undefined,
    });
  }, [navigation, profile, linkedUsername]);

  const onRefresh = async () => {
    setRefreshing(true);
    setRefreshToken((n) => n + 1);
    await load(true);
    setRefreshing(false);
  };

  const runFollowChange = async (change: () => Promise<unknown>) => {
    setActionPending(true);
    setNotice(null);
    try {
      await change();
      await load(true);
    } catch {
      setNotice("That didn't go through. Try again.");
    } finally {
      setActionPending(false);
    }
  };

  const onMessagePress = async () => {
    if (!accessToken || messagePending) return;
    setMessagePending(true);
    setNotice(null);
    try {
      const { conversation } = await openConversation(username, accessToken);
      rootNavigation.navigate("Main", {
        screen: "DM",
        params: {
          screen: "Conversation",
          // The conversation list stays underneath, so Back leads to it.
          initial: false,
          params: { conversationId: conversation.id, otherUsername: conversation.otherUser.username, otherDisplayName: conversation.otherUser.displayName, otherAvatarMediaId: conversation.otherUser.avatarMediaId ?? null },
        },
      });
    } catch {
      setNotice("Couldn't open that conversation. Try again.");
    } finally {
      setMessagePending(false);
    }
  };

  if (loading && !profile) {
    return (
      <View style={[styles.screen, styles.padded]}>
        <ProfileSkeleton />
      </View>
    );
  }

  if (error || !profile) {
    return (
      <View style={[styles.screen, styles.centered]}>
        <Text style={[typography.body, styles.errorText]}>{error ?? "Couldn't load this profile."}</Text>
        {error !== "This account isn't available." ? (
          <Pressable style={styles.retry} onPress={() => void load()} accessibilityRole="button" accessibilityLabel="Try again">
            <Text style={typography.bodyStrong}>Try again</Text>
          </Pressable>
        ) : null}
      </View>
    );
  }

  const following = profile.viewer.isFollowing;
  const requested = profile.viewer.hasPendingRequestFromViewer;
  const followLabel = following ? "Following" : requested ? "Requested" : profile.viewer.isFollowedBy ? "Follow back" : "Follow";
  // A private account you don't follow shows who it is, not what it shares.
  const locked = profile.isPrivate && !profile.isSelf && !following;
  const link = profileShareLink(profile.username, profile.id);

  const onFollowPress = () => {
    if (!accessToken) return;
    if (!following && !requested) {
      void runFollowChange(() => followUser(username, accessToken));
      return;
    }
    Alert.alert(
      following ? `Unfollow @${username}?` : "Cancel your follow request?",
      following && profile.isPrivate ? "You'll need to ask again to see their Stories." : undefined,
      [
        { text: "Cancel", style: "cancel" },
        { text: following ? "Unfollow" : "Cancel request", style: "destructive", onPress: () => void runFollowChange(() => unfollowUser(username, accessToken)) },
      ],
    );
  };

  const onShare = async () => {
    try {
      await Share.share({ message: `@${profile.username} on Katkee: ${link}` });
    } catch {
      // Closing the share sheet isn't an error.
    }
  };

  const onToggleMute = async () => {
    if (!accessToken) return;
    const muting = !profile.viewer.isMutedByViewer;
    try {
      if (muting) await muteUser(username, accessToken);
      else await unmuteUser(username, accessToken);
      await load(true);
      Alert.alert(
        muting ? `@${username} muted` : `@${username} unmuted`,
        muting ? "You won't see their Stories on Home. They won't know." : "Their Stories can show on Home again.",
      );
    } catch {
      Alert.alert("Couldn't update", "Try again.");
    }
  };

  const onBlock = () => {
    if (!accessToken) return;
    Alert.alert(
      `Block @${username}?`,
      "They won't be able to find your profile, see your Stories or message you. Katkee won't tell them.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Block",
          style: "destructive",
          onPress: async () => {
            try {
              await blockUser(username, accessToken);
              navigation.goBack();
            } catch {
              Alert.alert("Couldn't block", "Try again.");
            }
          },
        },
      ],
    );
  };

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      scrollEnabled={scrollEnabled}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={colors.accent} />}
    >
      <ProfileHeader
        username={profile.username}
        displayName={profile.displayName}
        bio={profile.bio}
        interests={profile.interests ?? []}
        avatarMediaId={profile.avatarMediaId}
        isPrivate={profile.isPrivate}
        hasActiveStory={hasActiveStory}
        storyLabel={`Open ${profile.displayName}'s Story`}
        onOpenStory={() => rootNavigation.navigate("StoryViewer", { creators: [profile.username], startIndex: 0 })}
        followsYou={!profile.isSelf && profile.viewer.isFollowedBy}
        stats={[
          // Like the follower count, the number of Stories posted shows even on a private account.
          { key: "stories", value: profile.storyCount ?? null, singular: "Story", plural: "Stories" },
          {
            key: "followers", value: profile.followerCount, singular: "Follower", plural: "Followers",
            onPress: locked ? undefined : () => rootNavigation.navigate("FollowList", { username: profile.username, mode: "followers" }),
          },
          {
            key: "following", value: profile.followingCount, singular: "Following", plural: "Following",
            onPress: locked ? undefined : () => rootNavigation.navigate("FollowList", { username: profile.username, mode: "following" }),
          },
        ]}
      >
        <View style={styles.actions}>
          {profile.isSelf ? (
            <>
              {profileButton({ label: "Edit profile", onPress: () => rootNavigation.navigate("EditProfile") })}
              {profileButton({ label: "Share profile", onPress: () => void onShare() })}
            </>
          ) : (
            <>
              {profileButton({
                label: followLabel,
                variant: following || requested ? "secondary" : "primary",
                busy: actionPending,
                onPress: onFollowPress,
              })}
              {profileButton({ label: "Message", busy: messagePending, onPress: () => void onMessagePress() })}
            </>
          )}
        </View>
        {notice ? <Text style={styles.notice} accessibilityLiveRegion="polite">{notice}</Text> : null}
      </ProfileHeader>

      {locked ? (
        <View style={styles.card} accessible accessibilityLabel={`This account is private. Follow @${profile.username} to see their Stories and Highlights.`}>
          <View style={styles.cardIcon}>
            <Icon name={ICONS.privacy} size={22} color={colors.textPrimary} />
          </View>
          <Text style={styles.cardTitle}>This account is private</Text>
          <Text style={styles.cardBody}>Follow @{profile.username} to see their Stories and Highlights.</Text>
        </View>
      ) : (
        <>
          <HighlightsRow
            username={username}
            isOwner={profile.isSelf}
            onReorderModeChange={(active) => setScrollEnabled(!active)}
            onCountChange={setHighlightCount}
            refreshToken={refreshToken}
          />
          {!profile.isSelf && highlightCount === 0 ? (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>No Highlights yet</Text>
              <Text style={styles.cardBody}>When @{profile.username} keeps Stories in Highlights, they'll show here.</Text>
            </View>
          ) : null}
        </>
      )}

      <ProfileMoreSheet
        visible={moreOpen}
        username={profile.username}
        isMuted={profile.viewer.isMutedByViewer}
        onClose={() => setMoreOpen(false)}
        onShare={() => void onShare()}
        onCopyLink={() => {
          Clipboard.setString(link);
          Alert.alert("Link copied");
        }}
        onToggleMute={() => void onToggleMute()}
        onBlock={onBlock}
        onReport={() => setReportOpen(true)}
      />
      <ReportSheet visible={reportOpen} targetType="user" targetId={profile.id} onClose={() => setReportOpen(false)} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  padded: { paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  centered: { alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.xl, gap: spacing.md },
  errorText: { textAlign: "center", color: colors.textSecondary },
  retry: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radii.sm, backgroundColor: colors.surfaceElevated },
  content: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.xxl, gap: spacing.md },
  actions: { flexDirection: "row", gap: spacing.sm },
  notice: { ...typography.caption, color: colors.danger },
  card: {
    alignItems: "center",
    gap: spacing.xs,
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  cardIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 2,
    borderColor: colors.textPrimary,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.xs,
  },
  cardTitle: { ...typography.bodyStrong, textAlign: "center" },
  cardBody: { ...typography.caption, textAlign: "center" },
});
