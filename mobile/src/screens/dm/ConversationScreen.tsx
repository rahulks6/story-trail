import { Icon } from "../../components/Icon";
import { ThreadSkeleton } from "../../components/Skeleton";
import { storyReplyLabel } from "../../models/storyReplies";
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  AppState,
  FlatList,
  Image,
  Keyboard,
  Linking,
  Modal,
  PanResponder,
  PermissionsAndroid,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
  type ListRenderItem,
} from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { useHeaderHeight } from "@react-navigation/elements";
import { useSafeAreaInsets } from "react-native-safe-area-context";
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
import {
  getConversation,
  groupName,
  listMessages,
  markConversationRead,
  MAX_MESSAGE_LENGTH,
  MESSAGE_REACTIONS,
  reactToMessage,
  removeMessageReaction,
  sendTyping,
  unsendMessage,
  setConversationMuted,
  hideConversation,
  type Message,
  type MessageReaction,
  type QuotedMessage,
  type GroupDetails,
} from "../../api/conversations";
import { ApiError } from "../../api/client";
import { getStoryOwnerUsername } from "../../api/stories";
import { ReportSheet } from "../../components/ReportSheet";
import { KeyboardAvoider } from "../../components/KeyboardAvoider";
import { applyReaction, applyReceipt, mergeMessages, newestId, oldestId } from "./threadState";
import { tapFeedback } from "../../utils/haptics";
import { launchCamera, launchImageLibrary, type Asset, type ImagePickerResponse } from "react-native-image-picker";
import Video from "react-native-video";
import { Avatar } from "../../components/Avatar";
import { mediaFileUrl } from "../../api/stories";
import { MAX_DM_VIDEO_BYTES, newPendingMedia, newVoiceNote } from "./sendMedia";
import { CapturePreview, type Capture } from "./CapturePreview";
import {
  discardMedia,
  enqueueMedia,
  loadMediaOutbox,
  onMediaSent,
  pendingMedia as pendingMediaFor,
  resumeMedia,
  retryMedia,
  subscribeMediaOutbox,
  type MediaOutboxEntry,
} from "./dmMediaOutbox";
import { VoiceNoteBubble } from "../../components/VoiceNote";
import { useVoiceRecorder } from "../../hooks/useVoiceRecorder";
import { formatClock } from "../../api/music";
import Clipboard from "@react-native-clipboard/clipboard";
import { showToast } from "../../components/Toast";
import { ActionSheet } from "../../components/ActionSheet";
import { blockUser } from "../../api/users";
import { actorName, groupEventText } from "../../models/groupEvents";
import { GroupAvatar } from "../../components/GroupAvatar";

type Props = NativeStackScreenProps<DMStackParamList, "Conversation">;

const PAGE_SIZE = 30;
/** Fallback polling: often while the live connection is down, rarely (a safety net) while it's up. */
const POLL_OFFLINE_MS = 4_000;
const POLL_LIVE_MS = 30_000;
/** Catching up after a long gap: past this many pages, reload the latest page instead. */
const MAX_CATCH_UP_PAGES = 5;
/** Right after Send the mic takes the button's place: a second tap there isn't a new recording. */
const SEND_TAP_GUARD_MS = 600;
/** Two taps on a message this close together heart it (like Instagram). */
const DOUBLE_TAP_MS = 280;
const DOUBLE_TAP_REACTION = MESSAGE_REACTIONS[0];
/** How far a message is swiped to the right before letting go replies to it. */
const SWIPE_REPLY_PX = 56;
/** "typing…" goes out at most this often while you type, and shows this long after the last one. */
const TYPING_SEND_MS = 3_000;
const TYPING_SHOW_MS = 6_000;


/**
 * A message not yet stored by the server (spec's Sending/Failed states), from the
 * persisted DM outbox (state/dmOutbox.ts): it survives the app closing and is sent
 * once, in order, as soon as possible. A message that exists server-side is
 * definitionally at least "sent" (Sent/Delivered/Read come from the server and
 * from realtime read receipts). Photos, videos and voice notes on their way have
 * their own persisted outbox (dmMediaOutbox.ts).
 */
type ListRow =
  | (OutboxMessage & { kind: "pending"; replyTo?: QuotedMessage | null })
  | (Message & { kind: "sent" })
  | (MediaOutboxEntry & { kind: "media"; replyTo?: QuotedMessage | null });

// One row object per message object, so a row whose message didn't change keeps its
// props and its memoized bubble doesn't re-render.
const rowCache = new WeakMap<object, ListRow>();
function rowOf<T extends object>(source: T, make: (s: T) => ListRow): ListRow {
  let row = rowCache.get(source);
  if (!row) {
    row = make(source);
    rowCache.set(source, row);
  }
  return row;
}

function rowKey(row: ListRow): string {
  return row.kind === "sent" ? row.id : row.clientMessageId;
}

/** A photo or video bubble's size: its own shape, within a box no wider than `maxSide`. */
function mediaBox(width: number | null | undefined, height: number | null | undefined, maxSide: number): { width: number; height: number } {
  const ratio = width && height ? Math.min(1.6, Math.max(0.56, width / height)) : 0.75;
  const tall = maxSide * (300 / 230);
  return ratio >= 1 ? { width: maxSide, height: maxSide / ratio } : { width: tall * ratio, height: tall };
}

/** A message as a reply quotes it (the same shape the server sends). */
function quoteOf(message: Message): QuotedMessage {
  return { id: message.id, senderId: message.senderId, body: message.body?.slice(0, 160) ?? null, mediaKind: message.media?.kind ?? null, sharedStory: !!message.sharedStoryId };
}

/** What a quote shows of the message: its text, or what kind of message it was. */
export function quoteSnippet(quote: QuotedMessage): string {
  if (quote.body) return quote.body;
  if (quote.mediaKind === "photo") return "Photo";
  if (quote.mediaKind === "video") return "Video";
  if (quote.mediaKind === "audio") return "Voice message";
  return quote.sharedStory ? "Shared a Story" : "Message";
}

function statusLabel(row: ListRow, nameOf?: RowProps["nameOf"]): string {
  if (row.kind === "media") return row.status === "failed" ? `${row.error ?? "Not sent"} · Tap to retry` : "Sending…";
  if (row.kind === "pending") {
    if (row.status === "failed") return `${row.error ?? "Not sent"} · Tap to retry`;
    return row.status === "waiting" && row.attempts > 0 ? "Waiting for connection…" : "Sending…";
  }
  // A group: Seen once everyone has read it; until then, who has.
  if (row.seenBy) {
    if (row.status === "read") return "Seen by everyone";
    const names = row.seenBy.map((id) => nameOf?.(id)).filter((n): n is string => !!n).map((n) => `@${n}`);
    if (names.length) return `Seen by ${names.length <= 2 ? names.join(" and ") : `${names.slice(0, 2).join(", ")} and ${names.length - 2} more`}`;
  }
  switch (row.status) {
    case "read":
      return "Seen";
    case "delivered":
      return "Delivered";
    default:
      return "Sent";
  }
}

function authHeaders(accessToken: string | null | undefined): Record<string, string> | undefined {
  return accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined;
}

/** Stable handlers every row shares (they read the screen's latest state through a ref). */
interface RowActions {
  onPendingPress: (row: OutboxMessage) => void;
  onPendingMediaPress: (row: MediaOutboxEntry) => void;
  onLongPress: (row: ListRow) => void;
  /** A tap on the reactions under a message: takes yours back, or lets you add one. */
  onReactionsPress: (row: Message) => void;
  onReport: (messageId: string) => void;
  /** Swipe a message (or choose Reply) to answer it with a quote. */
  onReply: (row: Message) => void;
  /** Two quick taps on a message: ❤️ it (or take the ❤️ back). */
  onDoubleTap: (row: Message) => void;
  /** A tap on a quote: scrolls to the message it quotes. */
  onQuotePress: (messageId: string) => void;
  onOpenStory: (storyId: string) => void;
  onView: (viewing: { id: string; kind: "photo" | "video" }) => void;
  onPlay: (key: string) => void;
  onStop: (key: string) => void;
}

interface RowProps {
  row: ListRow;
  userId: string | undefined;
  /** "username" for a person in this conversation (undefined if not known: they left). */
  nameOf: (userId: string) => string | undefined;
  /** In a group: the sender's name above the first of their messages in a run. */
  senderLabel?: string;
  accessToken: string | null | undefined;
  showStatus: boolean;
  playing: boolean;
  maxMediaSide: number;
  actions: RowActions;
}

/**
 * The reactions under a message, like Instagram: each emoji once, with a count when more than
 * one person chose it. Tapping takes your own reaction back (or opens the picker to add one).
 */
function ReactionPills({ reactions, userId, nameOf, mine, onPress }: { reactions: MessageReaction[] | undefined; userId: string | undefined; nameOf: RowProps["nameOf"]; mine: boolean; onPress: () => void }): React.JSX.Element | null {
  if (!reactions?.length) return null;
  const counts = new Map<string, number>();
  for (const r of reactions) counts.set(r.emoji, (counts.get(r.emoji) ?? 0) + 1);
  const ownReaction = reactions.find((r) => r.userId === userId);
  const spoken = reactions.map((r) => `${r.emoji} from ${r.userId === userId ? "you" : nameOf(r.userId) ? `@${nameOf(r.userId)}` : "them"}`).join(", ");
  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [styles.reactionPill, mine ? styles.reactionPillMine : styles.reactionPillTheirs, pressed && styles.reactionPillPressed]}
      accessibilityRole="button"
      accessibilityLabel={`Reactions: ${spoken}`}
      accessibilityHint={ownReaction ? "Removes your reaction" : "Add a reaction"}
    >
      {[...counts].map(([emoji, count]) => (
        <Text key={emoji} style={styles.reactionPillText}>{count > 1 ? `${emoji} ${count}` : emoji}</Text>
      ))}
    </Pressable>
  );
}

/**
 * Swipe a message to the right to reply to it, like Instagram: a reply arrow fades in behind it,
 * a tick of haptics says "let go now", and it springs back. Vertical scrolling is untouched.
 */
function SwipeToReply({ enabled, onReply, children }: { enabled: boolean; onReply: () => void; children: React.ReactNode }): React.JSX.Element {
  const dx = useRef(new Animated.Value(0)).current;
  const armed = useRef(false);
  const onReplyRef = useRef(onReply);
  onReplyRef.current = onReply;
  const responder = useMemo(() => {
    const settle = () => {
      armed.current = false;
      Animated.spring(dx, { toValue: 0, useNativeDriver: true, bounciness: 6 }).start();
    };
    return PanResponder.create({
      onMoveShouldSetPanResponder: (_event, g) => g.dx > 12 && Math.abs(g.dx) > Math.abs(g.dy) * 2,
      onPanResponderTerminationRequest: () => false,
      onPanResponderMove: (_event, g) => {
        const x = Math.max(0, Math.min(g.dx, SWIPE_REPLY_PX + 24));
        dx.setValue(x);
        if (!armed.current && x >= SWIPE_REPLY_PX) {
          armed.current = true;
          tapFeedback("select");
        } else if (armed.current && x < SWIPE_REPLY_PX) armed.current = false;
      },
      onPanResponderRelease: () => {
        if (armed.current) onReplyRef.current();
        settle();
      },
      onPanResponderTerminate: settle,
    });
  }, [dx]);
  if (!enabled) return <>{children}</>;
  const arrowOpacity = dx.interpolate({ inputRange: [0, SWIPE_REPLY_PX], outputRange: [0, 1], extrapolate: "clamp" });
  return (
    <View collapsable={false} {...responder.panHandlers}>
      <Animated.View style={[styles.swipeArrow, { opacity: arrowOpacity }]} pointerEvents="none">
        <Icon name={ICONS.reply} size={20} color={colors.textSecondary} />
      </Animated.View>
      <Animated.View style={{ transform: [{ translateX: dx }] }}>{children}</Animated.View>
    </View>
  );
}

/** The message a reply answers, above the reply: who wrote it and how it started. A tap goes to it. */
function Quote({ quote, userId, nameOf, mine, onPress }: { quote: QuotedMessage; userId: string | undefined; nameOf: RowProps["nameOf"]; mine: boolean; onPress: (id: string) => void }): React.JSX.Element {
  const author = quote.senderId === userId ? "You" : nameOf(quote.senderId) ? `@${nameOf(quote.senderId)}` : "Them";
  const snippet = quoteSnippet(quote);
  return (
    <Pressable
      onPress={() => onPress(quote.id)}
      style={[styles.quote, mine ? styles.quoteMine : styles.quoteTheirs]}
      accessibilityRole="button"
      accessibilityLabel={`Replying to ${author === "You" ? "you" : author}: ${snippet}`}
      accessibilityHint="Shows that message"
    >
      <Text style={styles.quoteAuthor} numberOfLines={1}>{author}</Text>
      <Text style={styles.quoteText} numberOfLines={2}>{snippet}</Text>
    </Pressable>
  );
}

/** The heart that pops on a message you double-tap, like Instagram (only when adding one). */
function HeartPop({ trigger }: { trigger: number }): React.JSX.Element | null {
  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!trigger) return;
    progress.setValue(0);
    Animated.sequence([
      Animated.spring(progress, { toValue: 1, friction: 4, tension: 120, useNativeDriver: true }),
      Animated.timing(progress, { toValue: 2, duration: 220, delay: 180, useNativeDriver: true }),
    ]).start();
  }, [progress, trigger]);
  if (!trigger) return null;
  const scale = progress.interpolate({ inputRange: [0, 1, 2], outputRange: [0.3, 1, 1.2] });
  const opacity = progress.interpolate({ inputRange: [0, 0.15, 1, 2], outputRange: [0, 1, 1, 0] });
  return (
    <Animated.View pointerEvents="none" style={[styles.heartPop, { opacity, transform: [{ scale }] }]}>
      <Icon name={ICONS.liked} size={40} color={colors.like} />
    </Animated.View>
  );
}

/** One message in the thread. Memoized: typing, recording or a poll that changed nothing doesn't re-render it. */
const MessageRow = memo(function MessageRow(props: RowProps): React.JSX.Element {
  const { row, actions } = props;
  return (
    <SwipeToReply enabled={row.kind === "sent" && !row.event} onReply={() => { if (row.kind === "sent") actions.onReply(row); }}>
      <MessageContent {...props} />
    </SwipeToReply>
  );
});

function MessageContent({ row, userId, nameOf, senderLabel, accessToken, showStatus, playing, maxMediaSide, actions }: RowProps): React.JSX.Element {
  const canReport = row.kind === "sent" && row.senderId !== userId;
  const otherUsername = row.kind === "sent" && row.senderId !== userId ? nameOf(row.senderId) : undefined;
  // A double tap hearts a stored message; a single tap that also does something (open a photo
  // or a shared Story) waits a moment to be sure it isn't the first of two.
  const lastTapAt = useRef(0);
  const singleTap = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [heartPop, setHeartPop] = useState(0);
  useEffect(() => () => { if (singleTap.current) clearTimeout(singleTap.current); }, []);
  const onTap = (single?: () => void) => {
    if (row.kind !== "sent") return single?.();
    const now = Date.now();
    if (now - lastTapAt.current < DOUBLE_TAP_MS) {
      lastTapAt.current = 0;
      if (singleTap.current) clearTimeout(singleTap.current);
      singleTap.current = null;
      if (row.reactions?.find((r) => r.userId === userId)?.emoji !== DOUBLE_TAP_REACTION) setHeartPop((n) => n + 1);
      actions.onDoubleTap(row);
      return;
    }
    lastTapAt.current = now;
    if (single) singleTap.current = setTimeout(() => { singleTap.current = null; single(); }, DOUBLE_TAP_MS);
  };
  // A group's "what happened" line, centred, not a bubble.
  if (row.kind === "sent" && row.event) {
    const text = groupEventText(row.event, actorName(row.senderId, userId, nameOf(row.senderId)), (id) => (id === userId ? "you" : nameOf(id) ? `@${nameOf(id)}` : "someone"));
    return <Text style={styles.eventLine} accessibilityRole="text">{text}</Text>;
  }
  const quote = row.replyTo ? (
    <Quote quote={row.replyTo} userId={userId} nameOf={nameOf} mine={row.kind !== "sent" || row.senderId === userId} onPress={actions.onQuotePress} />
  ) : null;
  if (row.kind === "media" || (row.kind === "sent" && row.media)) {
    const mineMedia = row.kind === "media" || row.senderId === userId;
    const kind = row.kind === "media" ? row.mediaKind : row.media!.kind;
    const failedMedia = row.kind === "media" && row.status === "failed";
    const who = mineMedia ? "You" : otherUsername ? `@${otherUsername}` : "Them";
    if (kind === "audio") {
      const key = rowKey(row);
      return (
        <View style={[styles.bubbleRow, mineMedia ? styles.bubbleRowMine : styles.bubbleRowTheirs]}>
          <View style={[styles.bubbleColumn, mineMedia ? styles.bubbleColumnMine : styles.bubbleColumnTheirs]}>
            {senderLabel ? <Text style={styles.senderLabel} numberOfLines={1}>{senderLabel}</Text> : null}
            {quote}
            <VoiceNoteBubble
              url={row.kind === "media" ? row.uri : mediaFileUrl(row.media!.id, "audio")}
              accessToken={accessToken}
              durationMs={row.kind === "media" ? row.durationMs ?? null : row.media!.durationMs}
              mine={mineMedia}
              sending={row.kind === "media" && row.status === "sending"}
              playing={playing}
              onPlay={() => (row.kind === "media" && row.status === "failed" ? actions.onPendingMediaPress(row) : actions.onPlay(key))}
              onStop={() => actions.onStop(key)}
              label={who}
              onLongPress={() => (row.kind === "media" ? actions.onPendingMediaPress(row) : actions.onLongPress(row))}
            />
            {row.kind === "sent" ? <ReactionPills reactions={row.reactions} userId={userId} nameOf={nameOf} mine={mineMedia} onPress={() => actions.onReactionsPress(row)} /> : null}
            {showStatus || failedMedia ? <Text style={styles.statusCaption}>{statusLabel(row, nameOf)}</Text> : null}
          </View>
        </View>
      );
    }
    const box = row.kind === "media" ? mediaBox(row.width, row.height, maxMediaSide) : mediaBox(row.media!.width, row.media!.height, maxMediaSide);
    // Bubbles load the small variant; the full-screen viewer loads "display".
    const source = row.kind === "media" ? { uri: row.uri } : { uri: mediaFileUrl(row.media!.id, "thumbnail"), headers: authHeaders(accessToken) };
    return (
      <View style={[styles.bubbleRow, mineMedia ? styles.bubbleRowMine : styles.bubbleRowTheirs]}>
        <View style={[styles.bubbleColumn, mineMedia ? styles.bubbleColumnMine : styles.bubbleColumnTheirs]}>
          {senderLabel ? <Text style={styles.senderLabel} numberOfLines={1}>{senderLabel}</Text> : null}
          {quote}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${who}: ${kind === "video" ? "Video" : "Photo"}`}
            accessibilityHint={row.kind === "media" ? (failedMedia ? "Retry or delete" : undefined) : "Opens it full screen"}
            onPress={() => {
              if (row.kind === "media") actions.onPendingMediaPress(row);
              else onTap(() => actions.onView({ id: row.media!.id, kind: kind === "video" ? "video" : "photo" }));
            }}
            onLongPress={() => actions.onLongPress(row)}
            style={[styles.mediaBubble, box, failedMedia && styles.mediaFailed]}
          >
            {/* A video on its way is a still placeholder: never a video player per row. */}
            {row.kind === "media" && kind === "video" ? (
              <View style={[StyleSheet.absoluteFill, styles.videoPlaceholder]} />
            ) : (
              <Image source={source} style={StyleSheet.absoluteFill} resizeMode="cover" resizeMethod="resize" />
            )}
            {kind === "video" ? (
              <View style={styles.playBadge} pointerEvents="none"><Icon name={ICONS.play} size={22} color="#FFFFFF" /></View>
            ) : null}
            {row.kind === "media" && row.status === "sending" ? (
              <View style={styles.mediaSending} pointerEvents="none"><ActivityIndicator color="#FFFFFF" /></View>
            ) : null}
            <HeartPop trigger={heartPop} />
          </Pressable>
          {row.kind === "sent" && row.body ? (
            <View style={[styles.bubble, mineMedia ? styles.bubbleMine : styles.bubbleTheirs, styles.mediaCaption]}>
              <Text style={mineMedia ? styles.bubbleTextMine : styles.bubbleTextTheirs}>{row.body}</Text>
            </View>
          ) : null}
          {row.kind === "sent" ? <ReactionPills reactions={row.reactions} userId={userId} nameOf={nameOf} mine={mineMedia} onPress={() => actions.onReactionsPress(row)} /> : null}
          {showStatus || failedMedia ? <Text style={styles.statusCaption}>{statusLabel(row, nameOf)}</Text> : null}
        </View>
      </View>
    );
  }
  const mine = row.kind === "pending" || row.senderId === userId;
  const failed = row.kind === "pending" && row.status === "failed";
  const reply = row.kind === "sent" ? row.storyReply ?? null : null;
  const replyLabel = reply ? storyReplyLabel(reply, mine) : null;
  const openableStory = row.kind === "sent" ? row.sharedStoryId ?? reply?.storyId ?? null : null;
  const shared = row.kind === "sent"
    ? (row.sharedStoryId ? (row.sharedStory ? `@${row.sharedStory.ownerUsername}'s Story${row.sharedStory.active ? "" : ", no longer available"}` : "Shared a Story") : replyLabel)
    : row.storyId ? "Shared a Story" : null;
  // Bubbles show who sent what by their side of the screen; a screen reader says it.
  const spoken = [shared, row.body].filter(Boolean).join(". ");
  return (
    <View style={[styles.bubbleRow, mine ? styles.bubbleRowMine : styles.bubbleRowTheirs]}>
      <View style={[styles.bubbleColumn, mine ? styles.bubbleColumnMine : styles.bubbleColumnTheirs]}>
        {senderLabel ? <Text style={styles.senderLabel} numberOfLines={1}>{senderLabel}</Text> : null}
        {quote}
        <Pressable
          // A button only where a tap does something (retry, open the shared Story).
          accessibilityRole={row.kind === "pending" || openableStory ? "button" : undefined}
          style={[
            styles.bubble,
            mine ? styles.bubbleMine : styles.bubbleTheirs,
            row.kind === "pending" && styles.bubblePending,
            failed && styles.bubbleFailed,
          ]}
          disabled={row.kind === "pending" && row.status === "sending"}
          onPress={() => {
            if (row.kind === "pending") actions.onPendingPress(row);
            else onTap(openableStory ? () => actions.onOpenStory(openableStory) : undefined);
          }}
          onLongPress={() => actions.onLongPress(row)}
          accessibilityLabel={`${mine ? "You" : otherUsername ? `@${otherUsername}` : "Them"}: ${spoken}`}
          accessibilityHint={
            row.kind === "pending" && row.status !== "sending" ? "Retry or delete this message"
              : openableStory ? "Opens the Story" : undefined
          }
          accessibilityActions={row.kind === "sent" ? [{ name: "reply", label: "Reply" }, { name: "react", label: "React" }, ...(canReport ? [{ name: "report", label: "Report message" }] : [])] : undefined}
          onAccessibilityAction={(event) => {
            if (row.kind !== "sent") return;
            if (event.nativeEvent.actionName === "reply") actions.onReply(row);
            else if (event.nativeEvent.actionName === "react") actions.onLongPress(row);
            else if (event.nativeEvent.actionName === "report" && canReport) actions.onReport(row.id);
          }}
        >
          {row.kind === "sent" && row.sharedStoryId ? (
            // A card: the Story's picture (when you may see it), and whose it is.
            <View style={styles.storyCard}>
              {row.sharedStory?.mediaId ? (
                <Image source={{ uri: mediaFileUrl(row.sharedStory.mediaId, "thumbnail"), headers: authHeaders(accessToken) }} style={styles.storyCardImage} resizeMode="cover" />
              ) : (
                <View style={[styles.storyCardImage, styles.storyCardGone]}>
                  <Text style={styles.storyCardGoneText}>{row.sharedStory && !row.sharedStory.active ? "Story unavailable" : "Story"}</Text>
                </View>
              )}
              <Text style={[styles.storyCardOwner, mine ? styles.bubbleTextMine : styles.bubbleTextTheirs]} numberOfLines={1}>
                {row.sharedStory ? `@${row.sharedStory.ownerUsername}'s Story` : "Shared a Story"}
              </Text>
            </View>
          ) : null}
          {row.kind === "pending" && row.storyId ? (
            <Text style={styles.bubbleTextMine}>Shared a Story</Text>
          ) : null}
          {replyLabel ? <Text style={[styles.replyLabel, mine ? styles.bubbleTextMine : styles.bubbleTextTheirs]}>{replyLabel}</Text> : null}
          {row.body ? (
            <Text style={[mine ? styles.bubbleTextMine : styles.bubbleTextTheirs, reply?.kind === "reaction" && styles.reactionGlyph]}>{row.body}</Text>
          ) : null}
          <HeartPop trigger={heartPop} />
        </Pressable>
        {row.kind === "sent" ? <ReactionPills reactions={row.reactions} userId={userId} nameOf={nameOf} mine={mine} onPress={() => actions.onReactionsPress(row)} /> : null}
        {showStatus ? <Text style={styles.statusCaption}>{statusLabel(row, nameOf)}</Text> : null}
      </View>
    </View>
  );
}

interface ComposerProps {
  /** Queues a text message; throws (with a message to show) when it can't. */
  onSendText: (body: string) => Promise<void>;
  onVoiceNote: (uri: string, durationMs: number) => void;
  onStartRecording: () => void;
  onTakePhoto: () => void;
  onPickFromGallery: () => void;
  /** Called as you type (the screen decides how often the other person hears about it). */
  onTyping: () => void;
  /** The message you're replying to, shown above the box; null when not replying. */
  replyingTo: { author: string; snippet: string } | null;
  onCancelReply: () => void;
}

/**
 * The message box and voice recorder. Its own component so typing and
 * the recording timer re-render only this, never the thread above it.
 */
const Composer = memo(function Composer({ onSendText, onVoiceNote, onStartRecording, onTakePhoto, onPickFromGallery, onTyping, replyingTo, onCancelReply }: ComposerProps): React.JSX.Element {
  // The tab bar hides in a chat, so the message box keeps clear of Android's navigation bar and
  // the iPhone home indicator itself — except while the keyboard covers them.
  const { bottom: bottomInset } = useSafeAreaInsets();
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  useEffect(() => {
    const shown = Keyboard.addListener("keyboardDidShow", () => setKeyboardOpen(true));
    const hidden = Keyboard.addListener("keyboardDidHide", () => setKeyboardOpen(false));
    return () => {
      shown.remove();
      hidden.remove();
    };
  }, []);
  const [draft, setDraft] = useState("");
  const [composerError, setComposerError] = useState<string | null>(null);
  // A double tap on Send sends once: the draft clears at the first tap, before anything is awaited.
  const sendingRef = useRef(false);
  const lastSendAt = useRef(0);

  const recorder = useVoiceRecorder(onVoiceNote, setComposerError);
  const recording = recorder.state.status !== "idle";
  // Choosing a message to reply to puts you straight into the box.
  const inputRef = useRef<React.ComponentRef<typeof TextInput>>(null);
  const replying = replyingTo !== null;
  useEffect(() => {
    if (replying) inputRef.current?.focus();
  }, [replying, replyingTo]);
  const onChangeDraft = (text: string) => {
    setDraft(text);
    if (text.trim()) onTyping();
  };

  const onSend = async () => {
    const body = draft.trim();
    if (!body || sendingRef.current) return;
    sendingRef.current = true;
    lastSendAt.current = Date.now();
    setDraft("");
    try {
      await onSendText(body);
      setComposerError(null);
    } catch (error) {
      setDraft((current) => current || body); // nothing lost: it's back in the box
      setComposerError(error instanceof Error ? error.message : "Couldn't send that message.");
    } finally {
      sendingRef.current = false;
    }
  };

  const onMic = () => {
    if (sendingRef.current || Date.now() - lastSendAt.current < SEND_TAP_GUARD_MS) return;
    onStartRecording();
    void recorder.start();
  };


  const padBottom = { paddingBottom: spacing.sm + (keyboardOpen ? 0 : bottomInset) };
  return (
    <>
      {composerError ? <Text style={styles.composerError}>{composerError}</Text> : null}
      {replyingTo ? (
        <View style={styles.replyBar}>
          <Icon name={ICONS.reply} size={18} color={colors.textSecondary} />
          <View style={styles.replyBarText}>
            <Text style={styles.replyBarTitle} numberOfLines={1}>Replying to {replyingTo.author}</Text>
            <Text style={styles.replyBarSnippet} numberOfLines={1}>{replyingTo.snippet}</Text>
          </View>
          <Pressable onPress={onCancelReply} hitSlop={10} style={styles.replyBarClose} accessibilityRole="button" accessibilityLabel="Cancel reply">
            <Icon name={ICONS.close} size={18} color={colors.textSecondary} />
          </Pressable>
        </View>
      ) : null}
      {recording ? (
        <View style={[styles.composerRow, styles.recordingRow, padBottom]}>
          <Pressable onPress={() => void recorder.cancel()} hitSlop={8} style={styles.recordCancel} accessibilityRole="button" accessibilityLabel="Delete voice message">
            <Icon name={ICONS.trash} size={22} color={colors.danger} />
          </Pressable>
          <View style={styles.recordDot} />
          <Text style={styles.recordTime} accessibilityLiveRegion="polite">
            {recorder.state.status === "recording" ? formatClock(recorder.state.elapsedMs) : "0:00"}
          </Text>
          <Text style={styles.recordHint} numberOfLines={1}>Recording…</Text>
          <Pressable
            style={[styles.roundButton, styles.sendRound]}
            onPress={() => void recorder.send()}
            disabled={recorder.state.status !== "recording"}
            accessibilityRole="button"
            accessibilityLabel="Send voice message"
          >
            <Icon name={ICONS.send} size={20} color={colors.onAccent} />
          </Pressable>
        </View>
      ) : (
        <View style={[styles.composerRow, padBottom]}>
          {/* Camera always; the gallery steps aside while you type (emoji come from the keyboard). */}
          <Pressable style={[styles.roundButton, styles.cameraButton]} onPress={onTakePhoto} hitSlop={4} accessibilityRole="button" accessibilityLabel="Take a photo or video">
            <Icon name={ICONS.camera} size={20} color={colors.onAccent} />
          </Pressable>
          {draft.trim() ? null : (
            <Pressable style={styles.roundButton} onPress={onPickFromGallery} hitSlop={4} accessibilityRole="button" accessibilityLabel="Send a photo or video from your gallery">
              <Icon name={ICONS.gallery} size={22} color={colors.textPrimary} />
            </Pressable>
          )}
          <TextInput
            ref={inputRef}
            style={styles.composerInput}
            accessibilityLabel="Message"
            placeholder="Message…"
            placeholderTextColor={colors.textDisabled}
            value={draft}
            onChangeText={onChangeDraft}
            maxLength={MAX_MESSAGE_LENGTH}
            multiline
          />
          {draft.trim() ? (
            <Pressable style={[styles.roundButton, styles.sendRound]} onPress={() => void onSend()} accessibilityRole="button" accessibilityLabel="Send">
              <Icon name={ICONS.send} size={20} color={colors.onAccent} />
            </Pressable>
          ) : (
            // Nothing typed: the microphone, like Instagram and WhatsApp. Tap to record.
            <Pressable style={styles.roundButton} onPress={onMic} accessibilityRole="button" accessibilityLabel="Record a voice message">
              <Icon name={ICONS.mic} size={22} color={colors.textPrimary} />
            </Pressable>
          )}
        </View>
      )}
    </>
  );
});

/** Camera or photos refused for good: only Settings can turn them back on. */
function accessRefused(what: "camera" | "photos"): void {
  Alert.alert(
    what === "camera" ? "Allow camera access" : "Allow photo access",
    what === "camera"
      ? "To take a photo or video here, allow Katkee to use the camera in your phone's Settings."
      : "To send photos and videos, allow Katkee to access them in your phone's Settings.",
    [
      { text: "Not now", style: "cancel" },
      { text: "Open Settings", onPress: () => void Linking.openSettings().catch(() => undefined) },
    ],
  );
}

/**
 * Real message thread (spec sections 32-33). The list is `inverted` with data
 * kept in the backend's own newest-first order — the standard React Native chat
 * pattern (bottom of screen = index 0), so "load older" is just `onEndReached`.
 * New messages and read receipts arrive over the realtime connection; history
 * pages use message-id cursors, which don't shift as new messages arrive.
 */
export function ConversationScreen({ route }: Props): React.JSX.Element {
  const { conversationId, otherUsername, otherDisplayName, otherAvatarMediaId, group: isGroupParam, title: groupTitleParam } = route.params;
  const { top: insetsTop } = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  // Media bubbles fit the 78% column on small phones too.
  const maxMediaSide = Math.min(230, Math.round(windowWidth * 0.62));
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
  const [outbox, setOutbox] = useState<OutboxMessage[]>([]);
  const [reportingMessageId, setReportingMessageId] = useState<string | null>(null);
  /** The message whose reaction picker is open (long-press a message). */
  const [reactingTo, setReactingTo] = useState<Message | null>(null);
  /** The message you're answering (swipe it, or Reply in its menu); quoted above your reply. */
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const replyingRef = useRef<Message | null>(null);
  replyingRef.current = replyingTo;
  /** Who is typing right now (their app says so every few seconds); null when nobody is. */
  const [typingUserId, setTypingUserId] = useState<string | null>(null);
  const otherTyping = typingUserId !== null;
  /** You muted this chat (no pushes from it); and the 1:1 header's ⋯ menu. */
  const [muted, setMuted] = useState(false);
  const [chatMenuOpen, setChatMenuOpen] = useState(false);
  /** A group's name and people (loaded from the server; refreshed when someone joins or leaves). */
  const [group, setGroup] = useState<GroupDetails | null>(null);
  const isGroup = !!isGroupParam || group !== null;
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTypingSent = useRef(0);
  const listRef = useRef<FlatList<ListRow>>(null);
  /** A photo or video the DM camera just took, waiting for a filter and Send. */
  const [capture, setCapture] = useState<Capture | null>(null);
  const [pendingMedia, setPendingMedia] = useState<MediaOutboxEntry[]>([]);
  const [viewing, setViewing] = useState<{ id?: string; uri?: string; kind: "photo" | "video" } | null>(null);
  // Which voice note is playing (one at a time).
  const [playingKey, setPlayingKey] = useState<string | null>(null);
  const focusedRef = useRef(true);
  const messagesRef = useRef<Message[] | null>(null);
  messagesRef.current = messages;
  const tokenRef = useRef(accessToken);
  tokenRef.current = accessToken;
  const userId = user?.id;
  const getToken = useCallback(() => tokenRef.current, []);

  /** Who it's with: a notification link carries only the conversation id, and a group's people change. */
  const loadDetails = useCallback(async () => {
    const token = tokenRef.current;
    if (!token) return;
    try {
      const { conversation } = await getConversation(conversationId, token);
      setMuted(!!conversation.muted);
      if (conversation.kind === "group") {
        setGroup(conversation);
        const others = conversation.members.filter((m) => m.userId !== userId);
        navigation.setParams({ group: true, title: groupName(conversation.title, others, others.length) });
      } else if (conversation.otherUser) {
        navigation.setParams({
          otherUsername: conversation.otherUser.username,
          otherDisplayName: conversation.otherUser.displayName,
          otherAvatarMediaId: conversation.otherUser.avatarMediaId ?? null,
        });
      }
    } catch (error: unknown) {
      if (error instanceof ApiError && error.status === 404) setLoadError(isGroupParam ? "You're no longer in this group." : "This conversation isn't available.");
    }
  }, [conversationId, isGroupParam, navigation, userId]);
  // Also for a 1:1 chat opened from the inbox: whether you muted it (the header's menu).
  useEffect(() => {
    void loadDetails();
  }, [loadDetails]);

  const isGroupRef = useRef(isGroup);
  isGroupRef.current = isGroup;
  const loadDetailsRef = useRef(loadDetails);
  loadDetailsRef.current = loadDetails;

  /** "username" for someone in this conversation. */
  const members = useMemo(() => new Map((group?.members ?? []).map((m) => [m.userId, m])), [group]);
  const nameOf = useCallback((id: string): string | undefined => members.get(id)?.username ?? (!isGroup && id !== userId ? otherUsername : undefined), [isGroup, members, otherUsername, userId]);

  // The header: who you're talking to, with their photo; a tap opens their profile. `initial: false`
  // keeps the Search tab's own first screen under it (a first visit creates that stack).
  const openProfile = useCallback(() => {
    if (otherUsername) rootNavigation.navigate("Main", { screen: "Search", params: { screen: "UserProfile", params: { username: otherUsername }, initial: false } });
  }, [otherUsername, rootNavigation]);
  useEffect(() => {
    if (isGroup) {
      const others = (group?.members ?? []).filter((m) => m.userId !== userId);
      const title = group ? groupName(group.title, others, others.length) : groupTitleParam ?? "Group";
      navigation.setOptions({
        headerTitle: () => (
          <Pressable
            onPress={() => navigation.navigate("GroupInfo", { conversationId })}
            style={styles.header}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel={`${title}${group ? `, ${group.members.length} people` : ""}`}
            accessibilityHint="Shows the group's people and settings"
          >
            <GroupAvatar members={others} size={34} />
            <View style={styles.headerNames}>
              <Text style={styles.headerName} numberOfLines={1}>{title}</Text>
              {group ? <Text style={styles.headerUsername} numberOfLines={1}>{group.members.length} people</Text> : null}
            </View>
          </Pressable>
        ),
        headerRight: undefined, // a group's options are on its info screen
      });
      return;
    }
    navigation.setOptions({
      headerTitle: () => (
        <Pressable
          onPress={openProfile}
          disabled={!otherUsername}
          style={styles.header}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel={otherUsername ? `${otherDisplayName ?? otherUsername}, @${otherUsername}` : "Conversation"}
          accessibilityHint="Opens their profile"
        >
          {otherUsername ? <Avatar username={otherUsername} displayName={otherDisplayName ?? otherUsername} avatarMediaId={otherAvatarMediaId ?? null} size={34} /> : null}
          <View style={styles.headerNames}>
            <Text style={styles.headerName} numberOfLines={1}>{otherDisplayName ?? otherUsername ?? ""}</Text>
            {otherUsername ? <Text style={styles.headerUsername} numberOfLines={1}>@{otherUsername}</Text> : null}
          </View>
        </Pressable>
      ),
      headerRight: () => (
        <Pressable onPress={() => setChatMenuOpen(true)} hitSlop={10} style={styles.headerMore} accessibilityRole="button" accessibilityLabel="Chat options">
          <Icon name={ICONS.more} size={22} color={colors.textPrimary} />
        </Pressable>
      ),
    });
  }, [conversationId, group, groupTitleParam, isGroup, navigation, openProfile, otherAvatarMediaId, otherDisplayName, otherUsername, userId]);

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

  // Photos, videos and voice notes on their way: persisted, and carried on from where they
  // stopped when the thread opens again (sending doesn't stop when you leave it).
  useEffect(() => {
    if (!userId) return;
    const sync = () => setPendingMedia(pendingMediaFor(userId, conversationId));
    const unsubscribe = subscribeMediaOutbox(sync);
    void loadMediaOutbox(userId).then(sync).then(() => resumeMedia(userId, conversationId, getToken));
    const unsubscribeSent = onMediaSent((owner, message) => {
      if (owner === userId && message.conversationId === conversationId) {
        setMessages((current) => mergeMessages(current ?? [], [message]));
      }
    });
    return () => { unsubscribe(); unsubscribeSent(); };
  }, [conversationId, getToken, userId]);

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
      } catch (error) {
        // Taken out of a group (or the chat is gone): say so. Offline: the next event, resync or poll tries again.
        if (error instanceof ApiError && error.status === 404) {
          setMessages(null);
          setLoadError(isGroupParam ? "You're no longer in this group." : "This conversation isn't available.");
        }
      }
    })();
    catchingUp.current = work;
    try { await work; } finally { catchingUp.current = null; }
  }, [conversationId, isGroupParam, loadLatest, markRead, userId]);

  /** Everything new since the thread was last current, then fresh statuses for recent messages. */
  const syncThread = useCallback(async () => {
    await catchUp();
    await loadLatest();
  }, [catchUp, loadLatest]);

  const typingRef = useRef<string | null>(null);
  const stopTyping = useCallback(() => {
    if (typingTimer.current) clearTimeout(typingTimer.current);
    typingTimer.current = null;
    typingRef.current = null;
    setTypingUserId(null);
  }, []);
  useEffect(() => stopTyping, [stopTyping]);

  /** Tells the other person you're typing: at most every few seconds, and never waits on it. */
  const onTyping = useCallback(() => {
    const token = tokenRef.current;
    if (!token || Date.now() - lastTypingSent.current < TYPING_SEND_MS) return;
    lastTypingSent.current = Date.now();
    void sendTyping(conversationId, token).catch(() => undefined);
  }, [conversationId]);

  /** The reply in progress goes with the next message you send, whatever kind it is. */
  const takeReply = useCallback((): string | undefined => {
    const target = replyingRef.current;
    if (!target) return undefined;
    replyingRef.current = null;
    setReplyingTo(null);
    return target.id;
  }, []);
  const onCancelReply = useCallback(() => setReplyingTo(null), []);

  useRealtimeEvents((event) => {
    if (event.type === "resync") {
      void syncThread(); // reconnected: anything could have happened meanwhile
    } else if (event.type === "message" && event.conversationId === conversationId) {
      if (event.senderId === typingRef.current) stopTyping(); // what they were typing just arrived
      void catchUp();
      if (isGroup) void loadDetails(); // someone may have joined, left or renamed it
    } else if (event.type === "unsent" && event.conversationId === conversationId) {
      setMessages((current) => current?.filter((m) => m.id !== event.messageId) ?? current);
    } else if (event.type === "typing" && event.conversationId === conversationId && event.userId !== userId) {
      setTypingUserId(event.userId);
      typingRef.current = event.userId;
      if (typingTimer.current) clearTimeout(typingTimer.current);
      typingTimer.current = setTimeout(stopTyping, TYPING_SHOW_MS);
    } else if (event.type === "receipt" && event.conversationId === conversationId && userId && event.userId !== userId) {
      setMessages((current) => (current ? applyReceipt(current, userId, event) : current));
    } else if (event.type === "reaction" && event.conversationId === conversationId) {
      setMessages((current) => (current ? applyReaction(current, event.messageId, event.userId, event.emoji) : current));
    }
  });

  useFocusEffect(
    useCallback(() => {
      focusedRef.current = true;
      void syncThread();
      if (isGroupRef.current) void loadDetailsRef.current(); // back from the group's info: names may have changed
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
  const onEndReached = useCallback(() => void loadOlder(), [loadOlder]);

  const onSendText = useCallback(async (body: string) => {
    if (!userId) throw new Error("You're signed out.");
    const replyToMessageId = replyingRef.current?.id;
    await enqueueMessage(userId, conversationId, { body, ...(replyToMessageId ? { replyToMessageId } : {}) });
    takeReply(); // only once it's queued: a refused message keeps its reply
    lastTypingSent.current = 0;
    void flushOutbox(userId, getToken, { force: true });
  }, [conversationId, getToken, takeReply, userId]);

  const sendMedia = useCallback((item: Parameters<typeof enqueueMedia>[2]) => {
    if (!userId) return;
    const replyToMessageId = takeReply();
    void enqueueMedia(userId, conversationId, replyToMessageId ? { ...item, replyToMessageId } : item, getToken).catch(() => {
      Alert.alert("Not sent", "Couldn't send that. Try again.");
    });
  }, [conversationId, getToken, takeReply, userId]);

  const onVoiceNote = useCallback((uri: string, durationMs: number) => sendMedia(newVoiceNote(uri, durationMs)), [sendMedia]);
  const onStartRecording = useCallback(() => setPlayingKey(null), []);

  const onPickedAssets = useCallback((assets: Asset[] | undefined) => {
    for (const asset of assets ?? []) {
      if (!asset.uri) continue;
      if (asset.type?.startsWith("video/") && (asset.fileSize ?? 0) > MAX_DM_VIDEO_BYTES) {
        Alert.alert("Video too large", "Choose a video under 100 MB, or a shorter one.");
        continue;
      }
      sendMedia(newPendingMedia({ uri: asset.uri, type: asset.type, width: asset.width, height: asset.height }));
    }
  }, [sendMedia]);
  const onPicked = useCallback((result: ImagePickerResponse, source: "camera" | "photos") => {
    if (result.didCancel) return;
    // iOS reports a refused camera or photo library as "permission": offer Settings, not "try again".
    if (result.errorCode === "permission") accessRefused(source);
    else if (result.errorCode === "camera_unavailable") Alert.alert("No camera", "There's no camera available. Choose from your gallery instead.");
    else if (result.errorCode) Alert.alert(source === "camera" ? "Camera unavailable" : "Gallery unavailable", result.errorMessage ?? "Try again.");
    else if (source === "camera" && result.assets?.length === 1 && result.assets[0]!.uri) {
      const asset = result.assets[0]!;
      if (asset.type?.startsWith("video/") && (asset.fileSize ?? 0) > MAX_DM_VIDEO_BYTES) Alert.alert("Video too large", "Record a shorter video.");
      else setCapture({ uri: asset.uri!, type: asset.type, width: asset.width, height: asset.height });
    } else onPickedAssets(result.assets);
  }, [onPickedAssets]);
  const onSendCapture = useCallback((taken: Capture, filter: string | undefined) => {
    setCapture(null);
    sendMedia(newPendingMedia(taken, filter));
  }, [sendMedia]);
  const onCancelCapture = useCallback(() => setCapture(null), []);
  const onPickFromGallery = useCallback(async () => {
    const result = await launchImageLibrary({ mediaType: "mixed", selectionLimit: 10, maxWidth: 2048, maxHeight: 2048, quality: 0.8, videoQuality: "medium", assetRepresentationMode: "compatible" });
    onPicked(result, "photos");
  }, [onPicked]);
  const onTakePhoto = useCallback(async () => {
    // The app declares the camera permission, so Android needs it granted before the camera opens.
    if (Platform.OS === "android") {
      const granted = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.CAMERA);
      if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
        accessRefused("camera");
        return;
      }
    }
    const result = await launchCamera({ mediaType: "mixed", maxWidth: 2048, maxHeight: 2048, quality: 0.8, videoQuality: "medium", durationLimit: 60, saveToPhotos: false });
    onPicked(result, "camera");
  }, [onPicked]);
  const onTakePhotoPress = useCallback(() => void onTakePhoto(), [onTakePhoto]);
  const onPickFromGalleryPress = useCallback(() => void onPickFromGallery(), [onPickFromGallery]);

  const onOpenSharedStory = async (storyId: string) => {
    if (!accessToken) return;
    try {
      const { username: ownerUsername } = await getStoryOwnerUsername(storyId, accessToken);
      rootNavigation.navigate("StoryViewer", { creators: [ownerUsername], startIndex: 0, initialStoryId: storyId });
    } catch {
      // The Story is no longer accessible (expired/deleted) — nothing to open.
    }
  };

  /** Shown at once; put back (with a note) if the server didn't take it. */
  const setReaction = async (messageId: string, emoji: string | null) => {
    const token = tokenRef.current;
    if (!token || !userId) return;
    const before = messagesRef.current?.find((m) => m.id === messageId)?.reactions?.find((r) => r.userId === userId)?.emoji ?? null;
    if (before === emoji) return;
    tapFeedback("select");
    setMessages((current) => (current ? applyReaction(current, messageId, userId, emoji) : current));
    try {
      const { reactions } = emoji ? await reactToMessage(conversationId, messageId, emoji, token) : await removeMessageReaction(conversationId, messageId, token);
      setMessages((current) => current?.map((m) => (m.id === messageId && JSON.stringify(m.reactions ?? []) !== JSON.stringify(reactions) ? { ...m, reactions } : m)) ?? current);
    } catch (error) {
      setMessages((current) => (current ? applyReaction(current, messageId, userId, before) : current));
      Alert.alert("Couldn't react", error instanceof ApiError && error.status !== 404 ? error.message : "Check your connection and try again.");
    }
  };

  const toggleMute = async () => {
    const token = tokenRef.current;
    if (!token) return;
    const next = !muted;
    setMuted(next);
    try {
      await setConversationMuted(conversationId, next, token);
      showToast(next ? "Notifications muted" : "Notifications on");
    } catch {
      setMuted(!next);
      Alert.alert("Couldn't change that", "Check your connection and try again.");
    }
  };
  const blockOther = () => {
    if (!otherUsername) return;
    Alert.alert(`Block @${otherUsername}?`, "They won't be able to message you, see your Stories or find your profile.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Block",
        style: "destructive",
        onPress: async () => {
          const token = tokenRef.current;
          if (!token) return;
          try {
            await blockUser(otherUsername, token);
            showToast(`Blocked @${otherUsername}`);
            navigation.popToTop();
          } catch {
            Alert.alert("Couldn't block", "Check your connection and try again.");
          }
        },
      },
    ]);
  };
  const deleteChat = () => {
    Alert.alert("Delete this chat?", "It's removed from your inbox only. If they message you again, it comes back.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          const token = tokenRef.current;
          if (!token) return;
          try {
            await hideConversation(conversationId, token);
            void refreshUnreadCount();
            navigation.popToTop();
          } catch {
            Alert.alert("Couldn't delete", "Check your connection and try again.");
          }
        },
      },
    ]);
  };

  /** Unsend your own message, after a confirmation; it goes at once and comes back if that fails. */
  const unsend = (message: Message) => {
    Alert.alert("Unsend message?", "It will be removed for everyone in this chat.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Unsend",
        style: "destructive",
        onPress: async () => {
          const token = tokenRef.current;
          if (!token) return;
          setMessages((current) => current?.filter((m) => m.id !== message.id) ?? current);
          try {
            await unsendMessage(conversationId, message.id, token);
          } catch {
            setMessages((current) => (current ? mergeMessages(current, [message]) : current));
            Alert.alert("Couldn't unsend", "Check your connection and try again.");
          }
        },
      },
    ]);
  };

  // The rows' handlers never change identity; they act on the screen's latest state.
  /** Brings a quoted message into view, if it's among the messages loaded so far. */
  const scrollToMessage = (messageId: string) => {
    const index = rowsRef.current.findIndex((r) => r.kind === "sent" && r.id === messageId);
    if (index >= 0) listRef.current?.scrollToIndex({ index, viewPosition: 0.5, animated: true });
  };
  const latest = useRef({ userId, getToken, onOpenSharedStory, setReaction, scrollToMessage });
  latest.current = { userId, getToken, onOpenSharedStory, setReaction, scrollToMessage };
  const actions = useMemo((): RowActions => ({
    onPendingMediaPress: (row) => {
      const owner = latest.current.userId;
      if (row.status !== "failed" || !owner) return;
      Alert.alert("Not sent", row.error ?? undefined, [
        { text: "Try again", onPress: () => void retryMedia(owner, row.clientMessageId, latest.current.getToken) },
        { text: "Delete", style: "destructive", onPress: () => void discardMedia(owner, row.clientMessageId) },
        { text: "Cancel", style: "cancel" },
      ]);
    },
    onPendingPress: (row) => {
      const owner = latest.current.userId;
      if (!owner || row.status === "sending") return;
      Alert.alert(row.status === "failed" ? "Message not sent" : "Message waiting to send", row.error ?? undefined, [
        { text: "Try again", onPress: () => void retryMessage(owner, row.clientMessageId, latest.current.getToken) },
        { text: "Delete", style: "destructive", onPress: () => void discardMessage(owner, row.clientMessageId) },
        { text: "Cancel", style: "cancel" },
      ]);
    },
    // Long-press any stored message to react to it (and, on the other person's, to report it:
    // the DM safety workflow). Screen reader users get the same choices as actions on the message.
    onLongPress: (row) => {
      if (row.kind !== "sent") return;
      tapFeedback("tap");
      setReactingTo(row);
    },
    onReactionsPress: (row) => {
      const mineReaction = row.reactions?.find((r) => r.userId === latest.current.userId);
      if (mineReaction) void latest.current.setReaction(row.id, null);
      else setReactingTo(row);
    },
    onReport: (messageId) => setReportingMessageId(messageId),
    onReply: (row) => {
      setReactingTo(null);
      setReplyingTo(row);
    },
    onDoubleTap: (row) => {
      const mine = row.reactions?.find((r) => r.userId === latest.current.userId)?.emoji;
      void latest.current.setReaction(row.id, mine === DOUBLE_TAP_REACTION ? null : DOUBLE_TAP_REACTION);
    },
    onQuotePress: (messageId) => latest.current.scrollToMessage(messageId),
    onOpenStory: (storyId) => void latest.current.onOpenSharedStory(storyId),
    onView: (item) => setViewing(item),
    onPlay: (key) => setPlayingKey(key),
    onStop: (key) => setPlayingKey((k) => (k === key ? null : k)),
  }), []);

  const rows = useMemo((): ListRow[] => {
    const stored = messages ?? [];
    // An outbox entry the server already stored (seen via realtime before the send
    // response came back) is shown once, as the stored message.
    const storedIds = new Set(stored.flatMap((m) => (m.clientMessageId ? [m.clientMessageId] : [])));
    // Something on its way shows the quote of what it replies to, from the thread.
    const quoted = (id: string | undefined) => {
      const target = id ? stored.find((m) => m.id === id) : undefined;
      return target ? quoteOf(target) : null;
    };
    const pending = outbox.filter((m) => !storedIds.has(m.clientMessageId)).reverse().map((m) => rowOf(m, (s) => ({ ...s, kind: "pending" as const, replyTo: quoted(s.replyToMessageId) })));
    const media = pendingMedia.filter((m) => !storedIds.has(m.clientMessageId)).reverse().map((m) => rowOf(m, (s) => ({ ...s, kind: "media" as const, replyTo: quoted(s.replyToMessageId) })));
    return [...media, ...pending, ...stored.map((m) => rowOf(m, (s) => ({ ...s, kind: "sent" as const })))];
  }, [outbox, messages, pendingMedia]);
  const rowsRef = useRef<ListRow[]>([]);
  rowsRef.current = rows;
  const onScrollToIndexFailed = useCallback((info: { index: number; averageItemLength: number }) => {
    // Not measured yet: get close, then try again once it is.
    listRef.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: false });
    setTimeout(() => listRef.current?.scrollToIndex({ index: info.index, viewPosition: 0.5, animated: true }), 120);
  }, []);
  const replyPreview = useMemo(() => {
    if (!replyingTo) return null;
    const name = nameOf(replyingTo.senderId);
    return { author: replyingTo.senderId === userId ? "yourself" : name ? `@${name}` : "them", snippet: quoteSnippet(quoteOf(replyingTo)) };
  }, [nameOf, replyingTo, userId]);

  // A status caption only ever makes sense under the single most recent
  // message *you* sent — same convention as iMessage/WhatsApp. If the
  // newest row in the thread is pending, that's it; if it's a confirmed
  // message but from the other person (they replied after your last
  // message), nothing shows at all. Failed messages always show theirs.
  const statusRowKey = useMemo(() => {
    const first = rows[0];
    if (!first) return null;
    if (first.kind !== "sent") return first.clientMessageId;
    return first.senderId === userId ? first.id : null;
  }, [rows, userId]);

  const renderItem = useCallback<ListRenderItem<ListRow>>(({ item, index }) => {
    const key = rowKey(item);
    // In a group, the sender's name above the first (oldest) of their messages in a run.
    let senderLabel: string | undefined;
    if (isGroup && item.kind === "sent" && item.senderId !== userId && !item.event) {
      const older = rows[index + 1];
      if (!older || older.kind !== "sent" || older.senderId !== item.senderId || older.event) {
        const member = members.get(item.senderId);
        senderLabel = member ? member.displayName : "Someone";
      }
    }
    return (
      <MessageRow
        row={item}
        userId={userId}
        nameOf={nameOf}
        senderLabel={senderLabel}
        accessToken={accessToken}
        showStatus={key === statusRowKey}
        playing={playingKey === key}
        maxMediaSide={maxMediaSide}
        actions={actions}
      />
    );
  }, [accessToken, actions, isGroup, maxMediaSide, members, nameOf, playingKey, rows, statusRowKey, userId]);

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
          <View style={StyleSheet.absoluteFill}>
            <ThreadSkeleton />
          </View>
        )}
      </View>
    );
  }

  return (
    <KeyboardAvoider style={styles.container} topOffset={headerHeight}>
      <FlatList
        ref={listRef}
        onScrollToIndexFailed={onScrollToIndexFailed}
        style={styles.list}
        contentContainerStyle={styles.listContent}
        data={rows}
        inverted
        keyExtractor={rowKey}
        onEndReachedThreshold={0.4}
        onEndReached={onEndReached}
        renderItem={renderItem}
        initialNumToRender={12}
        maxToRenderPerBatch={8}
        windowSize={7}
        ListFooterComponent={loadingMore ? <ActivityIndicator color={colors.accent} style={styles.footerSpinner} /> : undefined}
      />
      {/* Outside the inverted list: Android flips an inverted list on both axes, which mirrored this text. */}
      {rows.length === 0 ? (
        <View style={styles.emptyState} pointerEvents="none">
          <Text style={typography.body}>{otherUsername && !isGroup ? `Say hi to @${otherUsername}` : "Say hi to the group"}</Text>
        </View>
      ) : null}
      {otherTyping ? (
        <View style={styles.typingRow} accessibilityLiveRegion="polite">
          <View style={styles.typingBubble}>
            <Text style={styles.typingText}>{typingUserId && nameOf(typingUserId) ? `@${nameOf(typingUserId)} is typing…` : "Typing…"}</Text>
          </View>
        </View>
      ) : null}
      <Modal visible={viewing !== null} animationType="fade" transparent={false} statusBarTranslucent navigationBarTranslucent onRequestClose={() => setViewing(null)}>
        <View style={styles.viewer}>
          {viewing?.kind === "video" && viewing.id ? (
            <Video
              source={{ uri: mediaFileUrl(viewing.id, "video_720"), headers: authHeaders(accessToken) }}
              style={StyleSheet.absoluteFill}
              resizeMode="contain"
              controls
              repeat
            />
          ) : viewing?.id ? (
            <Image source={{ uri: mediaFileUrl(viewing.id, "display"), headers: authHeaders(accessToken) }} style={StyleSheet.absoluteFill} resizeMode="contain" />
          ) : null}
          <Pressable style={[styles.viewerClose, { top: insetsTop + spacing.sm }]} onPress={() => setViewing(null)} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close">
            <Icon name={ICONS.close} size={24} color="#FFFFFF" />
          </Pressable>
        </View>
      </Modal>
      <Modal visible={reactingTo !== null} transparent animationType="fade" statusBarTranslucent onRequestClose={() => setReactingTo(null)}>
        <Pressable style={styles.reactBackdrop} onPress={() => setReactingTo(null)} accessibilityRole="button" accessibilityLabel="Close">
          <View style={styles.reactCard}>
            <View style={styles.reactBar} accessibilityRole="menu">
              {MESSAGE_REACTIONS.map((emoji) => {
                const chosen = reactingTo?.reactions?.some((r) => r.userId === userId && r.emoji === emoji) ?? false;
                return (
                  <Pressable
                    key={emoji}
                    onPress={() => {
                      const target = reactingTo;
                      setReactingTo(null);
                      if (target) void setReaction(target.id, chosen ? null : emoji);
                    }}
                    style={({ pressed }) => [styles.reactKey, chosen && styles.reactKeyChosen, pressed && styles.reactKeyPressed]}
                    accessibilityRole="menuitem"
                    accessibilityState={{ selected: chosen }}
                    accessibilityLabel={chosen ? `Remove ${emoji}` : `React ${emoji}`}
                  >
                    <Text style={styles.reactGlyph}>{emoji}</Text>
                  </Pressable>
                );
              })}
            </View>
            {/* One short list under the reactions, like Instagram: Reply, Copy, then Unsend or Report. */}
            <View style={styles.menuCard}>
              <Pressable style={styles.menuRow} onPress={() => { if (reactingTo) actions.onReply(reactingTo); }} accessibilityRole="button" accessibilityLabel="Reply">
                <Text style={styles.menuText}>Reply</Text>
                <Icon name={ICONS.reply} size={18} color={colors.textPrimary} />
              </Pressable>
              {reactingTo?.body ? (
                <Pressable
                  style={styles.menuRow}
                  onPress={() => {
                    Clipboard.setString(reactingTo.body ?? "");
                    setReactingTo(null);
                    showToast("Copied");
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Copy"
                >
                  <Text style={styles.menuText}>Copy</Text>
                  <Icon name={ICONS.copy} size={18} color={colors.textPrimary} />
                </Pressable>
              ) : null}
              {reactingTo && reactingTo.senderId === userId ? (
                <Pressable
                  style={styles.menuRow}
                  onPress={() => {
                    const target = reactingTo;
                    setReactingTo(null);
                    unsend(target);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Unsend"
                >
                  <Text style={styles.menuDanger}>Unsend</Text>
                  <Icon name={ICONS.trash} size={18} color={colors.danger} />
                </Pressable>
              ) : reactingTo ? (
                <Pressable
                  style={styles.menuRow}
                  onPress={() => {
                    const id = reactingTo.id;
                    setReactingTo(null);
                    setReportingMessageId(id);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Report message"
                >
                  <Text style={styles.menuDanger}>Report</Text>
                  <Icon name={ICONS.report} size={18} color={colors.danger} />
                </Pressable>
              ) : null}
            </View>
          </View>
        </Pressable>
      </Modal>
      <ActionSheet
        visible={chatMenuOpen}
        onClose={() => setChatMenuOpen(false)}
        groups={[
          [
            { label: muted ? "Unmute notifications" : "Mute notifications", onPress: () => void toggleMute() },
            ...(otherUsername ? [{ label: "View profile", onPress: openProfile }] : []),
          ],
          [
            ...(otherUsername ? [{ label: `Block @${otherUsername}`, destructive: true, onPress: blockOther }] : []),
            { label: "Delete chat", destructive: true, onPress: deleteChat },
          ],
        ]}
      />
      <CapturePreview capture={capture} onCancel={onCancelCapture} onSend={onSendCapture} />
      <ReportSheet
        visible={reportingMessageId !== null}
        targetType="message"
        targetId={reportingMessageId ?? ""}
        conversationId={conversationId}
        onClose={() => setReportingMessageId(null)}
      />
      <Composer
        onSendText={onSendText}
        onVoiceNote={onVoiceNote}
        onStartRecording={onStartRecording}
        onTakePhoto={onTakePhotoPress}
        onPickFromGallery={onPickFromGalleryPress}
        onTyping={onTyping}
        replyingTo={replyPreview}
        onCancelReply={onCancelReply}
      />
    </KeyboardAvoider>
  );
}

const styles = StyleSheet.create({
  recordingRow: { alignItems: "center" },
  recordCancel: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  recordDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.danger },
  recordTime: { color: colors.textPrimary, fontSize: 16, fontWeight: "600", fontVariant: ["tabular-nums"] },
  recordHint: { flex: 1, color: colors.textSecondary, fontSize: 14 },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.sm, maxWidth: 260 },
  headerMore: { paddingHorizontal: spacing.xs, minHeight: 44, justifyContent: "center" },
  headerNames: { flexShrink: 1 },
  headerName: { color: colors.textPrimary, fontSize: 16, fontWeight: "700" },
  headerUsername: { color: colors.textSecondary, fontSize: 12 },
  mediaBubble: { borderRadius: radii.lg, overflow: "hidden", backgroundColor: colors.surfaceElevated },
  mediaFailed: { borderWidth: 2, borderColor: colors.danger },
  mediaCaption: { marginTop: 4 },
  mediaSending: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.35)", alignItems: "center", justifyContent: "center" },
  playBadge: { position: "absolute", top: "50%", left: "50%", width: 48, height: 48, marginLeft: -24, marginTop: -24, borderRadius: 24, backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center" },
  videoPlaceholder: { backgroundColor: "#111111" },
  // Every composer button: one 40pt round shape.
  roundButton: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceElevated },
  sendRound: { backgroundColor: colors.accent },
  cameraButton: { backgroundColor: colors.accent },
  viewer: { flex: 1, backgroundColor: "#000000" },
  viewerClose: { position: "absolute", left: spacing.md, width: 44, height: 44, borderRadius: 22, backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center" },
  reactionPill: { flexDirection: "row", alignItems: "center", gap: 2, marginTop: -6, paddingHorizontal: 6, paddingVertical: 1, borderRadius: radii.pill, backgroundColor: colors.surfaceElevated, borderWidth: 2, borderColor: colors.background },
  reactionPillMine: { marginRight: spacing.sm },
  reactionPillTheirs: { marginLeft: spacing.sm },
  reactionPillPressed: { opacity: 0.7 },
  reactionPillText: { fontSize: 13, color: colors.textPrimary },
  reactBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", alignItems: "center", justifyContent: "center", padding: spacing.lg },
  reactCard: { alignItems: "center", gap: spacing.sm },
  reactBar: { flexDirection: "row", gap: spacing.xs, padding: spacing.xs, borderRadius: radii.pill, backgroundColor: colors.surfaceElevated },
  reactKey: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center" },
  reactKeyChosen: { backgroundColor: colors.border },
  reactKeyPressed: { transform: [{ scale: 1.2 }] },
  reactGlyph: { fontSize: 28 },
  storyCard: { width: 150, gap: spacing.xs, paddingVertical: 2 },
  storyCardImage: { width: 150, height: 220, borderRadius: radii.sm, backgroundColor: colors.surface },
  storyCardGone: { alignItems: "center", justifyContent: "center", borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  storyCardGoneText: { color: colors.textSecondary, fontSize: 13 },
  storyCardOwner: { fontSize: 13, fontWeight: "600" },
  menuCard: { alignSelf: "stretch", maxWidth: 320, width: "100%", marginHorizontal: "auto", borderRadius: radii.md, backgroundColor: colors.surfaceElevated, overflow: "hidden" },
  menuRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 48, paddingHorizontal: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  menuText: { color: colors.textPrimary, fontSize: 16 },
  menuDanger: { color: colors.danger, fontSize: 16 },
  eventLine: { alignSelf: "center", textAlign: "center", color: colors.textSecondary, fontSize: 12, marginVertical: spacing.sm, paddingHorizontal: spacing.lg },
  senderLabel: { color: colors.textSecondary, fontSize: 12, fontWeight: "600", marginBottom: 2, marginLeft: spacing.xs },
  heartPop: { position: "absolute", top: -12, bottom: -12, left: -12, right: -12, alignItems: "center", justifyContent: "center" },
  swipeArrow: { position: "absolute", left: 0, top: 0, bottom: 0, width: 32, alignItems: "center", justifyContent: "center" },
  quote: { maxWidth: "100%", marginBottom: -4, paddingHorizontal: spacing.sm, paddingTop: spacing.xs, paddingBottom: spacing.xs + 4, borderRadius: radii.md, backgroundColor: colors.surface, borderLeftWidth: 3, borderLeftColor: colors.border, opacity: 0.9 },
  quoteMine: { alignSelf: "flex-end" },
  quoteTheirs: { alignSelf: "flex-start" },
  quoteAuthor: { color: colors.textSecondary, fontSize: 12, fontWeight: "700" },
  quoteText: { color: colors.textSecondary, fontSize: 13 },
  replyBar: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, backgroundColor: colors.surface },
  replyBarText: { flex: 1 },
  replyBarTitle: { color: colors.textPrimary, fontSize: 13, fontWeight: "600" },
  replyBarSnippet: { color: colors.textSecondary, fontSize: 13 },
  replyBarClose: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  typingRow: { flexDirection: "row", paddingHorizontal: spacing.md, paddingBottom: spacing.xs },
  typingBubble: { borderRadius: radii.md, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, backgroundColor: colors.surfaceElevated },
  typingText: { color: colors.textSecondary, fontSize: 13, fontStyle: "italic" },
  replyLabel: { fontSize: 12, opacity: 0.75, marginBottom: 2 },
  reactionGlyph: { fontSize: 34, lineHeight: 42 },
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
  emptyState: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center" },
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
});
