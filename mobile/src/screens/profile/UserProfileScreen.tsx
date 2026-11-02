import { showToast } from "../../components/Toast";
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Alert, RefreshControl, ScrollView, Share, StyleSheet, Text, View } from "react-native";
import { Pressable } from "../../components/Pressable";
import Clipboard from "@react-native-clipboard/clipboard";
import type { NativeStackScreenProps, NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useNavigation } from "@react-navigation/native";
import type { SearchStackParamList, RootStackParamList } from "../../navigation/types";
import { colors, radii, spacing, typography, ICONS } from "../../theme";
import { useAuth } from "../../state/AuthContext";
import { acceptFollowRequest, blockUser, declineFollowRequest, followUser, getProfile, listFollowRequests, muteUser, unfollowUser, unmuteUser, type ProfileView } from "../../api/users";
import { track } from "../../analytics/analytics";
import { ApiError } from "../../api/client";
import { getUserActiveStories } from "../../api/stories";
import { openConversation } from "../../api/conversations";
import { HighlightsRow } from "../../components/HighlightsRow";
import { ReportSheet } from "../../components/ReportSheet";
import { Icon } from "../../components/Icon";
import { StreakBadge } from "../../components/profile/StreakBadge";
import { ProfileHeader, ProfileSkeleton } from "../../components/profile/ProfileHeader";
import { ProfileMoreSheet } from "../../components/profile/ProfileMoreSheet";
import { profileButton } from "../../components/profile/profileButton";
import { profileShareLink } from "../../navigation/profileLinks";
import { t } from "../../i18n";

type Props = NativeStackScreenProps<SearchStackParamList, "UserProfile">;

/** The id of this person's pending request to follow you (the profile says one exists, not which). */
async function findFollowRequestId(requesterId: string, accessToken: string): Promise<string | null> {
  const limit = 50;
  for (let offset = 0; offset < 500; offset += limit) {
    const { requests } = await listFollowRequests(accessToken, { limit, offset });
    const match = requests.find((r) => r.requesterId === requesterId);
    if (match) return match.requestId;
    if (requests.length < limit) return null;
  }
  return null;
}

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
  const [requestPending, setRequestPending] = useState(false);
  const countedProfile = useRef<string | null>(null);
  const profileRef = useRef<ProfileView | null>(null);
  profileRef.current = profile;
  // One follow, mute or request answer at a time: a second tap mid-request is ignored.
  const actionInFlight = useRef(false);
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
      const gone = err instanceof ApiError && err.status === 404;
      if (quiet && profileRef.current && !gone) {
        // A background refresh (after Follow, Mute, pull-to-refresh) keeps what's on screen.
        setNotice(t("userProfile.couldntRefreshThisProfilePull"));
      } else {
        setProfile(null);
        setError(gone ? t("userProfile.thisAccountIsntAvailable") : t("userProfile.couldntLoadThisProfile"));
      }
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
              <Pressable onPress={() => setMoreOpen(true)} hitSlop={10} accessibilityRole="button" accessibilityLabel={t("userProfile.moreOptionsForUsername", { username: profile.username })}>
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
    if (actionInFlight.current) return;
    actionInFlight.current = true;
    setActionPending(true);
    setNotice(null);
    try {
      await change();
    } catch {
      setNotice(t("userProfile.thatDidntGoThroughTry"));
      return;
    } finally {
      actionInFlight.current = false;
      setActionPending(false);
    }
    await load(true);
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
      setNotice(t("userProfile.couldntOpenThatConversationTry"));
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
        <Text style={[typography.body, styles.errorText]}>{error ?? t("userProfile.couldntLoadThisProfile")}</Text>
        {error !== "This account isn't available." ? (
          <Pressable style={styles.retry} onPress={() => void load()} accessibilityRole="button" accessibilityLabel={t("common.tryAgain")}>
            <Text style={typography.bodyStrong}>{t("common.tryAgain")}</Text>
          </Pressable>
        ) : null}
      </View>
    );
  }

  const following = profile.viewer.isFollowing;
  const requested = profile.viewer.hasPendingRequestFromViewer;
  const followLabel = following ? t("common.following") : requested ? t("common.requested") : profile.viewer.isFollowedBy ? t("common.followBack") : t("common.follow");
  // A private account you don't follow shows who it is, not what it shares.
  const locked = profile.isPrivate && !profile.isSelf && !following;
  const link = profileShareLink(profile.username, profile.id);

  const onFollowPress = () => {
    if (!accessToken || actionInFlight.current) return;
    if (!following && !requested) {
      void runFollowChange(() => followUser(username, accessToken));
      return;
    }
    Alert.alert(
      following ? t("userProfile.unfollowUsername", { username }) : t("userProfile.cancelYourFollowRequest"),
      following && profile.isPrivate ? t("userProfile.youllNeedToAskAgain") : undefined,
      [
        { text: t("common.cancel"), style: "cancel" },
        { text: following ? t("userProfile.unfollow") : t("userProfile.cancelRequest"), style: "destructive", onPress: () => void runFollowChange(() => unfollowUser(username, accessToken)) },
      ],
    );
  };

  const onShare = async () => {
    try {
      await Share.share({ message: t("userProfile.usernameOnKatkeeLink", { username: profile.username, link }) });
    } catch {
      // Closing the share sheet isn't an error.
    }
  };

  const onToggleMute = async () => {
    if (!accessToken || actionInFlight.current) return;
    actionInFlight.current = true;
    const muting = !profile.viewer.isMutedByViewer;
    try {
      if (muting) await muteUser(username, accessToken);
      else await unmuteUser(username, accessToken);
    } catch {
      Alert.alert(t("common.couldntUpdate"), t("common.tryAgain2"));
      return;
    } finally {
      actionInFlight.current = false;
    }
    // Show the new state straight away; the refresh below confirms it.
    setProfile((current) => (current ? { ...current, viewer: { ...current.viewer, isMutedByViewer: muting } } : current));
    showToast(muting ? t("userProfile.mutedUsernameTheyWontKnow", { username }) : t("userProfile.unmutedUsername", { username }));
    await load(true);
  };

  // They asked to follow you: answer here, as on the Follow requests page.
  const onAnswerRequest = async (accept: boolean) => {
    if (!accessToken || actionInFlight.current) return;
    actionInFlight.current = true;
    setRequestPending(true);
    setNotice(null);
    try {
      const requestId = await findFollowRequestId(profile.id, accessToken);
      if (requestId) await (accept ? acceptFollowRequest(requestId, accessToken) : declineFollowRequest(requestId, accessToken));
    } catch (err) {
      // Answered on another device, or withdrawn: the refresh below shows how things stand.
      if (!(err instanceof ApiError && (err.status === 409 || err.status === 404))) {
        setNotice(t("userProfile.thatDidntGoThroughTry"));
        return;
      }
    } finally {
      actionInFlight.current = false;
      setRequestPending(false);
    }
    await load(true);
  };

  const onBlock = () => {
    if (!accessToken) return;
    Alert.alert(
      t("userProfile.blockUsername", { username }),
      t("userProfile.theyWontBeAbleTo"),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("common.block"),
          style: "destructive",
          onPress: async () => {
            try {
              await blockUser(username, accessToken);
              // Opened straight from a link, this profile is the only screen here: go to Search.
              if (navigation.canGoBack()) navigation.goBack();
              else navigation.navigate("SearchHome");
            } catch {
              Alert.alert(t("common.couldntBlock"), t("common.tryAgain2"));
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
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={colors.accentText} />}
    >
      <ProfileHeader
        username={profile.username}
        displayName={profile.displayName}
        bio={profile.bio}
        interests={profile.interests ?? []}
        avatarMediaId={profile.avatarMediaId}
        coverMediaId={profile.coverMediaId ?? null}
        coverBleed={{ sides: spacing.lg, top: spacing.md }}
        isPrivate={profile.isPrivate}
        verified={!!profile.verified}
        verifiedCategory={profile.verifiedCategory}
        professionalCategory={profile.professionalCategory}
        hasActiveStory={hasActiveStory}
        storyLabel={t("userProfile.openNamesStory", { name: profile.displayName })}
        onOpenStory={() => rootNavigation.navigate("StoryViewer", { creators: [profile.username], startIndex: 0, ...(profile.verified ? { verifiedCreators: [profile.username] } : {}) })}
        followsYou={!profile.isSelf && profile.viewer.isFollowedBy}
        stats={[
          // Like the follower count, the number of Stories posted shows even on a private account.
          { key: "stories", value: profile.storyCount ?? null },
          {
            key: "followers", value: profile.followerCount,
            onPress: locked ? undefined : () => rootNavigation.navigate("FollowList", { username: profile.username, mode: "followers" }),
          },
          {
            key: "following", value: profile.followingCount,
            onPress: locked ? undefined : () => rootNavigation.navigate("FollowList", { username: profile.username, mode: "following" }),
          },
        ]}
      >
        <StreakBadge streak={profile.streak} own={false} />
        <View style={styles.actions}>
          {profile.isSelf ? (
            <>
              {profileButton({ label: t("common.editProfile"), onPress: () => rootNavigation.navigate("EditProfile") })}
              {profileButton({ label: t("common.shareProfile"), onPress: () => void onShare() })}
            </>
          ) : (
            <>
              {profileButton({
                label: followLabel,
                variant: following || requested ? "secondary" : "primary",
                busy: actionPending,
                onPress: onFollowPress,
              })}
              {profileButton({ label: t("common.message"), busy: messagePending, onPress: () => void onMessagePress() })}
            </>
          )}
        </View>
        {!profile.isSelf && profile.viewer.hasPendingRequestFromTarget ? (
          <View style={styles.request}>
            <Text style={styles.requestText}>{t("userProfile.usernameWantsToFollowYou", { username: profile.username })}</Text>
            <View style={styles.actions}>
              {profileButton({ label: t("common.confirm"), variant: "primary", busy: requestPending, accessibilityLabel: t("userProfile.confirmFollowRequest"), onPress: () => void onAnswerRequest(true) })}
              {profileButton({ label: t("common.delete"), busy: requestPending, accessibilityLabel: t("userProfile.deleteFollowRequest"), onPress: () => void onAnswerRequest(false) })}
            </View>
          </View>
        ) : null}
        {notice ? <Text style={styles.notice} accessibilityLiveRegion="polite">{notice}</Text> : null}
      </ProfileHeader>

      {locked ? (
        <View style={styles.card} accessible accessibilityLabel={t("userProfile.thisAccountIsPrivateFollow", { username: profile.username })}>
          <View style={styles.cardIcon}>
            <Icon name={ICONS.privacy} size={22} color={colors.textPrimary} />
          </View>
          <Text style={styles.cardTitle}>{t("userProfile.thisAccountIsPrivate")}</Text>
          <Text style={styles.cardBody}>{t("userProfile.followUsernameToSeeTheir", { username: profile.username })}</Text>
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
              <Text style={styles.cardTitle}>{t("userProfile.noHighlightsYet")}</Text>
              <Text style={styles.cardBody}>{t("userProfile.whenUsernameKeepsStoriesIn", { username: profile.username })}</Text>
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
          showToast(t("common.linkCopied"));
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
  request: { gap: spacing.sm, padding: spacing.md, borderRadius: radii.md, backgroundColor: colors.surface },
  requestText: { ...typography.bodyStrong },
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
