import { useSafeAreaInsets } from "react-native-safe-area-context";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, FlatList, Keyboard, Modal, Platform, StyleSheet, Text, TextInput, View } from "react-native";
import { Pressable } from "./Pressable";
import { colors, radii, spacing, typography, ICONS } from "../theme";
import { useAuth } from "../state/AuthContext";
import { deleteComment, likeComment, listComments, postComment, unlikeComment, type Comment } from "../api/engagement";
import { searchUsers, type SearchResult } from "../api/users";
import { ApiError } from "../api/client";
import { ReportSheet } from "./ReportSheet";
import { KeyboardAvoider } from "./KeyboardAvoider";
import { Avatar } from "./Avatar";
import { VerifiedName } from "./VerifiedBadge";
import { Icon } from "./Icon";
import { timeAgo } from "../utils/serverTime";
import { tapFeedback } from "../utils/haptics";
import { t } from "../i18n";

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

/** @names in a comment are tappable and open that profile; the rest is plain text. */
const MENTION = /@([a-z0-9_.]{3,30})/gi;
function MentionText({ body, onOpenProfile }: { body: string; onOpenProfile: (username: string) => void }): React.JSX.Element {
  const parts: React.ReactNode[] = [];
  let last = 0;
  for (const match of body.matchAll(MENTION)) {
    const at = match.index ?? 0;
    if (at > last) parts.push(body.slice(last, at));
    const username = match[1]!.toLowerCase().replace(/\.+$/, "");
    const shown = `@${username}`;
    parts.push(<Text key={`${at}`} style={styles.mention} onPress={() => onOpenProfile(username)} accessibilityRole="link">{shown}</Text>);
    last = at + shown.length;
  }
  if (last < body.length) parts.push(body.slice(last));
  return <Text style={styles.body}>{parts}</Text>;
}

interface RowActions {
  onOptions: (item: Row) => void;
  onOpenProfile: (username: string) => void;
  onReply: (item: Row) => void;
  onToggleLike: (item: Row) => void;
}

/** One comment. Memoised: typing in the box, or a new comment, doesn't redraw the others. */
const CommentRow = React.memo(function CommentRow({ item, actions }: { item: Row; actions: RowActions }): React.JSX.Element {
  const { onOptions, onOpenProfile, onReply, onToggleLike } = actions;
  const ago = item.pending ? t("commentsSheet.posting") : timeAgo(item.createdAt);
  const likes = item.likeCount ?? 0;
  const reply = !!item.parentId;
  return (
    <Pressable
      style={[styles.row, reply && styles.replyRow, item.pending && styles.rowPending]}
      onLongPress={() => onOptions(item)}
      delayLongPress={350}
      accessibilityRole="text"
      accessibilityLabel={(item.verified ? t("commentsSheet.usernameVerifiedBodyCreatedat", { username: item.username, body: item.body, createdAt: timeAgo(item.createdAt) }) : `@${item.username}: ${item.body}. ${timeAgo(item.createdAt)}`)}
      accessibilityActions={item.pending ? undefined : [{ name: "options", label: t("commentsSheet.commentOptions") }, { name: "reply", label: t("commentsSheet.reply") }, { name: "like", label: item.likedByMe ? t("commentsSheet.unlikeComment") : t("commentsSheet.likeComment") }]}
      onAccessibilityAction={(e) => (e.nativeEvent.actionName === "reply" ? onReply(item) : e.nativeEvent.actionName === "like" ? onToggleLike(item) : onOptions(item))}
      testID={`comment-${item.id}`}
    >
      <Pressable onPress={() => onOpenProfile(item.username)} hitSlop={6} accessibilityRole="button" accessibilityLabel={t("commentsSheet.usernameSProfile", { username: item.username })}>
        <Avatar username={item.username} displayName={item.displayName} avatarMediaId={item.avatarMediaId ?? null} size={reply ? 26 : 34} />
      </Pressable>
      <View style={styles.rowBody}>
        <View style={styles.meta}>
          <VerifiedName name={item.username} verified={item.verified} style={styles.username} containerStyle={styles.metaName} onPress={() => onOpenProfile(item.username)} />
          <Text style={styles.time}>{ago}</Text>
        </View>
        <MentionText body={item.body} onOpenProfile={onOpenProfile} />
        {!item.pending ? (
          <View style={styles.rowActions}>
            {likes > 0 ? <Text style={styles.rowAction}>{t("commentsSheet.likes", { count: likes })}</Text> : null}
            <Pressable onPress={() => onReply(item)} hitSlop={8} accessibilityRole="button" testID={`comment-reply-${item.id}`}>
              <Text style={styles.rowAction}>{t("commentsSheet.reply")}</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
      {!item.pending ? (
        <View style={styles.side}>
          <Pressable onPress={() => onToggleLike(item)} hitSlop={10} accessibilityRole="button" accessibilityState={{ selected: !!item.likedByMe }} accessibilityLabel={item.likedByMe ? t("commentsSheet.unlikeComment") : t("commentsSheet.likeComment")} testID={`comment-like-${item.id}`}>
            <Icon name={item.likedByMe ? ICONS.liked : ICONS.like} size={16} color={item.likedByMe ? colors.danger : colors.textDisabled} />
          </Pressable>
          <Pressable onPress={() => onOptions(item)} hitSlop={10} style={styles.more} accessibilityRole="button" accessibilityLabel={t("commentsSheet.commentOptions")}>
            <Icon name={ICONS.more} size={16} color={colors.textDisabled} />
          </Pressable>
        </View>
      ) : null}
    </Pressable>
  );
});

/** "View 3 replies" under a comment, or "Hide replies". */
function RepliesToggle({ count, open, onPress, testID }: { count: number; open: boolean; onPress: () => void; testID: string }): React.JSX.Element {
  return (
    <Pressable onPress={onPress} style={styles.toggle} hitSlop={6} accessibilityRole="button" accessibilityState={{ expanded: open }} testID={testID}>
      <View style={styles.toggleLine} />
      <Text style={styles.rowAction}>{open ? t("commentsSheet.hideReplies") : t("commentsSheet.viewReplies", { count })}</Text>
    </Pressable>
  );
}

/** The @word being typed at the end of the box, if any: what to suggest people for. */
export function mentionQuery(draft: string): string | null {
  const match = /(?:^|\s)@([a-z0-9_.]{1,30})$/i.exec(draft);
  return match ? match[1]!.toLowerCase() : null;
}

/**
 * The comment box, with its own draft: typing redraws only this. `onSend` resolves to the text
 * to put back in the box (a failed comment), or null. One comment at a time. Replying starts the
 * box with "@name ", and typing @ suggests people to tag.
 */
function Composer({ user, autoFocus, replyTo, onCancelReply, accessToken, onSend }: {
  user: { username: string; displayName?: string | null; avatarMediaId?: string | null } | null;
  autoFocus: boolean;
  replyTo: { id: string; username: string } | null;
  onCancelReply: () => void;
  accessToken: string | null;
  onSend: (body: string) => Promise<string | null>;
}): React.JSX.Element {
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [suggestions, setSuggestions] = useState<SearchResult[]>([]);
  const inFlight = useRef(false);
  const input = useRef<React.ComponentRef<typeof TextInput>>(null);
  // A reply starts with the name of the person answered (kept if they already typed it).
  useEffect(() => {
    if (!replyTo) return;
    const name = `@${replyTo.username} `;
    setDraft((current) => (current.startsWith(name) ? current : name + current.replace(/^@[a-z0-9_.]+\s*/i, "")));
    requestAnimationFrame(() => input.current?.focus());
  }, [replyTo]);
  const query = mentionQuery(draft);
  useEffect(() => {
    if (!query || !accessToken) { setSuggestions([]); return; }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      searchUsers(query, accessToken, { limit: 5, signal: controller.signal })
        .then(({ results }) => setSuggestions(results.slice(0, 5)))
        .catch(() => undefined);
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, accessToken]);
  const pick = (person: SearchResult) => {
    setDraft((current) => current.replace(/@[a-z0-9_.]{1,30}$/i, `@${person.username} `));
    setSuggestions([]);
  };
  const send = async () => {
    const body = draft.trim();
    if (!body || inFlight.current) return;
    inFlight.current = true;
    setSending(true);
    setDraft("");
    setSuggestions([]);
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
    <View>
      {query && suggestions.length ? (
        <View style={styles.suggestions} testID="mention-suggestions">
          {suggestions.map((person) => (
            <Pressable key={person.id} style={styles.suggestion} onPress={() => pick(person)} accessibilityRole="button" accessibilityLabel={t("commentsSheet.tagUsername", { username: person.username })} testID={`mention-${person.username}`}>
              <Avatar username={person.username} displayName={person.displayName} avatarMediaId={person.avatarMediaId ?? null} size={28} />
              <View style={styles.suggestionText}>
                <Text style={styles.username} numberOfLines={1}>{person.username}</Text>
                <Text style={styles.time} numberOfLines={1}>{person.displayName}</Text>
              </View>
            </Pressable>
          ))}
        </View>
      ) : null}
      {replyTo ? (
        <View style={styles.replyBar}>
          <Text style={styles.replyBarText} numberOfLines={1}>{t("commentsSheet.replyingTo", { username: replyTo.username })}</Text>
          <Pressable onPress={onCancelReply} hitSlop={10} accessibilityRole="button" accessibilityLabel={t("commentsSheet.cancelReply")} testID="cancel-reply">
            <Icon name={ICONS.close} size={14} color={colors.textSecondary} />
          </Pressable>
        </View>
      ) : null}
      <View style={styles.composer}>
        {user ? <Avatar username={user.username} displayName={user.displayName ?? user.username} avatarMediaId={user.avatarMediaId ?? null} size={32} /> : null}
        <TextInput
          ref={input}
          style={styles.input}
          placeholder={replyTo ? t("commentsSheet.replyToUsername", { username: replyTo.username }) : t("common.addAComment")}
          placeholderTextColor={colors.textDisabled}
          autoFocus={autoFocus}
          value={draft}
          onChangeText={setDraft}
          maxLength={MAX_LENGTH}
          multiline
          accessibilityLabel={t("commentsSheet.comment")}
        />
        <Pressable accessibilityRole="button" accessibilityLabel={t("commentsSheet.postComment")} accessibilityState={{ disabled: !canSend, busy: sending }} onPress={() => void send()} disabled={!canSend} hitSlop={8}>
          <Text style={[styles.sendLabel, !canSend && styles.sendDisabled]}>{t("commentsSheet.post")}</Text>
        </Pressable>
      </View>
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
  const [replyTo, setReplyTo] = useState<{ id: string; username: string } | null>(null);
  // Comments whose replies are showing.
  const [open, setOpen] = useState<Set<string>>(new Set());
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const listRef = useRef<FlatList<any>>(null);
  const stored = comments.filter((c) => !c.pending).length;
  // The row callbacks read the latest values through this, so they (and the rows) stay the same.
  const latest = useRef({ comments, stored, user, accessToken, storyOwnerId, onClose, onOpenProfile, onCommentCountChange, replyTo });
  latest.current = { comments, stored, user, accessToken, storyOwnerId, onClose, onOpenProfile, onCommentCountChange, replyTo };

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
    else { setComments([]); setReplyTo(null); setOpen(new Set()); }
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
    const { accessToken: token, user: me, comments: before, stored: storedBefore, replyTo: target } = latest.current;
    if (!token || !me) return body;
    setReplyTo(null);
    const knownIds = new Set(before.map((c) => c.id));
    const tempId = `pending-${Date.now()}`;
    const temp: Row = {
      id: tempId, storyId, userId: me.id, username: me.username, displayName: me.displayName ?? me.username,
      avatarMediaId: me.avatarMediaId ?? null, verified: me.verified, body, createdAt: new Date().toISOString(), pending: true,
      parentId: target ? (before.find((c) => c.id === target.id)?.parentId ?? target.id) : null, likeCount: 0, likedByMe: false,
    };
    // A new reply shows under its comment straight away.
    if (temp.parentId) setOpen((prev) => new Set(prev).add(temp.parentId!));
    setComments((prev) => [...prev, temp]);
    setError(null);
    tapFeedback("select");
    requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
    const settle = (comment: Comment) => {
      setComments((prev) => (prev.some((c) => c.id === comment.id) ? prev.filter((c) => c.id !== tempId) : prev.map((c) => (c.id === tempId ? comment : c))));
      latest.current.onCommentCountChange(1);
    };
    try {
      const { comment } = await postComment(storyId, body, token, target?.id);
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
      setError(err instanceof ApiError ? err.message : t("commentsSheet.couldntPostThatComment"));
      if (target) setReplyTo(target);
      return body;
    }
  }, [storyId, findStored]);

  const onDelete = useCallback((commentId: string) => {
    const token = latest.current.accessToken;
    if (!token) return;
    Alert.alert(t("commentsSheet.deleteComment"), undefined, [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("common.delete"),
        style: "destructive",
        onPress: async () => {
          const before = latest.current.comments;
          const gone = before.filter((c) => c.id === commentId || c.parentId === commentId).length;
          setComments((prev) => prev.filter((c) => c.id !== commentId && c.parentId !== commentId));
          try {
            await deleteComment(commentId, token);
            latest.current.onCommentCountChange(-gone);
          } catch {
            setComments(before);
            setError(t("commentsSheet.couldntDeleteThatComment"));
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
    if (canDelete) buttons.push({ text: t("common.delete"), style: "destructive", onPress: () => onDelete(item.id) });
    if (!mine) buttons.push({ text: t("common.report"), style: "destructive", onPress: () => setReportingCommentId(item.id) });
    buttons.push({ text: t("common.cancel"), style: "cancel" });
    Alert.alert(t("commentsSheet.comment"), undefined, buttons);
  }, [onDelete]);

  const openProfile = useCallback((username: string) => {
    const { onOpenProfile: open, onClose: close } = latest.current;
    if (!open) return;
    close();
    open(username);
  }, []);

  const onReply = useCallback((item: Row) => {
    if (item.pending) return;
    setReplyTo({ id: item.id, username: item.username });
  }, []);

  const onToggleLike = useCallback((item: Row) => {
    const token = latest.current.accessToken;
    if (!token || item.pending) return;
    const liked = !item.likedByMe;
    const flip = (c: Row, on: boolean) => ({ ...c, likedByMe: on, likeCount: Math.max(0, (c.likeCount ?? 0) + (on ? 1 : -1)) });
    setComments((prev) => prev.map((c) => (c.id === item.id ? flip(c, liked) : c)));
    if (liked) tapFeedback("select");
    (liked ? likeComment(item.id, token) : unlikeComment(item.id, token)).catch(() => {
      setComments((prev) => prev.map((c) => (c.id === item.id ? flip(c, !liked) : c)));
      setError(t("commentsSheet.couldntLike"));
    });
  }, []);

  const actions = useMemo<RowActions>(() => ({ onOptions, onOpenProfile: openProfile, onReply, onToggleLike }), [onOptions, openProfile, onReply, onToggleLike]);

  // Top-level comments in order, each followed by its replies when open, or a "View replies" line.
  type Item = { kind: "comment"; row: Row } | { kind: "toggle"; parentId: string; count: number; open: boolean };
  const items = useMemo<Item[]>(() => {
    const replies = new Map<string, Row[]>();
    for (const c of comments) if (c.parentId) replies.set(c.parentId, [...(replies.get(c.parentId) ?? []), c]);
    const out: Item[] = [];
    for (const c of comments) {
      if (c.parentId) continue;
      out.push({ kind: "comment", row: c });
      const under = replies.get(c.id) ?? [];
      if (!under.length) continue;
      const isOpen = open.has(c.id);
      out.push({ kind: "toggle", parentId: c.id, count: under.length, open: isOpen });
      if (isOpen) for (const r of under) out.push({ kind: "comment", row: r });
    }
    return out;
  }, [comments, open]);

  const toggleReplies = useCallback((parentId: string) => {
    setOpen((prev) => { const next = new Set(prev); if (next.has(parentId)) next.delete(parentId); else next.add(parentId); return next; });
  }, []);

  const renderItem = useCallback(({ item }: { item: Item }) => (item.kind === "comment"
    ? <CommentRow item={item.row} actions={actions} />
    : <RepliesToggle count={item.count} open={item.open} onPress={() => toggleReplies(item.parentId)} testID={`replies-${item.parentId}`} />), [actions, toggleReplies]);

  const closedNote = commentsDisabled ? t("commentsSheet.commentsAreTurnedOffFor") : followersOnly ? t("commentsSheet.onlyFollowersCanCommentOn") : null;

  return (
    <>
      <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
        <Pressable pressEffect="none" style={styles.backdrop} onPress={onClose} accessibilityRole="button" accessibilityLabel={t("common.close")} />
        {/* The keyboard's room comes out of the sheet: it grows while the keyboard is up, so the list keeps space. */}
        <KeyboardAvoider style={[styles.sheet, keyboardShown && styles.sheetKeyboard, { paddingBottom: spacing.md + bottomInset }]}>
          <View style={styles.handle} />
          <Text style={[typography.bodyStrong, styles.title]} accessibilityRole="header">
            {stored > 0 ? (hasMore ? t("commentsSheet.comments", { count: stored }) : t("commentsSheet.comments2", { count: stored })) : t("common.comments")}
          </Text>

          {loading ? (
            <ActivityIndicator color={colors.accentText} style={styles.spinner} />
          ) : loadFailed ? (
            // Not "no comments": they couldn't be loaded.
            <View style={styles.emptyBox}>
              <Text style={typography.bodyStrong}>{t("commentsSheet.couldntLoadComments")}</Text>
              <Text style={[typography.caption, styles.emptyHint]}>{t("commentsSheet.checkYourConnectionAndTry")}</Text>
              <Pressable onPress={() => void load()} style={styles.retry} accessibilityRole="button" hitSlop={8}>
                <Text style={styles.retryText}>{t("common.tryAgain")}</Text>
              </Pressable>
            </View>
          ) : comments.length === 0 ? (
            <View style={styles.emptyBox}>
              <Text style={typography.bodyStrong}>{t("commentsSheet.noCommentsYet")}</Text>
              {!closedNote ? <Text style={[typography.caption, styles.emptyHint]}>{t("commentsSheet.startTheConversation")}</Text> : null}
            </View>
          ) : (
            <FlatList
              ref={listRef}
              data={items}
              keyExtractor={(item) => (item.kind === "comment" ? item.row.id : `toggle-${item.parentId}`)}
              style={styles.list}
              keyboardShouldPersistTaps="handled"
              onEndReachedThreshold={0.3}
              onEndReached={() => void loadMore()}
              ListFooterComponent={loadingMore ? <ActivityIndicator color={colors.accentText} style={styles.spinner} /> : undefined}
              renderItem={renderItem}
            />
          )}

          {error ? <Text style={styles.error}>{error}</Text> : null}

          {closedNote ? (
            <Text style={[typography.caption, styles.disabled]}>{closedNote}</Text>
          ) : (
            <Composer user={user} autoFocus={autoFocus} replyTo={replyTo} onCancelReply={() => setReplyTo(null)} accessToken={accessToken} onSend={onSend} />
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
  body: { color: colors.textPrimary, fontSize: 15, lineHeight: 22 },
  more: { paddingTop: 2, paddingHorizontal: 2 },
  side: { alignItems: "center", gap: spacing.sm, paddingTop: 2 },
  replyRow: { marginLeft: 42 },
  rowActions: { flexDirection: "row", gap: spacing.md, marginTop: 4 },
  rowAction: { color: colors.textSecondary, fontSize: 12, fontWeight: "700" },
  mention: { color: colors.accentText, fontWeight: "700" },
  toggle: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginLeft: 42, paddingVertical: 6 },
  toggleLine: { width: 24, height: StyleSheet.hairlineWidth, backgroundColor: colors.textDisabled },
  replyBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.sm, paddingVertical: 6, marginTop: spacing.xs, borderRadius: radii.md, backgroundColor: colors.surfaceElevated },
  replyBarText: { color: colors.textSecondary, fontSize: 13, flex: 1 },
  suggestions: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingVertical: 4 },
  suggestion: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: 6 },
  suggestionText: { flex: 1 },
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
  sendLabel: { color: colors.accentText, fontWeight: "700", fontSize: 15 },
  sendDisabled: { opacity: 0.4 },
});
