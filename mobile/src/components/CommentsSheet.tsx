import { useSafeAreaInsets } from "react-native-safe-area-context";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
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

/**
 * A Story's comments, like Instagram: the newest at the bottom beside the box you type in; a
 * comment appears the moment you send it; tap a name or photo for that profile; long-press (or
 * the ⋯ button) to delete your own, any on your own Story, or report someone else's. Older
 * comments load as you scroll. Comments from people you've blocked never show.
 */
export function CommentsSheet({ visible, storyId, storyOwnerId, commentsDisabled, followersOnly = false, onClose, onCommentCountChange, autoFocus = false, onOpenProfile }: Props): React.JSX.Element {
  // Clears Android's navigation bar and the iPhone home indicator.
  const bottomInset = useSafeAreaInsets().bottom;
  const { user, accessToken } = useAuth();
  const [comments, setComments] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [reportingCommentId, setReportingCommentId] = useState<string | null>(null);
  const listRef = useRef<FlatList<Row>>(null);
  const stored = comments.filter((c) => !c.pending).length;

  const load = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    setError(null);
    try {
      const { comments: fetched } = await listComments(storyId, accessToken, { limit: PAGE });
      setComments(fetched);
      setHasMore(fetched.length === PAGE);
    } catch {
      setError("Couldn't load comments.");
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

  const onSend = async () => {
    const body = draft.trim();
    if (!accessToken || !user || !body) return;
    const tempId = `pending-${Date.now()}`;
    const temp: Row = {
      id: tempId, storyId, userId: user.id, username: user.username, displayName: user.displayName ?? user.username,
      avatarMediaId: user.avatarMediaId ?? null, body, createdAt: new Date().toISOString(), pending: true,
    };
    setComments((prev) => [...prev, temp]);
    setDraft("");
    setError(null);
    tapFeedback("select");
    requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
    try {
      const { comment } = await postComment(storyId, body, accessToken);
      setComments((prev) => prev.map((c) => (c.id === tempId ? comment : c)));
      onCommentCountChange(1);
    } catch (err) {
      setComments((prev) => prev.filter((c) => c.id !== tempId));
      setDraft((current) => current || body);
      setError(err instanceof ApiError ? err.message : "Couldn't post that comment.");
    }
  };

  const onDelete = (commentId: string) => {
    if (!accessToken) return;
    Alert.alert("Delete comment?", undefined, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          const before = comments;
          setComments((prev) => prev.filter((c) => c.id !== commentId));
          try {
            await deleteComment(commentId, accessToken);
            onCommentCountChange(-1);
          } catch {
            setComments(before);
            setError("Couldn't delete that comment.");
          }
        },
      },
    ]);
  };

  const onOptions = (item: Row) => {
    if (item.pending) return;
    const mine = item.userId === user?.id;
    const canDelete = mine || storyOwnerId === user?.id;
    const buttons: Array<{ text: string; style?: "destructive" | "cancel"; onPress?: () => void }> = [];
    if (canDelete) buttons.push({ text: "Delete", style: "destructive", onPress: () => onDelete(item.id) });
    if (!mine) buttons.push({ text: "Report", style: "destructive", onPress: () => setReportingCommentId(item.id) });
    buttons.push({ text: "Cancel", style: "cancel" });
    Alert.alert("Comment", undefined, buttons);
  };

  const openProfile = (username: string) => {
    if (!onOpenProfile) return;
    onClose();
    onOpenProfile(username);
  };

  const closedNote = commentsDisabled ? "Comments are turned off for this Story." : followersOnly ? "Only followers can comment on this Story." : null;

  return (
    <>
      <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" />
        <KeyboardAvoider style={[styles.sheet, { paddingBottom: spacing.md + bottomInset }]}>
          <View style={styles.handle} />
          <Text style={[typography.bodyStrong, styles.title]} accessibilityRole="header">
            {stored > 0 ? `${stored}${hasMore ? "+" : ""} comment${stored === 1 ? "" : "s"}` : "Comments"}
          </Text>

          {loading ? (
            <ActivityIndicator color={colors.accent} style={styles.spinner} />
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
              renderItem={({ item }) => (
                <Pressable
                  style={[styles.row, item.pending && styles.rowPending]}
                  onLongPress={() => onOptions(item)}
                  delayLongPress={350}
                  accessibilityRole="text"
                  accessibilityLabel={`@${item.username}: ${item.body}. ${timeAgo(item.createdAt)}`}
                  accessibilityActions={item.pending ? undefined : [{ name: "options", label: "Comment options" }]}
                  onAccessibilityAction={() => onOptions(item)}
                >
                  <Pressable onPress={() => openProfile(item.username)} hitSlop={6} accessibilityRole="button" accessibilityLabel={`@${item.username}'s profile`}>
                    <Avatar username={item.username} displayName={item.displayName} avatarMediaId={item.avatarMediaId ?? null} size={34} />
                  </Pressable>
                  <View style={styles.rowBody}>
                    <Text style={styles.meta}>
                      <Text style={styles.username} onPress={() => openProfile(item.username)}>{item.username}</Text>
                      {"  "}
                      <Text style={styles.time}>{item.pending ? "Posting…" : timeAgo(item.createdAt)}</Text>
                    </Text>
                    <Text style={styles.body}>{item.body}</Text>
                  </View>
                  {!item.pending ? (
                    <Pressable onPress={() => onOptions(item)} hitSlop={10} style={styles.more} accessibilityRole="button" accessibilityLabel="Comment options">
                      <Icon name={ICONS.more} size={16} color={colors.textDisabled} />
                    </Pressable>
                  ) : null}
                </Pressable>
              )}
            />
          )}

          {error ? <Text style={styles.error}>{error}</Text> : null}

          {closedNote ? (
            <Text style={[typography.caption, styles.disabled]}>{closedNote}</Text>
          ) : (
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
              <Pressable accessibilityRole="button" accessibilityLabel="Post comment" onPress={() => void onSend()} disabled={!draft.trim()} hitSlop={8}>
                <Text style={[styles.sendLabel, !draft.trim() && styles.sendDisabled]}>Post</Text>
              </Pressable>
            </View>
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
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: "center", marginVertical: spacing.sm },
  title: { textAlign: "center", marginBottom: spacing.sm },
  spinner: { marginVertical: spacing.lg },
  emptyBox: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.xs },
  emptyHint: { color: colors.textSecondary },
  list: { flex: 1 },
  row: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm, paddingVertical: spacing.sm },
  rowPending: { opacity: 0.55 },
  rowBody: { flex: 1 },
  meta: { marginBottom: 2 },
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
