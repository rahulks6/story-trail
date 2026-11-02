import React, { useCallback, useEffect, useRef, useState } from "react";
import { ListSkeleton } from "../../components/Skeleton";
import { Alert, FlatList, RefreshControl, StyleSheet, Text, TextInput, View } from "react-native";
import { Pressable } from "../../components/Pressable";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { DMStackParamList } from "../../navigation/types";
import { colors, radii, spacing, typography, ICONS } from "../../theme";
import { useAuth } from "../../state/AuthContext";
import { useDM } from "../../state/DMContext";
import { useRealtimeEvents } from "../../state/RealtimeContext";
import { askForPushOnce } from "../../push/usePushRegistration";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import { groupName, hideConversation, listConversations, setConversationMuted, type ConversationSummary } from "../../api/conversations";
import { ActionSheet } from "../../components/ActionSheet";
import { showToast } from "../../components/Toast";
import { actorName, groupEventText } from "../../models/groupEvents";
import { callLineText } from "../../models/callLines";
import { EmptyState } from "../../components/EmptyState";
import { Button } from "../../components/Form";
import { Avatar } from "../../components/Avatar";
import { VerifiedName } from "../../components/VerifiedBadge";
import { GroupAvatar } from "../../components/GroupAvatar";
import { Icon } from "../../components/Icon";
import { shareInvite } from "../../state/invites";
import { t } from "../../i18n";

/** The server's largest page; older conversations load as the list scrolls. */
const PAGE_SIZE = 50;

function previewText(conversation: ConversationSummary, myUserId: string | undefined): string {
  const lastMessage = conversation.lastMessage;
  if (!lastMessage) return t("dMInbox.noMessagesYet");
  if (lastMessage.event?.type === "call") return callLineText(lastMessage.event, lastMessage.senderId === myUserId);
  if (lastMessage.event) {
    const actor = actorName(lastMessage.senderId, myUserId, lastMessage.senderUsername);
    const known = new Map((conversation.group?.members ?? []).map((m) => [m.id, `@${m.username}`]));
    return groupEventText(lastMessage.event, actor, (id) => (id === myUserId ? "you" : known.get(id) ?? "someone"));
  }
  // In a group, whose message it was.
  const prefix = lastMessage.senderId === myUserId ? t("dMInbox.you") : conversation.kind === "group" && lastMessage.senderUsername ? `${lastMessage.senderUsername}: ` : "";
  if (lastMessage.sharedStoryId) return t("dMInbox.prefixSharedAStory", { prefix });
  if (lastMessage.mediaKind && !lastMessage.body) return `${prefix}Sent a ${lastMessage.mediaKind === "audio" ? "voice message" : lastMessage.mediaKind}`;
  return `${prefix}${lastMessage.body ?? ""}`;
}

/**
 * Real conversation list (spec sections 32-33). Stays current while open: a new
 * message or read receipt over the realtime connection reloads it (coalesced, so a
 * burst of events is one request). Search matches the other person's username or
 * name on the server.
 */
export function DMInboxScreen(): React.JSX.Element {
  const { accessToken, user } = useAuth();
  const { refreshUnreadCount } = useDM();
  const navigation = useNavigation<NativeStackNavigationProp<DMStackParamList>>();

  const [conversations, setConversations] = useState<ConversationSummary[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState("");
  const search = useDebouncedValue(query.trim(), 300);
  const focused = useRef(false);
  const reloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestRequest = useRef(0);
  const [hasMore, setHasMore] = useState(false);
  /** The conversation whose options are open (long-press a row). */
  const [menuFor, setMenuFor] = useState<ConversationSummary | null>(null);
  const patch = (id: string, change: Partial<ConversationSummary> | null) =>
    setConversations((current) => current && (change ? current.map((c) => (c.id === id ? { ...c, ...change } : c)) : current.filter((c) => c.id !== id)));
  const toggleMute = async (item: ConversationSummary) => {
    if (!accessToken) return;
    const next = !item.muted;
    patch(item.id, { muted: next });
    try {
      await setConversationMuted(item.id, next, accessToken);
      showToast(next ? t("common.notificationsMuted") : t("common.notificationsOn"));
    } catch {
      patch(item.id, { muted: !next });
      Alert.alert(t("common.couldntChangeThat"), t("dMInbox.checkYourConnectionAndTry"));
    }
  };
  const deleteChat = (item: ConversationSummary) => {
    Alert.alert(t("common.deleteThisChat"), t("dMInbox.itsRemovedFromYourInbox"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("common.delete"),
        style: "destructive",
        onPress: async () => {
          if (!accessToken) return;
          try {
            await hideConversation(item.id, accessToken);
            patch(item.id, null);
            void refreshUnreadCount();
          } catch {
            Alert.alert(t("common.couldntDelete"), t("dMInbox.checkYourConnectionAndTry"));
          }
        },
      },
    ]);
  };
  const loadingMore = useRef(false);
  // Which search the list on screen is for: a reload of the same one keeps the older pages already loaded.
  const listedSearch = useRef<string | null>(null);

  const load = useCallback(async () => {
    if (!accessToken) return;
    const request = ++latestRequest.current;
    try {
      const { conversations: fetched } = await listConversations(accessToken, { limit: PAGE_SIZE, q: search });
      if (request !== latestRequest.current) return; // an older search answered late
      const sameSearch = listedSearch.current === search;
      listedSearch.current = search;
      setConversations((current) => {
        if (!sameSearch || !current) return fetched;
        const fresh = new Set(fetched.map((c) => c.id));
        return [...fetched, ...current.slice(PAGE_SIZE).filter((c) => !fresh.has(c.id))];
      });
      if (!sameSearch) setHasMore(fetched.length === PAGE_SIZE);
      setFailed(false);
    } catch {
      if (request === latestRequest.current) setFailed(true);
    }
    void refreshUnreadCount();
  }, [accessToken, refreshUnreadCount, search]);

  /** The next page of older conversations (offset paging, as the server supports). */
  const loadMore = useCallback(async () => {
    if (!accessToken || !hasMore || loadingMore.current || !conversations) return;
    loadingMore.current = true;
    const request = latestRequest.current;
    try {
      const { conversations: older } = await listConversations(accessToken, { limit: PAGE_SIZE, offset: conversations.length, q: search });
      if (request !== latestRequest.current) return; // the search changed meanwhile
      setConversations((current) => {
        const known = new Set((current ?? []).map((c) => c.id));
        return [...(current ?? []), ...older.filter((c) => !known.has(c.id))];
      });
      setHasMore(older.length === PAGE_SIZE);
    } catch {
      // Scrolling again retries.
    } finally {
      loadingMore.current = false;
    }
  }, [accessToken, conversations, hasMore, search]);

  // First visit: the moment notification permission makes sense to ask for (once).
  const askedForPush = useRef(false);
  useEffect(() => {
    if (askedForPush.current || !user?.id || !accessToken) return;
    askedForPush.current = true;
    void askForPushOnce(user.id, accessToken);
  }, [accessToken, user?.id]);

  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      void load();
      return () => {
        focused.current = false;
      };
    }, [load]),
  );

  useEffect(() => () => {
    if (reloadTimer.current) clearTimeout(reloadTimer.current);
  }, []);

  useRealtimeEvents((event) => {
    const relevant = event.type === "message" || event.type === "resync" || (event.type === "receipt" && event.userId === user?.id);
    if (!relevant || !focused.current || reloadTimer.current) return;
    reloadTimer.current = setTimeout(() => {
      reloadTimer.current = null;
      void load();
    }, 300);
  });

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  const searchBox = (
    <View style={styles.searchRow}>
      <Pressable style={styles.newGroup} onPress={() => navigation.navigate("NewGroup", {})} accessibilityRole="button" accessibilityLabel={t("common.newGroup")}>
        <View style={styles.newGroupIcon}><Icon name={ICONS.add} size={18} color={colors.onAccent} /></View>
        <Text style={styles.newGroupText}>{t("common.newGroup")}</Text>
      </Pressable>
      <TextInput
        style={styles.searchInput}
        placeholder={t("dMInbox.searchMessagesByName")}
        placeholderTextColor={colors.textDisabled}
        autoCapitalize="none"
        autoCorrect={false}
        value={query}
        onChangeText={setQuery}
        maxLength={60}
        returnKeyType="search"
        accessibilityLabel={t("dMInbox.searchConversations")}
      />
    </View>
  );

  if (conversations === null) {
    return failed ? (
      <View style={styles.container}>
        <EmptyState title={t("dMInbox.couldntLoadMessages")} message={t("dMInbox.checkYourConnectionThenPull")} />
        <Pressable style={styles.retry} onPress={() => void load()} accessibilityRole="button">
          <Text style={styles.retryText}>{t("common.tryAgain")}</Text>
        </Pressable>
      </View>
    ) : (
      <ListSkeleton label={t("dMInbox.loadingMessages")} />
    );
  }

  if (conversations.length === 0 && !search) {
    return (
      <EmptyState icon="dm" title={t("dMInbox.noMessagesYet")} message={t("dMInbox.conversationsWithPeopleYouMessage")}>
        <View style={styles.emptyAction}>
          <Button label={t("common.newMessage")} onPress={() => navigation.navigate("NewChat")} />
          <Button label={t("common.newGroup")} variant="text" onPress={() => navigation.navigate("NewGroup", {})} />
          <Button label={t("common.inviteFriends")} variant="secondary" onPress={() => void shareInvite("messages", accessToken, user?.id)} />
        </View>
      </EmptyState>
    );
  }

  const menu = menuFor;
  return (
    <>
    <ActionSheet
      visible={menu !== null}
      onClose={() => setMenuFor(null)}
      groups={menu ? [[{ label: menu.muted ? t("common.unmuteNotifications") : t("common.muteNotifications"), onPress: () => void toggleMute(menu) }], [{ label: t("common.deleteChat"), destructive: true, onPress: () => deleteChat(menu) }]] : []}
    />
    <FlatList
      style={styles.container}
      data={conversations}
      keyExtractor={(item) => item.id}
      keyboardShouldPersistTaps="handled"
      onEndReachedThreshold={0.5}
      onEndReached={() => void loadMore()}
      ListHeaderComponent={searchBox}
      ListEmptyComponent={<Text style={styles.noMatches}>{t("dMInbox.noConversationsMatchSearch", { search })}</Text>}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accentText} />}
      renderItem={({ item }) => {
        const group = item.kind === "group" && item.group ? item.group : null;
        const person = item.otherUser;
        const name = group ? groupName(group.title, group.members, group.memberCount - 1) : person?.displayName ?? "";
        return (
        <Pressable
          style={styles.row}
          onPress={() =>
            navigation.navigate("Conversation", group
              ? { conversationId: item.id, group: true, title: name }
              : {
                  conversationId: item.id,
                  otherUsername: person?.username,
                  otherDisplayName: person?.displayName,
                  otherAvatarMediaId: person?.avatarMediaId ?? null,
                  otherVerified: !!person?.verified,
                })
          }
          onLongPress={() => setMenuFor(item)}
          accessibilityRole="button"
          accessibilityLabel={`${name}${!group && person?.verified ? ", verified" : ""}${group ? `, group of ${group.memberCount}` : ""}${item.unread ? ", unread" : ""}${item.muted ? ", muted" : ""}`}
          accessibilityHint={t("dMInbox.longPressForOptions")}
        >
          {group ? (
            <GroupAvatar members={group.members} size={48} />
          ) : person ? (
            <Avatar username={person.username} displayName={person.displayName} avatarMediaId={person.avatarMediaId} size={48} />
          ) : null}
          <View style={styles.rowText}>
            <VerifiedName name={name} verified={!group && !!person?.verified} style={typography.bodyStrong} />
            <Text style={[typography.caption, item.unread && styles.unreadPreview]} numberOfLines={1}>
              {previewText(item, user?.id)}
            </Text>
          </View>
          {item.muted ? <Icon name={ICONS.audioMuted} size={16} color={colors.textSecondary} /> : null}
          {item.unread ? <View style={styles.unreadDot} /> : null}
        </Pressable>
        );
      }}
    />
    </>
  );
}

const styles = StyleSheet.create({
  emptyAction: { marginTop: spacing.md, minWidth: 200, gap: spacing.xs },
  container: { flex: 1, backgroundColor: colors.background },
  searchRow: { paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.xs, gap: spacing.sm },
  newGroup: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 44 },
  newGroupIcon: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center" },
  newGroupText: { color: colors.textPrimary, fontSize: 15, fontWeight: "600" },
  searchInput: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    color: colors.textPrimary,
    fontSize: 15,
  },
  noMatches: { ...typography.caption, color: colors.textSecondary, textAlign: "center", padding: spacing.lg },
  retry: { alignSelf: "center", marginBottom: spacing.xxl, backgroundColor: colors.accent, borderRadius: radii.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  retryText: { color: colors.onAccent, fontWeight: "700" },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  rowText: { flex: 1, gap: 2 },
  unreadPreview: { color: colors.textPrimary, fontWeight: "600" },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: radii.pill,
    backgroundColor: colors.accent,
  },
});
