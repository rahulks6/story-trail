import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ListSkeleton } from "../../components/Skeleton";
import { ActivityIndicator, Image, Pressable, RefreshControl, ScrollView, SectionList, StyleSheet, Text, View } from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../../navigation/types";
import { Icon } from "../../components/Icon";
import { colors, radii, spacing, typography, ICONS } from "../../theme";
import { useAuth } from "../../state/AuthContext";
import { useNotifications } from "../../state/NotificationsContext";
import { useRealtimeEvents } from "../../state/RealtimeContext";
import { askForPushOnce } from "../../push/usePushRegistration";
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type NotificationRecord,
} from "../../api/notifications";
import { getStoryOwnerUsername, mediaFileUrl } from "../../api/stories";
import { acceptFollowRequest, declineFollowRequest, followUser } from "../../api/users";
import { ApiError } from "../../api/client";
import { Avatar } from "../../components/Avatar";
import { VerifiedBadge } from "../../components/VerifiedBadge";
import { EmptyState } from "../../components/EmptyState";
import { Banner, Button } from "../../components/Form";
import { useScreenInsets } from "../../hooks/useScreenInsets";
import { serverDate, timeAgo } from "../../utils/serverTime";

const PAGE_SIZE = 20;

type ActivityTab = "all" | "like" | "comment" | "follow" | "mention";

// Three, not five: fewer chips, each easy to tap. "Comments" includes mentions (both are people talking to you).
const TABS: Array<{ key: ActivityTab; label: string }> = [
  { key: "all", label: "All" },
  { key: "follow", label: "Follows" },
  { key: "comment", label: "Comments" },
];

/** A `follow_request` reads as the same relationship-y thing a `follow` does — the "Follows" tab covers both rather than needing a 5th tab. */
function matchesTab(notification: NotificationRecord, tab: ActivityTab): boolean {
  if (tab === "all") return true;
  if (tab === "follow") return notification.type === "follow" || notification.type === "follow_request" || notification.type === "follow_accepted";
  if (tab === "comment") return notification.type === "comment" || notification.type === "mention";
  return notification.type === tab;
}

type ActivityNavigationProp = NativeStackNavigationProp<RootStackParamList, "Activity">;

function isToday(isoDate: string): boolean {
  const date = serverDate(isoDate);
  if (!date) return false;
  const now = new Date();
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}

/** About your own badge: no actor, and it opens Settings > Request verification. */
function verificationMessage(notification: NotificationRecord): string {
  switch (notification.verification?.status) {
    case "approved":
      return "You're verified. Your badge now shows on your profile.";
    case "denied":
      return "Your verification request wasn't approved.";
    case "removed":
      return "Your verified badge was removed.";
    case "restored":
      return "Your verified badge is showing again.";
    default:
      return "There's an update on your verification request.";
  }
}

function messageFor(notification: NotificationRecord): string {
  const name = notification.actor?.displayName ?? "Someone";
  switch (notification.type) {
    case "verification":
      return verificationMessage(notification);
    case "like":
      return `${name} liked your Story.`;
    case "comment":
      return `${name} commented: "${notification.comment?.body ?? ""}"`;
    case "follow":
      return `${name} started following you.`;
    case "follow_request":
      return `${name} requested to follow you.`;
    case "follow_accepted":
      return `${name} accepted your follow request.`;
    case "mention":
      // A mention sticker on their Story, or @you in a comment.
      return notification.comment ? `${name} mentioned you in a comment.` : `${name} mentioned you in their Story.`;
    default:
      return `${name} did something.`;
  }
}

interface GroupedLikeRow {
  kind: "grouped-like";
  key: string;
  unreadIds: string[];
  storyId: string;
  /** The Story's picture, shown at the row's end. */
  storyMediaId: string;
  actorNames: string[]; // up to 2, most recent first
  firstActor: NotificationRecord["actor"];
  totalCount: number;
  createdAt: string;
  anyUnread: boolean;
}

interface SingleRow {
  kind: "single";
  key: string;
  notification: NotificationRecord;
}

type ActivityRow = GroupedLikeRow | SingleRow;

function messageForGroup(row: GroupedLikeRow): string {
  const [first, second] = row.actorNames;
  if (row.totalCount <= 1) return `${first ?? "Someone"} liked your Story.`;
  if (row.totalCount === 2) return `${first} and ${second} liked your Story.`;
  const others = row.totalCount - 2;
  return `${first}, ${second} and ${others} other${others === 1 ? "" : "s"} liked your Story.`;
}

/**
 * Merges consecutive-by-story `like` notifications into one row — spec:
 * "Rahul, Priya and 12 others liked your Story" rather than a dozen
 * identical individual rows. Every other notification type (comment has
 * its own body per row; follow/follow_request/mention are each about a
 * distinct relationship or reference) stays one row per notification.
 * Grouping happens per Today/Earlier bucket, keyed by story id, keeping
 * each group's position at its most recent like (the list arrives
 * newest-first from the backend).
 */
function groupNotifications(notifications: NotificationRecord[]): ActivityRow[] {
  const rows: ActivityRow[] = [];
  const groupIndexByStoryId = new Map<string, number>();

  for (const notification of notifications) {
    if (notification.type === "like" && notification.story) {
      const storyId = notification.story.id;
      const existingIndex = groupIndexByStoryId.get(storyId);
      const actorName = notification.actor?.displayName ?? "Someone";
      if (existingIndex !== undefined) {
        const group = rows[existingIndex] as GroupedLikeRow;
        if (notification.readAt === null) {
          group.unreadIds.push(notification.id);
          group.anyUnread = true;
        }
        group.totalCount += 1;
        if (group.actorNames.length < 2) group.actorNames.push(actorName);
        continue;
      }
      const group: GroupedLikeRow = {
        kind: "grouped-like",
        key: `like-group-${storyId}`,
        unreadIds: notification.readAt === null ? [notification.id] : [],
        storyId,
        storyMediaId: notification.story.mediaId,
        actorNames: [actorName],
        firstActor: notification.actor,
        totalCount: 1,
        createdAt: notification.createdAt,
        anyUnread: notification.readAt === null,
      };
      groupIndexByStoryId.set(storyId, rows.length);
      rows.push(group);
      continue;
    }
    rows.push({ kind: "single", key: notification.id, notification });
  }

  return rows;
}

/**
 * Real notification list (spec section 31), grouped into Today/Earlier.
 * Tapping a like/comment/mention notification you own the Story for opens
 * that Story directly; a mention resolves the Story's real owner via
 * GET /api/v1/stories/:id/owner (Phase 8) since a mention's Story can
 * belong to anyone, unlike like/comment. A follow / follow_request, or a
 * mention whose owner lookup fails (e.g. the Story has since expired),
 * opens the actor's profile instead.
 */
export function ActivityScreen(): React.JSX.Element {
  const { accessToken, user } = useAuth();
  const insets = useScreenInsets();
  const { refreshUnreadCount } = useNotifications();
  const navigation = useNavigation<ActivityNavigationProp>();

  const [notifications, setNotifications] = useState<NotificationRecord[] | null>(null);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<ActivityTab>("all");
  // A failed load shows an error with a retry instead of a spinner that never ends.
  const [loadError, setLoadError] = useState<string | null>(null);
  const [moreFailed, setMoreFailed] = useState(false);

  const loadFirstPage = useCallback(async () => {
    if (!accessToken) return;
    try {
      const { notifications: page } = await listNotifications(accessToken, { limit: PAGE_SIZE, offset: 0 });
      setNotifications(page);
      setOffset(page.length);
      setHasMore(page.length === PAGE_SIZE);
      setMoreFailed(false);
      setLoadError(null);
      void refreshUnreadCount();
    } catch {
      setLoadError("Couldn't load your activity. Check your connection and try again.");
    }
  }, [accessToken, refreshUnreadCount]);

  // First visit: the moment notification permission makes sense to ask for (once).
  const askedForPush = useRef(false);
  useEffect(() => {
    if (askedForPush.current || !user?.id || !accessToken) return;
    askedForPush.current = true;
    void askForPushOnce(user.id, accessToken);
  }, [accessToken, user?.id]);

  const focused = useRef(false);
  const reloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      void loadFirstPage();
      return () => {
        focused.current = false;
      };
    }, [loadFirstPage]),
  );
  useEffect(() => () => {
    if (reloadTimer.current) clearTimeout(reloadTimer.current);
  }, []);
  // New Activity arrives over the realtime connection; a burst reloads once.
  useRealtimeEvents((event) => {
    if ((event.type !== "notification" && event.type !== "resync") || !focused.current || reloadTimer.current) return;
    reloadTimer.current = setTimeout(() => {
      reloadTimer.current = null;
      void loadFirstPage();
    }, 300);
  });

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await loadFirstPage();
    } finally {
      setRefreshing(false);
    }
  }, [loadFirstPage]);

  const loadMore = useCallback(async (retry = false) => {
    // After a failure, wait for a tap on "Try again" rather than retrying on every scroll.
    if (!accessToken || loadingMore || !hasMore || notifications === null || (moreFailed && !retry)) return;
    setLoadingMore(true);
    setMoreFailed(false);
    try {
      const { notifications: page } = await listNotifications(accessToken, { limit: PAGE_SIZE, offset });
      setNotifications((current) => [...(current ?? []), ...page]);
      setOffset((current) => current + page.length);
      setHasMore(page.length === PAGE_SIZE);
    } catch {
      setMoreFailed(true);
    } finally {
      setLoadingMore(false);
    }
  }, [accessToken, loadingMore, hasMore, notifications, offset, moreFailed]);

  const tabFiltered = useMemo(
    () => (notifications ?? []).filter((n) => matchesTab(n, activeTab)),
    [notifications, activeTab],
  );

  const sections = useMemo(() => {
    const today = tabFiltered.filter((n) => isToday(n.createdAt));
    const earlier = tabFiltered.filter((n) => !isToday(n.createdAt));
    return [
      ...(today.length ? [{ title: "Today", data: groupNotifications(today) }] : []),
      ...(earlier.length ? [{ title: "Earlier", data: groupNotifications(earlier) }] : []),
    ];
  }, [tabFiltered]);

  const unreadInList = notifications?.some((n) => n.readAt === null) ?? false;

  const markLocalRead = (ids: string[]) => {
    setNotifications((current) =>
      current ? current.map((n) => (ids.includes(n.id) ? { ...n, readAt: n.readAt ?? new Date().toISOString() } : n)) : current,
    );
  };

  const onPressRow = async (row: ActivityRow) => {
    if (row.kind === "grouped-like") {
      if (row.unreadIds.length > 0 && accessToken) {
        markLocalRead(row.unreadIds);
        Promise.all(row.unreadIds.map((id) => markNotificationRead(id, accessToken)))
          .then(() => refreshUnreadCount())
          .catch(() => {});
      }
      if (user) {
        // Same reasoning as the single-like case below: the recipient of a
        // like is always the Story's own owner.
        navigation.navigate("StoryViewer", { creators: [user.username], startIndex: 0, initialStoryId: row.storyId });
      }
      return;
    }

    const notification = row.notification;
    if (notification.readAt === null && accessToken) {
      markLocalRead([notification.id]);
      markNotificationRead(notification.id, accessToken)
        .then(() => refreshUnreadCount())
        .catch(() => {});
    }

    if ((notification.type === "like" || notification.type === "comment") && notification.story && user) {
      // The recipient of a like/comment notification is always the Story's
      // owner (see backend notifications.service.ts's notifyLike/notifyComment),
      // so the viewer's own username is the correct `creators` entry here.
      navigation.navigate("StoryViewer", {
        creators: [user.username],
        startIndex: 0,
        initialStoryId: notification.story.id,
      });
      return;
    }

    if (notification.type === "mention" && notification.story && accessToken) {
      // A mention's Story could belong to anyone, unlike like/comment —
      // resolve the real owner via GET /api/v1/stories/:id/owner rather
      // than guessing. Falls back to the actor's profile if that lookup
      // fails (e.g. the Story has since expired for this viewer).
      try {
        const { username: ownerUsername } = await getStoryOwnerUsername(notification.story.id, accessToken);
        navigation.navigate("StoryViewer", {
          creators: [ownerUsername],
          startIndex: 0,
          initialStoryId: notification.story.id,
        });
        return;
      } catch {
        // fall through to opening the actor's profile below
      }
    }

    if (notification.type === "verification") {
      navigation.navigate("Verification");
      return;
    }

    // Requests are answered on the Follow requests screen.
    if (notification.type === "follow_request") {
      navigation.navigate("FollowRequests");
      return;
    }

    if (notification.actor) {
      // initial: false keeps Search's own screen under the profile, so Back and the tab still work.
      navigation.navigate("Main", { screen: "Search", params: { screen: "UserProfile", params: { username: notification.actor.username }, initial: false } });
    }
  };

  // What a row ends with, like Instagram: Follow back, Confirm/Delete, or the Story's picture.
  const [followedBack, setFollowedBack] = useState<Record<string, "following" | "requested">>({});
  const [answered, setAnswered] = useState<Record<string, "accepted" | "declined">>({});
  const followBack = async (username: string) => {
    if (!accessToken) return;
    try {
      const status = await followUser(username, accessToken);
      setFollowedBack((m) => ({ ...m, [username]: status.status === "requested" ? "requested" : "following" }));
    } catch (e) {
      setLoadError(e instanceof ApiError ? e.message : "Couldn't follow. Check your connection and try again.");
    }
  };
  const answer = async (requestId: string, accept: boolean) => {
    if (!accessToken) return;
    try {
      if (accept) await acceptFollowRequest(requestId, accessToken);
      else await declineFollowRequest(requestId, accessToken);
      setAnswered((m) => ({ ...m, [requestId]: accept ? "accepted" : "declined" }));
    } catch (e) {
      setLoadError(e instanceof ApiError ? e.message : "Couldn't answer that request. Check your connection and try again.");
    }
  };
  const authHeaders = accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined;
  const trailing = (row: ActivityRow): React.ReactNode => {
    if (row.kind === "grouped-like") {
      return <Image source={{ uri: mediaFileUrl(row.storyMediaId, "thumbnail"), headers: authHeaders }} style={styles.thumb} accessibilityIgnoresInvertColors />;
    }
    const n = row.notification;
    if (n.type === "follow_request" && n.followRequest) {
      const done = answered[n.followRequest.id] ?? (n.followRequest.status !== "pending" ? (n.followRequest.status as "accepted" | "declined") : undefined);
      if (done) return <Text style={styles.trailingNote}>{done === "accepted" ? "Accepted" : "Deleted"}</Text>;
      const id = n.followRequest.id;
      return (
        <View style={styles.trailingButtons}>
          <Pressable onPress={() => void answer(id, true)} style={[styles.smallButton, styles.smallButtonPrimary]} accessibilityRole="button" accessibilityLabel={`Confirm @${n.actor?.username ?? ""}`}>
            <Text style={styles.smallButtonPrimaryText}>Confirm</Text>
          </Pressable>
          <Pressable onPress={() => void answer(id, false)} style={styles.smallButton} accessibilityRole="button" accessibilityLabel={`Delete @${n.actor?.username ?? ""}'s request`}>
            <Text style={styles.smallButtonText}>Delete</Text>
          </Pressable>
        </View>
      );
    }
    if ((n.type === "follow" || n.type === "follow_accepted") && n.actor) {
      const state = followedBack[n.actor.username];
      if (n.actor.followedByYou && !state) return null;
      const username = n.actor.username;
      return state ? (
        <Text style={styles.trailingNote}>{state === "requested" ? "Requested" : "Following"}</Text>
      ) : (
        <Pressable onPress={() => void followBack(username)} style={[styles.smallButton, styles.smallButtonPrimary]} accessibilityRole="button" accessibilityLabel={`Follow @${username} back`}>
          <Text style={styles.smallButtonPrimaryText}>Follow back</Text>
        </Pressable>
      );
    }
    if (n.story?.mediaId) {
      return <Image source={{ uri: mediaFileUrl(n.story.mediaId, "thumbnail"), headers: authHeaders }} style={styles.thumb} accessibilityIgnoresInvertColors />;
    }
    return null;
  };

  const onMarkAllRead = async () => {
    if (!accessToken) return;
    setNotifications((current) => (current ? current.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })) : current));
    try {
      await markAllNotificationsRead(accessToken);
    } catch {
      void loadFirstPage(); // show what is really unread again
    } finally {
      void refreshUnreadCount();
    }
  };

  // Opened from Home's heart: a way back, and the title, whatever the list is doing.
  const header = (
    <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
      <View style={styles.headerStart}>
        {navigation.canGoBack() ? (
          <Pressable onPress={() => navigation.goBack()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back">
            <Icon name={ICONS.back} size={24} color={colors.textPrimary} />
          </Pressable>
        ) : null}
        <Text style={typography.title}>Activity</Text>
      </View>
      {unreadInList ? (
        <Pressable onPress={onMarkAllRead} hitSlop={8} accessibilityRole="button">
          <Text style={styles.markAllRead}>Mark all read</Text>
        </Pressable>
      ) : null}
    </View>
  );

  if (notifications === null) {
    return (
      <View style={styles.container}>
      {header}
      <View style={styles.centered}>
        {loadError ? (
          <>
            <Text style={[typography.body, styles.loadError]}>{loadError}</Text>
            <Button label="Try again" onPress={() => void loadFirstPage()} />
          </>
        ) : (
          <View style={StyleSheet.absoluteFill}>
            <ListSkeleton label="Loading activity" />
          </View>
        )}
      </View>
      </View>
    );
  }

  if (notifications.length === 0) {
    return (
      <View style={styles.container}>
        {header}
        <EmptyState icon="activity" title="No activity yet" message="Likes, comments, and follows will show up here." />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {header}
      {loadError ? <Banner text={loadError} /> : null}
      {/* Scrolls sideways if the tabs don't fit (large text). */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabScroll} contentContainerStyle={styles.tabBar} accessibilityRole="tablist">
        {TABS.map((tab) => (
          <Pressable
            key={tab.key}
            style={[styles.tab, activeTab === tab.key && styles.tabActive]}
            onPress={() => setActiveTab(tab.key)}
            accessibilityRole="tab"
            accessibilityLabel={tab.label}
            accessibilityState={{ selected: activeTab === tab.key }}
          >
            <Text style={[styles.tabLabel, activeTab === tab.key && styles.tabLabelActive]} numberOfLines={1}>{tab.label}</Text>
          </Pressable>
        ))}
      </ScrollView>
      {tabFiltered.length === 0 ? (
        <View style={styles.emptyTab}>
          <EmptyState icon="activity" title={activeTab === "follow" ? "No new followers yet" : "No comments yet"} message={activeTab === "follow" ? "When someone follows you, you'll see it here." : "Comments and mentions on your Stories show up here."} />
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(row) => row.key}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accentText} />}
          onEndReachedThreshold={0.4}
          onEndReached={() => void loadMore()}
          contentContainerStyle={{ paddingBottom: insets.bottom + spacing.md }}
          renderSectionHeader={({ section }) => <Text style={styles.sectionHeader}>{section.title}</Text>}
          renderItem={({ item: row }) => {
            const actor = row.kind === "grouped-like" ? row.firstActor : row.notification.actor;
            const message = row.kind === "grouped-like" ? messageForGroup(row) : messageFor(row.notification);
            const aboutBadge = row.kind === "single" && row.notification.type === "verification";
            // The badge goes right after the actor's name, which starts the sentence.
            const badgeAfter = actor?.verified && message.startsWith(actor.displayName) ? actor.displayName.length : 0;
            const createdAt = row.kind === "grouped-like" ? row.createdAt : row.notification.createdAt;
            const unread = row.kind === "grouped-like" ? row.anyUnread : row.notification.readAt === null;
            const ago = timeAgo(createdAt);
            return (
              <Pressable
                style={styles.row}
                onPress={() => void onPressRow(row)}
                accessibilityRole="button"
                accessibilityLabel={[message.replace(/\.$/, ""), badgeAfter ? `${actor?.displayName} is verified` : "", ago, unread ? "Unread" : ""].filter(Boolean).join(". ")}
              >
                {aboutBadge ? (
                  <View style={styles.badgeIcon}>
                    <Icon name={ICONS.verified} size={28} color={colors.accentText} />
                  </View>
                ) : (
                  <Avatar username={actor?.username ?? ""} displayName={actor?.displayName ?? "?"} avatarMediaId={actor ? actor.avatarMediaId : null} />
                )}
                <View style={styles.rowText}>
                  <Text style={typography.body} numberOfLines={2}>
                    {badgeAfter ? (
                      <>
                        {message.slice(0, badgeAfter)}
                        <VerifiedBadge size={15} style={styles.inlineBadge} />
                        {message.slice(badgeAfter)}
                      </>
                    ) : message}
                  </Text>
                  <Text style={typography.caption}>{ago}</Text>
                </View>
                {unread ? <View style={styles.unreadDot} /> : null}
                {trailing(row)}
              </Pressable>
            );
          }}
          ListFooterComponent={
            loadingMore ? <ActivityIndicator color={colors.accentText} style={styles.footerSpinner} />
              : moreFailed ? <View style={styles.footerRetry}><Button label="Couldn't load more. Try again" variant="secondary" onPress={() => void loadMore(true)} /></View>
              : undefined
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  thumb: { width: 44, height: 58, borderRadius: radii.sm, backgroundColor: colors.surfaceElevated },
  trailingButtons: { flexDirection: "row", gap: spacing.xs },
  smallButton: { minHeight: 34, paddingHorizontal: spacing.md, borderRadius: radii.sm, justifyContent: "center", backgroundColor: colors.surfaceElevated },
  smallButtonPrimary: { backgroundColor: colors.accent },
  smallButtonText: { color: colors.textPrimary, fontWeight: "700", fontSize: 14 },
  smallButtonPrimaryText: { color: colors.onAccent, fontWeight: "700", fontSize: 14 },
  trailingNote: { ...typography.caption, color: colors.textSecondary },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background, padding: spacing.lg, gap: spacing.md },
  loadError: { textAlign: "center" },
  footerRetry: { padding: spacing.md },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.md,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
  },
  headerStart: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  markAllRead: { color: colors.accentText, fontSize: 13, fontWeight: "600" },
  tabScroll: { flexGrow: 0, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  tabBar: {
    flexDirection: "row",
    paddingHorizontal: spacing.md,
    gap: spacing.xs,
    paddingBottom: spacing.sm,
  },
  tab: { minHeight: 36, justifyContent: "center", paddingHorizontal: spacing.md, borderRadius: radii.pill, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  tabActive: { backgroundColor: colors.textPrimary, borderColor: colors.textPrimary },
  tabLabel: { ...typography.body, fontSize: 14, color: colors.textSecondary, fontWeight: "600" },
  tabLabelActive: { color: colors.background },
  emptyTab: { flex: 1, alignItems: "center", justifyContent: "center" },
  sectionHeader: {
    ...typography.label,
    backgroundColor: colors.background,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  rowText: { flex: 1, gap: 2 },
  // Same footprint as an Avatar, so the text lines up with the other rows.
  badgeIcon: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceElevated },
  inlineBadge: { marginRight: 2, transform: [{ translateY: 2 }] },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: radii.pill,
    backgroundColor: colors.accent,
  },
  footerSpinner: { marginVertical: spacing.md },
});
