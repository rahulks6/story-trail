import { Icon } from "../../components/Icon";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  AppState,
  FlatList,
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { useHeaderHeight } from "@react-navigation/elements";
import type { NativeStackNavigationProp, NativeStackScreenProps } from "@react-navigation/native-stack";
import type { DMStackParamList, RootStackParamList } from "../../navigation/types";
import { colors, radii, spacing, typography, ICONS } from "../../theme";
import { useAuth } from "../../state/AuthContext";
import { useDM } from "../../state/DMContext";
import { useRealtime, useRealtimeEvents } from "../../state/RealtimeContext";
import {
  discardMessage,
  enqueueMessage,
  flushOutbox,
  loadOutbox,
  onOutboxSent,
  pendingMessages,
  retryMessage,
  subscribeOutbox,
  type OutboxMessage,
} from "../../state/dmOutbox";
import { getConversation, listMessages, markConversationRead, MAX_MESSAGE_LENGTH, type Message } from "../../api/conversations";
import { ApiError } from "../../api/client";
import { getStoryOwnerUsername } from "../../api/stories";
import { ReportSheet } from "../../components/ReportSheet";
import { KeyboardAvoider } from "../../components/KeyboardAvoider";
import { applyReceipt, mergeMessages, newestId, oldestId } from "./threadState";

type Props = NativeStackScreenProps<DMStackParamList, "Conversation">;

const PAGE_SIZE = 30;
/** Fallback polling: often while the live connection is down, rarely (a safety net) while it's up. */
const POLL_OFFLINE_MS = 4_000;
const POLL_LIVE_MS = 30_000;
/** Catching up after a long gap: past this many pages, reload the latest page instead. */
const MAX_CATCH_UP_PAGES = 5;

// A fixed, client-only emoji set — there's no attachment/media pipeline in
// this DM module (see conversations/dto.ts's parseSendMessageInput, body
// text or a shared Story only), so this inserts into the text composer
// rather than sending as its own message kind.
const EMOJIS = [
  "😀", "😂", "😍", "😊", "😉", "😢", "😮", "😡",
  "👍", "👎", "🙏", "👏", "🔥", "💯", "🎉", "❤️",
  "😴", "🤔", "😎", "🥳", "😭", "🤝", "👋", "✨",
];

/**
 * A message not yet stored by the server (spec's Sending/Failed states), from the
 * persisted DM outbox (state/dmOutbox.ts): it survives the app closing and is sent
 * once, in order, as soon as possible. A message that exists server-side is
 * definitionally at least "sent" (Sent/Delivered/Read come from the server and
 * from realtime read receipts).
 */
type ListRow = (OutboxMessage & { kind: "pending" }) | (Message & { kind: "sent" });

function rowKey(row: ListRow): string {
  return row.kind === "pending" ? row.clientMessageId : row.id;
}

function statusLabel(row: ListRow): string {
  if (row.kind === "pending") {
    if (row.status === "failed") return `${row.error ?? "Not sent"} · Tap to retry`;
    return row.status === "waiting" && row.attempts > 0 ? "Waiting for connection…" : "Sending…";
  }
  switch (row.status) {
    case "read":
      return "Read";
    case "delivered":
      return "Delivered";
    default:
      return "Sent";
  }
}

/**
 * Real message thread (spec sections 32-33). The list is `inverted` with data
 * kept in the backend's own newest-first order — the standard React Native chat
 * pattern (bottom of screen = index 0), so "load older" is just `onEndReached`.
 * New messages and read receipts arrive over the realtime connection; history
 * pages use message-id cursors, which don't shift as new messages arrive.
 */
export function ConversationScreen({ route }: Props): React.JSX.Element {
  const { conversationId, otherUsername } = route.params;
  const { accessToken, user } = useAuth();
  const { refreshUnreadCount } = useDM();
  const { connected } = useRealtime();
  const navigation = useNavigation<NativeStackNavigationProp<DMStackParamList>>();
  const rootNavigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const headerHeight = useHeaderHeight();

  const [messages, setMessages] = useState<Message[] | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [composerError, setComposerError] = useState<string | null>(null);
  const [outbox, setOutbox] = useState<OutboxMessage[]>([]);
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const [reportingMessageId, setReportingMessageId] = useState<string | null>(null);
  const focusedRef = useRef(true);
  const messagesRef = useRef<Message[] | null>(null);
  messagesRef.current = messages;
  const tokenRef = useRef(accessToken);
  tokenRef.current = accessToken;
  const userId = user?.id;
  const getToken = useCallback(() => tokenRef.current, []);

  // A notification link carries only the conversation id: fill in who it's with.
  useEffect(() => {
    if (otherUsername || !accessToken) return;
    getConversation(conversationId, accessToken)
      .then(({ conversation }) => navigation.setParams({
        otherUsername: conversation.otherUser.username,
        otherDisplayName: conversation.otherUser.displayName,
      }))
      .catch((error: unknown) => {
        if (error instanceof ApiError && error.status === 404) setLoadError("This conversation isn't available.");
      });
  }, [accessToken, conversationId, navigation, otherUsername]);

  // Unsent messages for this thread, kept in sync with the persisted outbox.
  useEffect(() => {
    if (!userId) return;
    const sync = () => setOutbox(pendingMessages(userId, conversationId));
    const unsubscribe = subscribeOutbox(sync);
    void loadOutbox(userId).then(sync);
    const unsubscribeSent = onOutboxSent((owner, _entry, message) => {
      if (owner === userId && message.conversationId === conversationId) {
        setMessages((current) => mergeMessages(current ?? [], [message]));
      }
    });
    return () => { unsubscribe(); unsubscribeSent(); };
  }, [conversationId, userId]);

  const markRead = useCallback(() => {
    const token = tokenRef.current;
    if (!token || !focusedRef.current || AppState.currentState !== "active") return;
    void markConversationRead(conversationId, token).catch(() => undefined).then(() => refreshUnreadCount());
  }, [conversationId, refreshUnreadCount]);

  /**
   * The latest page. Merged into the thread (which also refreshes the statuses of
   * recent messages), or replacing it when `replace` (after a gap too long to fill).
   */
  const loadLatest = useCallback(async (replace = false) => {
    const token = tokenRef.current;
    if (!token) return;
    try {
      const page = await listMessages(conversationId, token, { limit: PAGE_SIZE });
      const first = messagesRef.current === null;
      setMessages((current) => (replace || !current ? page.messages : mergeMessages(current, page.messages)));
      if (first || replace) setHasMore(page.messages.length === PAGE_SIZE);
      setLoadError(null);
      if (page.messages.some((m) => m.senderId !== userId)) markRead();
    } catch (error) {
      if (messagesRef.current === null) {
        setLoadError(error instanceof ApiError && error.status === 404 ? "This conversation isn't available." : "Couldn't load messages. Check your connection and try again.");
      }
    }
  }, [conversationId, markRead, userId]);

  const catchingUp = useRef<Promise<void> | null>(null);
  /** Fetches everything newer than what the thread has, page by page. */
  const catchUp = useCallback(async () => {
    if (catchingUp.current) return catchingUp.current;
    const work = (async () => {
      const token = tokenRef.current;
      const known = messagesRef.current;
      const after = known ? newestId(known) : null;
      if (!token || !after) return loadLatest();
      try {
        let cursor = after;
        let receivedFromOther = false;
        for (let page = 0; page < MAX_CATCH_UP_PAGES; page++) {
          const result = await listMessages(conversationId, token, { after: cursor, limit: PAGE_SIZE });
          if (result.messages.length) {
            setMessages((current) => mergeMessages(current ?? [], result.messages));
            receivedFromOther ||= result.messages.some((m) => m.senderId !== userId);
            cursor = result.messages[0]!.id;
          }
          if (!result.hasMore) {
            if (receivedFromOther) markRead();
            return;
          }
        }
        await loadLatest(true); // a very long gap: start again from the latest page
      } catch {
        // Offline: the next event, resync or poll tries again.
      }
    })();
    catchingUp.current = work;
    try { await work; } finally { catchingUp.current = null; }
  }, [conversationId, loadLatest, markRead, userId]);

  /** Everything new since the thread was last current, then fresh statuses for recent messages. */
  const syncThread = useCallback(async () => {
    await catchUp();
    await loadLatest();
  }, [catchUp, loadLatest]);

  useRealtimeEvents((event) => {
    if (event.type === "resync") {
      void syncThread(); // reconnected: anything could have happened meanwhile
    } else if (event.type === "message" && event.conversationId === conversationId) {
      void catchUp();
    } else if (event.type === "receipt" && event.conversationId === conversationId && userId && event.userId !== userId) {
      setMessages((current) => (current ? applyReceipt(current, userId, event) : current));
    }
  });

  useFocusEffect(
    useCallback(() => {
      focusedRef.current = true;
      void syncThread();
      const interval = setInterval(() => {
        if (AppState.currentState === "active") void catchUp();
      }, connected ? POLL_LIVE_MS : POLL_OFFLINE_MS);
      return () => {
        focusedRef.current = false;
        clearInterval(interval);
      };
    }, [catchUp, connected, syncThread]),
  );

  const loadOlder = useCallback(async () => {
    const token = tokenRef.current;
    const current = messagesRef.current;
    const before = current ? oldestId(current) : null;
    if (!token || loadingMore || !hasMore || !before) return;
    setLoadingMore(true);
    try {
      const page = await listMessages(conversationId, token, { before, limit: PAGE_SIZE });
      setMessages((existing) => mergeMessages(existing ?? [], page.messages));
      setHasMore(page.hasMore ?? page.messages.length === PAGE_SIZE);
    } catch {
      // Scrolling up again retries.
    } finally {
      setLoadingMore(false);
    }
  }, [conversationId, hasMore, loadingMore]);

  const onSend = async () => {
    const body = draft.trim();
    if (!body || !userId) return;
    try {
      await enqueueMessage(userId, conversationId, { body });
      setDraft("");
      setComposerError(null);
      void flushOutbox(userId, getToken, { force: true });
    } catch (error) {
      setComposerError(error instanceof Error ? error.message : "Couldn't send that message.");
    }
  };

  const onPendingPress = (row: OutboxMessage) => {
    if (!userId || row.status === "sending") return;
    Alert.alert(row.status === "failed" ? "Message not sent" : "Message waiting to send", row.error ?? undefined, [
      { text: "Try again", onPress: () => void retryMessage(userId, row.clientMessageId, getToken) },
      { text: "Delete", style: "destructive", onPress: () => void discardMessage(userId, row.clientMessageId) },
      { text: "Cancel", style: "cancel" },
    ]);
  };

  // Long-press a message the other person sent to report it (DM safety workflow). Screen
  // reader users get the same choice as an action on the message.
  const canReport = (row: ListRow): row is Message & { kind: "sent" } => row.kind === "sent" && row.senderId !== userId;
  const onMessageLongPress = (row: ListRow) => {
    if (!canReport(row)) return;
    Alert.alert("Message", undefined, [
      { text: "Report", style: "destructive", onPress: () => setReportingMessageId(row.id) },
      { text: "Cancel", style: "cancel" },
    ]);
  };

  const toggleEmojiPicker = () => {
    // The panel replaces the keyboard rather than stacking on top of it.
    if (!emojiPickerOpen) Keyboard.dismiss();
    setEmojiPickerOpen((open) => !open);
  };

  const onInsertEmoji = (emoji: string) => {
    setDraft((current) => (current + emoji).slice(0, MAX_MESSAGE_LENGTH));
  };

  const onOpenSharedStory = async (storyId: string) => {
    if (!accessToken) return;
    try {
      const { username: ownerUsername } = await getStoryOwnerUsername(storyId, accessToken);
      rootNavigation.navigate("StoryViewer", { creators: [ownerUsername], startIndex: 0, initialStoryId: storyId });
    } catch {
      // The Story is no longer accessible (expired/deleted) — nothing to open.
    }
  };

  const rows: ListRow[] = useMemo(() => {
    const stored = messages ?? [];
    // An outbox entry the server already stored (seen via realtime before the send
    // response came back) is shown once, as the stored message.
    const storedIds = new Set(stored.flatMap((m) => (m.clientMessageId ? [m.clientMessageId] : [])));
    const pending = outbox.filter((m) => !storedIds.has(m.clientMessageId)).reverse().map((m) => ({ ...m, kind: "pending" as const }));
    return [...pending, ...stored.map((m) => ({ ...m, kind: "sent" as const }))];
  }, [outbox, messages]);

  // A status caption only ever makes sense under the single most recent
  // message *you* sent — same convention as iMessage/WhatsApp. If the
  // newest row in the thread is pending, that's it; if it's a confirmed
  // message but from the other person (they replied after your last
  // message), nothing shows at all. Failed messages always show theirs.
  const statusRowKey = useMemo(() => {
    const first = rows[0];
    if (!first) return null;
    if (first.kind === "pending") return first.clientMessageId;
    return first.senderId === userId ? first.id : null;
  }, [rows, userId]);

  if (messages === null) {
    return (
      <View style={styles.centered}>
        {loadError ? (
          <>
            <Text style={[typography.body, styles.loadError]}>{loadError}</Text>
            <Pressable style={styles.retryButton} onPress={() => void loadLatest(true)} accessibilityRole="button">
              <Text style={styles.retryButtonText}>Try again</Text>
            </Pressable>
          </>
        ) : (
          <ActivityIndicator color={colors.accent} />
        )}
      </View>
    );
  }

  return (
    <KeyboardAvoider style={styles.container} topOffset={headerHeight}>
      <FlatList
        style={styles.list}
        contentContainerStyle={styles.listContent}
        data={rows}
        inverted
        keyExtractor={rowKey}
        onEndReachedThreshold={0.4}
        onEndReached={() => void loadOlder()}
        renderItem={({ item: row }) => {
          const mine = row.kind === "pending" || row.senderId === user?.id;
          const failed = row.kind === "pending" && row.status === "failed";
          const showStatus = rowKey(row) === statusRowKey;
          const shared = row.kind === "sent" ? (row.sharedStoryId ? "Shared a Story" : null) : row.storyId ? "Shared a Story" : null;
          // Bubbles show who sent what by their side of the screen; a screen reader says it.
          const spoken = [shared, row.body].filter(Boolean).join(". ");
          return (
            <View style={[styles.bubbleRow, mine ? styles.bubbleRowMine : styles.bubbleRowTheirs]}>
              <View style={[styles.bubbleColumn, mine ? styles.bubbleColumnMine : styles.bubbleColumnTheirs]}>
                <Pressable
                  // A button only where a tap does something (retry, open the shared Story).
                  accessibilityRole={row.kind === "pending" || (row.kind === "sent" && row.sharedStoryId) ? "button" : undefined}
                  style={[
                    styles.bubble,
                    mine ? styles.bubbleMine : styles.bubbleTheirs,
                    row.kind === "pending" && styles.bubblePending,
                    failed && styles.bubbleFailed,
                  ]}
                  disabled={row.kind === "sent" ? !row.sharedStoryId && mine : row.status === "sending"}
                  onPress={() => {
                    if (row.kind === "pending") onPendingPress(row);
                    else if (row.sharedStoryId) void onOpenSharedStory(row.sharedStoryId);
                  }}
                  onLongPress={() => onMessageLongPress(row)}
                  accessibilityLabel={`${mine ? "You" : otherUsername ? `@${otherUsername}` : "Them"}: ${spoken}`}
                  accessibilityHint={
                    row.kind === "pending" && row.status !== "sending" ? "Retry or delete this message"
                      : row.kind === "sent" && row.sharedStoryId ? "Opens the Story" : undefined
                  }
                  accessibilityActions={canReport(row) ? [{ name: "report", label: "Report message" }] : undefined}
                  onAccessibilityAction={(event) => {
                    if (event.nativeEvent.actionName === "report" && canReport(row)) setReportingMessageId(row.id);
                  }}
                >
                  {row.kind === "sent" && row.sharedStoryId ? (
                    <Text style={mine ? styles.bubbleTextMine : styles.bubbleTextTheirs}>Shared a Story — tap to view</Text>
                  ) : null}
                  {row.kind === "pending" && row.storyId ? (
                    <Text style={styles.bubbleTextMine}>Shared a Story</Text>
                  ) : null}
                  {row.body ? <Text style={mine ? styles.bubbleTextMine : styles.bubbleTextTheirs}>{row.body}</Text> : null}
                </Pressable>
                {showStatus ? <Text style={styles.statusCaption}>{statusLabel(row)}</Text> : null}
              </View>
            </View>
          );
        }}
        ListFooterComponent={loadingMore ? <ActivityIndicator color={colors.accent} style={styles.footerSpinner} /> : undefined}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={typography.body}>{otherUsername ? `Say hi to @${otherUsername} 👋` : "Say hi 👋"}</Text>
          </View>
        }
      />
      {emojiPickerOpen ? (
        <View style={styles.emojiPanel}>
          <FlatList
            data={EMOJIS}
            keyExtractor={(emoji) => emoji}
            numColumns={8}
            renderItem={({ item }) => (
              <Pressable style={styles.emojiKey} onPress={() => onInsertEmoji(item)} hitSlop={4} accessibilityRole="button">
                <Text style={styles.emojiKeyGlyph}>{item}</Text>
              </Pressable>
            )}
          />
        </View>
      ) : null}
      <ReportSheet
        visible={reportingMessageId !== null}
        targetType="message"
        targetId={reportingMessageId ?? ""}
        conversationId={conversationId}
        onClose={() => setReportingMessageId(null)}
      />
      {composerError ? <Text style={styles.composerError}>{composerError}</Text> : null}
      <View style={styles.composerRow}>
        <Pressable
          style={styles.emojiToggle}
          onPress={toggleEmojiPicker}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={emojiPickerOpen ? "Hide emoji picker" : "Show emoji picker"}
        >
          <Icon style={styles.emojiToggleGlyph} name={ICONS.emoji} />
        </Pressable>
        <TextInput
          style={styles.composerInput}
          accessibilityLabel="Message"
          placeholder="Message…"
          placeholderTextColor={colors.textDisabled}
          value={draft}
          onChangeText={setDraft}
          onFocus={() => setEmojiPickerOpen(false)}
          maxLength={MAX_MESSAGE_LENGTH}
          multiline
        />
        <Pressable
          style={[styles.sendButton, !draft.trim() && styles.sendButtonDisabled]}
          disabled={!draft.trim()}
          onPress={() => void onSend()}
          accessibilityRole="button"
          accessibilityLabel="Send"
        >
          <Icon style={styles.sendButtonText} name={ICONS.send} />
        </Pressable>
      </View>
    </KeyboardAvoider>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background, padding: spacing.lg },
  loadError: { textAlign: "center", marginBottom: spacing.md },
  retryButton: { backgroundColor: colors.accent, borderRadius: radii.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  retryButtonText: { color: colors.onAccent, fontWeight: "700" },
  composerError: { color: colors.danger, fontSize: 12, paddingHorizontal: spacing.md, paddingTop: spacing.xs },
  list: { flex: 1 },
  listContent: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, flexGrow: 1 },
  bubbleRow: { flexDirection: "row", marginVertical: spacing.xs / 2 },
  bubbleRowMine: { justifyContent: "flex-end" },
  bubbleRowTheirs: { justifyContent: "flex-start" },
  bubbleColumn: { maxWidth: "78%" },
  bubbleColumnMine: { alignItems: "flex-end" },
  bubbleColumnTheirs: { alignItems: "flex-start" },
  bubble: { borderRadius: radii.md, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, gap: 2 },
  bubbleMine: { backgroundColor: colors.accent },
  bubbleTheirs: { backgroundColor: colors.surfaceElevated },
  bubblePending: { opacity: 0.75 },
  bubbleFailed: { backgroundColor: colors.danger, opacity: 1 },
  bubbleTextMine: { color: colors.onAccent, fontSize: 15 },
  bubbleTextTheirs: { color: colors.textPrimary, fontSize: 15 },
  statusCaption: { color: colors.textDisabled, fontSize: 11, marginTop: 2 },
  footerSpinner: { marginVertical: spacing.md },
  emptyState: { flex: 1, alignItems: "center", justifyContent: "center", paddingTop: spacing.xxl, transform: [{ scaleY: -1 }] },
  composerRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
  composerInput: {
    flex: 1,
    maxHeight: 100,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    color: colors.textPrimary,
    fontSize: 15,
  },
  sendButton: {
    backgroundColor: colors.accent,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  sendButtonDisabled: { opacity: 0.5 },
  sendButtonText: { color: colors.onAccent, fontWeight: "700" },
  emojiToggle: { paddingBottom: spacing.sm },
  emojiToggleGlyph: { fontSize: 22 },
  emojiPanel: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.xs,
    maxHeight: 180,
  },
  emojiKey: { flex: 1 / 8, alignItems: "center", paddingVertical: spacing.xs },
  emojiKeyGlyph: { fontSize: 24 },
});
