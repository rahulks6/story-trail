import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { DMStackParamList } from "../../navigation/types";
import { colors, radii, spacing, typography } from "../../theme";
import { useAuth } from "../../state/AuthContext";
import { useDM } from "../../state/DMContext";
import { useRealtimeEvents } from "../../state/RealtimeContext";
import { askForPushOnce } from "../../push/usePushRegistration";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import { listConversations, type ConversationSummary } from "../../api/conversations";
import { EmptyState } from "../../components/EmptyState";

function previewText(conversation: ConversationSummary, myUserId: string | undefined): string {
  const lastMessage = conversation.lastMessage;
  if (!lastMessage) return "Say hi 👋";
  const prefix = lastMessage.senderId === myUserId ? "You: " : "";
  if (lastMessage.sharedStoryId) return `${prefix}Shared a Story`;
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

  const load = useCallback(async () => {
    if (!accessToken) return;
    const request = ++latestRequest.current;
    try {
      const { conversations: fetched } = await listConversations(accessToken, { limit: 50, q: search });
      if (request !== latestRequest.current) return; // an older search answered late
      setConversations(fetched);
      setFailed(false);
    } catch {
      if (request === latestRequest.current) setFailed(true);
    }
    void refreshUnreadCount();
  }, [accessToken, refreshUnreadCount, search]);

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
      <TextInput
        style={styles.searchInput}
        placeholder="Search messages by name"
        placeholderTextColor={colors.textDisabled}
        autoCapitalize="none"
        autoCorrect={false}
        value={query}
        onChangeText={setQuery}
        maxLength={60}
        returnKeyType="search"
        accessibilityLabel="Search conversations"
      />
    </View>
  );

  if (conversations === null) {
    return failed ? (
      <View style={styles.container}>
        <EmptyState title="Couldn't load messages" message="Check your connection, then pull down to try again." />
        <Pressable style={styles.retry} onPress={() => void load()} accessibilityRole="button">
          <Text style={styles.retryText}>Try again</Text>
        </Pressable>
      </View>
    ) : (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  if (conversations.length === 0 && !search) {
    return <EmptyState title="No messages yet" message="Conversations with people you message will appear here." />;
  }

  return (
    <FlatList
      style={styles.container}
      data={conversations}
      keyExtractor={(item) => item.id}
      keyboardShouldPersistTaps="handled"
      ListHeaderComponent={searchBox}
      ListEmptyComponent={<Text style={styles.noMatches}>No conversations match “{search}”.</Text>}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
      renderItem={({ item }) => (
        <Pressable
          style={styles.row}
          onPress={() =>
            navigation.navigate("Conversation", {
              conversationId: item.id,
              otherUsername: item.otherUser.username,
              otherDisplayName: item.otherUser.displayName,
            })
          }
          accessibilityRole="button"
          accessibilityLabel={`${item.otherUser.displayName}${item.unread ? ", unread" : ""}`}
        >
          <View style={styles.avatarPlaceholder}>
            <Text style={styles.avatarInitial}>{item.otherUser.displayName.charAt(0).toUpperCase()}</Text>
          </View>
          <View style={styles.rowText}>
            <Text style={typography.bodyStrong}>{item.otherUser.displayName}</Text>
            <Text style={[typography.caption, item.unread && styles.unreadPreview]} numberOfLines={1}>
              {previewText(item, user?.id)}
            </Text>
          </View>
          {item.unread ? <View style={styles.unreadDot} /> : null}
        </Pressable>
      )}
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  searchRow: { paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.xs },
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
  avatarPlaceholder: {
    width: 48,
    height: 48,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceElevated,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarInitial: { color: colors.textPrimary, fontWeight: "700", fontSize: 18 },
  rowText: { flex: 1, gap: 2 },
  unreadPreview: { color: colors.textPrimary, fontWeight: "600" },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: radii.pill,
    backgroundColor: colors.accent,
  },
});
