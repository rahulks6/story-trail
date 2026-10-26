import { useSafeAreaInsets } from "react-native-safe-area-context";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Keyboard,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { colors, radii, spacing, typography, ICONS } from "../theme";
import { useAuth } from "../state/AuthContext";
import { deleteComment, listComments, postComment, type Comment } from "../api/engagement";
import { ApiError } from "../api/client";
import { ReportSheet } from "./ReportSheet";
import { KeyboardAvoider } from "./KeyboardAvoider";
import { Avatar } from "./Avatar";
import { VerifiedName } from "./VerifiedBadge";
import { Icon } from "./Icon";
import { timeAgo } from "../utils/serverTime";
import { tapFeedback } from "../utils/haptics";

interface Props {
  visible: boolean;
  storyId: string;
  storyOwnerId: string;
  commentsDisabled: boolean;
  /** Comments are for followers only and the viewer doesn't follow the owner. */
  followersOnly?: boolean;
  onClose: () => void;
  onCommentCountChange: (delta: number) => void;
  /** Opened from the comment bar under a Story: the keyboard comes up straight away. */
  autoFocus?: boolean;
  /** A name or photo was tapped: open that profile (the sheet closes). */
  onOpenProfile?: (username: string) => void;
}

const PAGE = 50;
const MAX_LENGTH = 500;

/** A comment still on its way to the server: shown at once, greyed until it's stored. */
type Row = Comment & { pending?: boolean };

/** A dropped connection or a timeout: the server may have stored the comment anyway. */
function outcomeUnknown(err: unknown): boolean {
  return !(err instanceof ApiError) || err.status === 408 || err.status >= 500;
}

/** Whether the keyboard is up: the sheet grows with it so the list keeps room. */
function useKeyboardShown(): boolean {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const show = Keyboard.addListener(Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow", () => setShown(true));
    const hide = Keyboard.addListener(Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide", () => setShown(false));
    return () => { show.remove(); hide.remove(); };
  }, []);
  return shown;
}

/** One comment. Memoised: typing in the box, or a new comment, doesn't redraw the others. */
const CommentRow = React.memo(function CommentRow({ item, onOptions, onOpenProfile }: { item: Row; onOptions: (item: Row) => void; onOpenProfile: (username: string) => void }): React.JSX.Element {
  const ago = item.pending ? "Posting…" : timeAgo(item.createdAt);
  return (
    <Pressable
      style={[styles.row, item.pending && styles.rowPending]}
      onLongPress={() => onOptions(item)}
      delayLongPress={350}
      accessibilityRole="text"
      accessibilityLabel={`@${item.username}${item.verified ? ", verified" : ""}: ${item.body}. ${timeAgo(item.createdAt)}`}
      accessibilityActions={item.pending ? undefined : [{ name: "options", label: "Comment options" }]}
      onAccessibilityAction={() => onOptions(item)}
    >
      <Pressable onPress={() => onOpenProfile(item.username)} hitSlop={6} accessibilityRole="button" accessibilityLabel={`@${item.username}'s profile`}>
        <Avatar username={item.username} displayName={item.displayName} avatarMediaId={item.avatarMediaId ?? null} size={34} />
      </Pressable>
      <View style={styles.rowBody}>
        <View style={styles.meta}>
          <VerifiedName name={item.username} verified={item.verified} style={styles.username} containerStyle={styles.metaName} onPress={() => onOpenProfile(item.username)} />
          <Text style={styles.time}>{ago}</Text>
        </View>
        <Text style={styles.body}>{item.body}</Text>
      </View>
      {!item.pending ? (
        <Pressable onPress={() => onOptions(item)} hitSlop={10} style={styles.more} accessibilityRole="button" accessibilityLabel="Comment options">
          <Icon name={ICONS.more} size={16} color={colors.textDisabled} />
        </Pressable>
      ) : null}
    </Pressable>
  );
});

/**
 * The comment box, with its own draft: typing redraws only this. `onSend` resolves to the text
 * to put back in the box (a failed comment), or null. One comment at a time.
 */
function Composer({ user, autoFocus, onSend }: { user: { username: string; displayName?: string | null; avatarMediaId?: string | null } | null; autoFocus: boolean; onSend: (body: string) => Promise<string | null> }): React.JSX.Element {
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const inFlight = useRef(false);
  const send = async () => {
    const body = draft.trim();
    if (!body || inFlight.current) return;
    inFlight.current = true;
    setSending(true);
    setDraft("");
    try {
      const restore = await onSend(body);
      if (restore) setDraft((current) => current || restore);
    } finally {
      inFlight.current = false;
      setSending(false);
    }
  };
  const canSend = !!draft.trim() && !sending;
  return (
    <View style={styles.composer}>
      {user ? <Avatar username={user.username} displayName={user.displayName ?? user.username} avatarMediaId={user.avatarMediaId ?? null} size={32} /> : null}
      <TextInput
        style={styles.input}
        placeholder="Add a comment…"
        placeholderTextColor={colors.textDisabled}
        autoFocus={autoFocus}
        value={draft}
        onChangeText={setDraft}
        maxLength={MAX_LENGTH}
        multiline
        accessibilityLabel="Comment"
      />
      <Pressable accessibilityRole="button" accessibilityLabel="Post comment" accessibilityState={{ disabled: !canSend, busy: sending }} onPress={() => void send()} disabled={!canSend} hitSlop={8}>
        <Text style={[styles.sendLabel, !canSend && styles.sendDisabled]}>Post</Text>
      </Pressable>
    </View>
  );
}

/**
 * A Story's comments, like Instagram: the newest at the bottom beside the box you type in; a
 * comment appears the moment you send it; tap a name or photo for that profile; long-press (or
 * the ⋯ button) to delete your own, any on your own Story, or report someone else's. Older
 * comments load as you scroll. Comments from people you've blocked never show.
 */
export function CommentsSheet({ visible, storyId, storyOwnerId, commentsDisabled, followersOnly = false, onClose, onCommentCountChange, autoFocus = false, onOpenProfile }: Props): React.JSX.Element {
  // Clears Android's navigation bar and the iPhone home indicator.
  const bottomInset = useSafeAreaInsets().bottom;
  const keyboardShown = useKeyboardShown();
  const { user, accessToken } = useAuth();
  const [comments, setComments] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reportingCommentId, setReportingCommentId] = useState<string | null>(null);
  const listRef = useRef<FlatList<Row>>(null);
  const stored = comments.filter((c) => !c.pending).length;
  // The row callbacks read the latest values through this, so they (and the rows) stay the same.
  const latest = useRef({ comments, stored, user, accessToken, storyOwnerId, onClose, onOpenProfile, onCommentCountChange });
  latest.current = { comments, stored, user, accessToken, storyOwnerId, onClose, onOpenProfile, onCommentCountChange };

  const [loadFailed, setLoadFailed] = useState(false);
  const load = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    setError(null);
    setLoadFailed(false);
    try {
      const { comments: fetched } = await listComments(storyId, accessToken, { limit: PAGE });
      setComments(fetched);
      setHasMore(fetched.length === PAGE);
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, [storyId, accessToken]);

  useEffect(() => {
    if (visible) void load();
    else setComments([]);
  }, [visible, load]);

  const loadMore = async () => {
    if (!accessToken || !hasMore || loadingMore || loading) return;
    setLoadingMore(true);
    try {
      const { comments: fetched } = await listComments(storyId, accessToken, { limit: PAGE, offset: stored });
      setComments((prev) => {
        const known = new Set(prev.map((c) => c.id));
        return [...prev, ...fetched.filter((c) => !known.has(c.id))];
      });
      setHasMore(fetched.length === PAGE);
    } catch {
      // Scrolling again retries.
    } finally {
      setLoadingMore(false);
    }
  };

  /**
   * After a timeout the comment may be stored even though no answer came back. The comments
   * API has no client id, so look at the newest comments for it rather than invite a duplicate.
   */
  const findStored = useCallback(async (body: string, knownIds: Set<string>, from: number): Promise<Comment | null> => {
    const token = latest.current.accessToken;
    const me = latest.current.user?.id;
    if (!token || !me) return null;
    // Oldest first: the new one is at the end. Start a little early in case some were deleted.
    for (let offset = Math.max(0, from - 5), page = 0; page < 4; page++, offset += PAGE) {
      const { comments: fetched } = await listComments(storyId, token, { limit: PAGE, offset });
      const found = fetched.find((c) => c.userId === me && c.body.trim() === body && !knownIds.has(c.id));
      if (found) return found;
      if (fetched.length < PAGE) return null;
    }
    return null;
  }, [storyId]);

  const onSend = useCallback(async (body: string): Promise<string | null> => {
    const { accessToken: token, user: me, comments: before, stored: storedBefore } = latest.current;
    if (!token || !me) return body;
    const knownIds = new Set(before.map((c) => c.id));
    const tempId = `pending-${Date.now()}`;
    const temp: Row = {
      id: tempId, storyId, userId: me.id, username: me.username, displayName: me.displayName ?? me.username,
      avatarMediaId: me.avatarMediaId ?? null, verified: me.verified, body, createdAt: new Date().toISOString(), pending: true,
    };
    setComments((prev) => [...prev, temp]);
    setError(null);
    tapFeedback("select");
    requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
    const settle = (comment: Comment) => {
      setComments((prev) => (prev.some((c) => c.id === comment.id) ? prev.filter((c) => c.id !== tempId) : prev.map((c) => (c.id === tempId ? comment : c))));
      latest.current.onCommentCountChange(1);
    };
    try {
      const { comment } = await postComment(storyId, body, token);
      settle(comment);
      return null;
    } catch (err) {
      if (outcomeUnknown(err)) {
        const found = await findStored(body, knownIds, storedBefore).catch(() => null);
        if (found) {
          settle(found);
          return null;
        }
      }
      setComments((prev) => prev.filter((c) => c.id !== tempId));
      setError(err instanceof ApiError ? err.message : "Couldn't post that comment.");
      return body;
    }
  }, [storyId, findStored]);

  const onDelete = useCallback((commentId: string) => {
    const token = latest.current.accessToken;
    if (!token) return;
    Alert.alert("Delete comment?", undefined, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          const before = latest.current.comments;
          setComments((prev) => prev.filter((c) => c.id !== commentId));
          try {
            await deleteComment(commentId, token);
            latest.current.onCommentCountChange(-1);
          } catch {
            setComments(before);
            setError("Couldn't delete that comment.");
          }
        },
      },
    ]);
  }, []);

  const onOptions = useCallback((item: Row) => {
    if (item.pending) return;
    const { user: me, storyOwnerId: owner } = latest.current;
    const mine = item.userId === me?.id;
    const canDelete = mine || owner === me?.id;
    const buttons: Array<{ text: string; style?: "destructive" | "cancel"; onPress?: () => void }> = [];
    if (canDelete) buttons.push({ text: "Delete", style: "destructive", onPress: () => onDelete(item.id) });
    if (!mine) buttons.push({ text: "Report", style: "destructive", onPress: () => setReportingCommentId(item.id) });
    buttons.push({ text: "Cancel", style: "cancel" });
    Alert.alert("Comment", undefined, buttons);
  }, [onDelete]);

  const openProfile = useCallback((username: string) => {
    const { onOpenProfile: open, onClose: close } = latest.current;
    if (!open) return;
    close();
    open(username);
  }, []);

  const renderItem = useCallback(({ item }: { item: Row }) => <CommentRow item={item} onOptions={onOptions} onOpenProfile={openProfile} />, [onOptions, openProfile]);

  const closedNote = commentsDisabled ? "Comments are turned off for this Story." : followersOnly ? "Only followers can comment on this Story." : null;

  return (
    <>
      <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" />
        {/* The keyboard's room comes out of the sheet: it grows while the keyboard is up, so the list keeps space. */}
        <KeyboardAvoider style={[styles.sheet, keyboardShown && styles.sheetKeyboard, { paddingBottom: spacing.md + bottomInset }]}>
          <View style={styles.handle} />
          <Text style={[typography.bodyStrong, styles.title]} accessibilityRole="header">
            {stored > 0 ? `${stored}${hasMore ? "+" : ""} comment${stored === 1 ? "" : "s"}` : "Comments"}
          </Text>

          {loading ? (
            <ActivityIndicator color={colors.accent} style={styles.spinner} />
          ) : loadFailed ? (
            // Not "no comments": they couldn't be loaded.
            <View style={styles.emptyBox}>
              <Text style={typography.bodyStrong}>Couldn't load comments</Text>
              <Text style={[typography.caption, styles.emptyHint]}>Check your connection and try again.</Text>
              <Pressable onPress={() => void load()} style={styles.retry} accessibilityRole="button" hitSlop={8}>
                <Text style={styles.retryText}>Try again</Text>
              </Pressable>
            </View>
          ) : comments.length === 0 ? (
            <View style={styles.emptyBox}>
              <Text style={typography.bodyStrong}>No comments yet</Text>
              {!closedNote ? <Text style={[typography.caption, styles.emptyHint]}>Start the conversation.</Text> : null}
            </View>
          ) : (
            <FlatList
              ref={listRef}
              data={comments}
              keyExtractor={(c) => c.id}
              style={styles.list}
              keyboardShouldPersistTaps="handled"
              onEndReachedThreshold={0.3}
              onEndReached={() => void loadMore()}
              ListFooterComponent={loadingMore ? <ActivityIndicator color={colors.accent} style={styles.spinner} /> : undefined}
              renderItem={renderItem}
            />
          )}

          {error ? <Text style={styles.error}>{error}</Text> : null}

          {closedNote ? (
            <Text style={[typography.caption, styles.disabled]}>{closedNote}</Text>
          ) : (
            <Composer user={user} autoFocus={autoFocus} onSend={onSend} />
          )}
        </KeyboardAvoider>
      </Modal>
      <ReportSheet
        visible={reportingCommentId !== null}
        targetType="comment"
        targetId={reportingCommentId ?? ""}
        onClose={() => setReportingCommentId(null)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)" },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    height: "72%",
    paddingHorizontal: spacing.md,
  },
  sheetKeyboard: { height: "92%" },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: "center", marginVertical: spacing.sm },
  title: { textAlign: "center", marginBottom: spacing.sm },
  spinner: { marginVertical: spacing.lg },
  retry: { marginTop: spacing.sm, minHeight: 44, paddingHorizontal: spacing.lg, justifyContent: "center", borderRadius: radii.pill, backgroundColor: colors.surfaceElevated },
  retryText: { color: colors.textPrimary, fontWeight: "700" },
  emptyBox: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.xs },
  emptyHint: { color: colors.textSecondary },
  list: { flex: 1 },
  row: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm, paddingVertical: spacing.sm },
  rowPending: { opacity: 0.55 },
  rowBody: { flex: 1 },
  meta: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: 2 },
  metaName: { flexShrink: 1 },
  username: { color: colors.textPrimary, fontWeight: "700", fontSize: 13 },
  time: { color: colors.textDisabled, fontSize: 12 },
  body: { color: colors.textPrimary, fontSize: 15, lineHeight: 20 },
  more: { paddingTop: 2, paddingHorizontal: 2 },
  error: { color: colors.danger, textAlign: "center", marginTop: spacing.xs },
  disabled: { textAlign: "center", marginVertical: spacing.md },
  composer: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginTop: spacing.xs,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
  },
  input: {
    flex: 1,
    maxHeight: 96,
    backgroundColor: colors.surfaceElevated,
    borderRadius: radii.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    color: colors.textPrimary,
    fontSize: 15,
  },
  sendLabel: { color: colors.accent, fontWeight: "700", fontSize: 15 },
  sendDisabled: { opacity: 0.4 },
});
