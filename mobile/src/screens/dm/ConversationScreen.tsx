import { Icon } from "../../components/Icon";
import { ThreadSkeleton } from "../../components/Skeleton";
import { storyReplyLabel } from "../../models/storyReplies";
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Animated, AppState, FlatList, Image, Keyboard, Linking, Modal, PanResponder, PermissionsAndroid, Platform, StyleSheet, Text, TextInput, useWindowDimensions, View, type ListRenderItem } from "react-native";
import { Pressable } from "../../components/Pressable";
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
  listPins,
  pinMessage,
  unpinMessage,
  messagePreview,
  MAX_PINS,
  type PinnedMessage,
  type Message,
  type MessageReaction,
  type QuotedMessage,
  type GroupDetails,
} from "../../api/conversations";
import { ApiError } from "../../api/client";
import { getStoryOwnerUsername } from "../../api/stories";
import { ReportSheet } from "../../components/ReportSheet";
import { KeyboardAvoider } from "../../components/KeyboardAvoider";
import { applyReaction, applyReceipt, mergeMessages, newestId, oldestId, QUOTE_LENGTH, truncateText } from "./threadState";
import { tapFeedback } from "../../utils/haptics";
import { launchCamera, launchImageLibrary, type Asset, type ImagePickerResponse } from "react-native-image-picker";
import Video from "react-native-video";
import { Avatar } from "../../components/Avatar";
import { VerifiedName } from "../../components/VerifiedBadge";
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
import { callLineText, isMissedCall } from "../../models/callLines";
import { useCallsIfAvailable } from "../../calls/CallContext";
import { t } from "../../i18n";

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
  return { id: message.id, senderId: message.senderId, body: message.body ? truncateText(message.body, QUOTE_LENGTH) : null, mediaKind: message.media?.kind ?? null, sharedStory: !!message.sharedStoryId };
}

/** What a quote shows of the message: its text, or what kind of message it was. */
export function quoteSnippet(quote: QuotedMessage): string {
  if (quote.body) return quote.body;
  if (quote.mediaKind === "photo") return t("common.photo");
  if (quote.mediaKind === "video") return t("common.video");
  if (quote.mediaKind === "audio") return t("common.voiceMessage");
  return quote.sharedStory ? t("conversation.sharedAStory") : t("common.message");
}

function statusLabel(row: ListRow, nameOf?: RowProps["nameOf"]): string {
  if (row.kind === "media") return row.status === "failed" ? `${row.error ?? "Not sent"} · Tap to retry` : t("conversation.sending");
  if (row.kind === "pending") {
    if (row.status === "failed") return `${row.error ?? "Not sent"} · Tap to retry`;
    return row.status === "waiting" && row.attempts > 0 ? t("conversation.waitingForConnection") : t("conversation.sending");
  }
  // A group: Seen once everyone has read it; until then, who has.
  if (row.seenBy) {
    if (row.status === "read") return t("conversation.seenByEveryone");
    const names = row.seenBy.map((id) => nameOf?.(id)).filter((n): n is string => !!n).map((n) => `@${n}`);
    if (names.length) return `Seen by ${names.length <= 2 ? names.join(" and ") : `${names.slice(0, 2).join(", ")} and ${names.length - 2} more`}`;
  }
  switch (row.status) {
    case "read":
      return t("conversation.seen");
    case "delivered":
      return t("conversation.delivered");
    default:
      return t("common.sent");
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
  /** A tap on a call's line calls back the same way (voice or video). */
  onCallBack: (media: "audio" | "video") => void;
}

interface RowProps {
  row: ListRow;
  userId: string | undefined;
  /** "username" for a person in this conversation (undefined if not known: they left). */
  nameOf: (userId: string) => string | undefined;
  /** How a person is named in a quote: their name ("Meera"), else "@username" (undefined if not known). */
  labelOf: (userId: string) => string | undefined;
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
function Quote({ quote, userId, labelOf, mine, onPress }: { quote: QuotedMessage; userId: string | undefined; labelOf: RowProps["labelOf"]; mine: boolean; onPress: (id: string) => void }): React.JSX.Element {
  const author = quote.senderId === userId ? t("common.you") : labelOf(quote.senderId) ?? t("conversation.them");
  const snippet = quoteSnippet(quote);
  return (
    <Pressable
      onPress={() => onPress(quote.id)}
      style={[styles.quote, mine ? styles.quoteMine : styles.quoteTheirs]}
      accessibilityRole="button"
      accessibilityLabel={`Replying to ${author === "You" ? "you" : author}: ${snippet}`}
      accessibilityHint={t("conversation.showsThatMessage")}
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

function MessageContent({ row, userId, nameOf, labelOf, senderLabel, accessToken, showStatus, playing, maxMediaSide, actions }: RowProps): React.JSX.Element {
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
  // A call's line ("Missed voice call", "Video call · 4:12"), centred; a tap calls back.
  if (row.kind === "sent" && row.event?.type === "call") {
    const mine = row.senderId === userId;
    const text = callLineText(row.event, mine);
    const missed = isMissedCall(row.event, mine);
    const media = row.event.media;
    return (
      <Pressable
        onPress={() => actions.onCallBack(media)}
        style={styles.callLine}
        accessibilityRole="button"
        accessibilityLabel={text}
        accessibilityHint={media === "video" ? "Starts a video call" : "Starts a voice call"}
      >
        <Icon name={media === "video" ? ICONS.video : ICONS.call} size={14} color={missed ? colors.danger : colors.textSecondary} />
        <Text style={[styles.callLineText, missed && styles.callLineMissed]}>{text}</Text>
      </Pressable>
    );
  }
  // A group's "what happened" line, centred, not a bubble.
  if (row.kind === "sent" && row.event) {
    const text = groupEventText(row.event, actorName(row.senderId, userId, nameOf(row.senderId)), (id) => (id === userId ? "you" : nameOf(id) ? `@${nameOf(id)}` : "someone"));
    return <Text style={styles.eventLine} accessibilityRole="text">{text}</Text>;
  }
  const quote = row.replyTo ? (
    <Quote quote={row.replyTo} userId={userId} labelOf={labelOf} mine={row.kind !== "sent" || row.senderId === userId} onPress={actions.onQuotePress} />
  ) : null;
  // Sent on from another chat: a quiet line above the bubble, naming nobody.
  const forwarded = row.kind === "sent" && row.forwarded ? (
    <View style={styles.forwardedLabel}>
      <Icon name={ICONS.forward} size={12} color={colors.textSecondary} />
      <Text style={styles.forwardedText}>{t("conversation.forwarded")}</Text>
    </View>
  ) : null;
  if (row.kind === "media" || (row.kind === "sent" && row.media)) {
    const mineMedia = row.kind === "media" || row.senderId === userId;
    const kind = row.kind === "media" ? row.mediaKind : row.media!.kind;
    const failedMedia = row.kind === "media" && row.status === "failed";
    const who = mineMedia ? t("common.you") : otherUsername ? `@${otherUsername}` : t("conversation.them");
    if (kind === "audio") {
      const key = rowKey(row);
      return (
        <View style={[styles.bubbleRow, mineMedia ? styles.bubbleRowMine : styles.bubbleRowTheirs]}>
          <View style={[styles.bubbleColumn, mineMedia ? styles.bubbleColumnMine : styles.bubbleColumnTheirs]}>
            {senderLabel ? <Text style={styles.senderLabel} numberOfLines={1}>{senderLabel}</Text> : null}
            {quote}
            {forwarded}
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
          {forwarded}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${who}: ${forwarded ? "Forwarded " : ""}${kind === "video" ? "Video" : "Photo"}`}
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
    ? (row.sharedStoryId ? (row.sharedStory ? `@${row.sharedStory.ownerUsername}'s Story${row.sharedStory.active ? "" : ", no longer available"}` : t("conversation.sharedAStory")) : replyLabel)
    : row.storyId ? t("conversation.sharedAStory") : null;
  // Bubbles show who sent what by their side of the screen; a screen reader says it.
  const spoken = [forwarded ? t("conversation.forwarded") : null, shared, row.body].filter(Boolean).join(". ");
  return (
    <View style={[styles.bubbleRow, mine ? styles.bubbleRowMine : styles.bubbleRowTheirs]}>
      <View style={[styles.bubbleColumn, mine ? styles.bubbleColumnMine : styles.bubbleColumnTheirs]}>
        {senderLabel ? <Text style={styles.senderLabel} numberOfLines={1}>{senderLabel}</Text> : null}
        {quote}
        {forwarded}
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
          accessibilityActions={row.kind === "sent" ? [{ name: "reply", label: t("common.reply") }, { name: "react", label: t("conversation.react") }, ...(canReport ? [{ name: "report", label: t("conversation.reportMessage") }] : [])] : undefined}
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
                  <Text style={styles.storyCardGoneText}>{row.sharedStory && !row.sharedStory.active ? t("common.storyUnavailable") : t("common.story")}</Text>
                </View>
              )}
              <Text style={[styles.storyCardOwner, mine ? styles.bubbleTextMine : styles.bubbleTextTheirs]} numberOfLines={1}>
                {row.sharedStory ? t("conversation.ownerusernameSStory", { ownerUsername: row.sharedStory.ownerUsername }) : t("conversation.sharedAStory")}
              </Text>
            </View>
          ) : null}
          {row.kind === "pending" && row.storyId ? (
            <Text style={styles.bubbleTextMine}>{t("conversation.sharedAStory")}</Text>
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
      setComposerError(error instanceof Error ? error.message : t("conversation.couldntSendThatMessage"));
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
            <Text style={styles.replyBarTitle} numberOfLines={1}>{t("conversation.replyingToAuthor", { author: replyingTo.author })}</Text>
            <Text style={styles.replyBarSnippet} numberOfLines={1}>{replyingTo.snippet}</Text>
          </View>
          <Pressable onPress={onCancelReply} hitSlop={10} style={styles.replyBarClose} accessibilityRole="button" accessibilityLabel={t("conversation.cancelReply")}>
            <Icon name={ICONS.close} size={18} color={colors.textSecondary} />
          </Pressable>
        </View>
      ) : null}
      {recording ? (
        <View style={[styles.composerRow, styles.recordingRow, padBottom]}>
          <Pressable onPress={() => void recorder.cancel()} hitSlop={8} style={styles.recordCancel} accessibilityRole="button" accessibilityLabel={t("conversation.deleteVoiceMessage")}>
            <Icon name={ICONS.trash} size={22} color={colors.danger} />
          </Pressable>
          <View style={styles.recordDot} />
          <Text style={styles.recordTime} accessibilityLiveRegion="polite">
            {recorder.state.status === "recording" ? formatClock(recorder.state.elapsedMs) : "0:00"}
          </Text>
          <Text style={styles.recordHint} numberOfLines={1}>{t("conversation.recording")}</Text>
          <Pressable
            style={[styles.roundButton, styles.sendRound]}
            onPress={() => void recorder.send()}
            disabled={recorder.state.status !== "recording"}
            accessibilityRole="button"
            accessibilityLabel={t("conversation.sendVoiceMessage")}
          >
            <Icon name={ICONS.send} size={20} color={colors.onAccent} />
          </Pressable>
        </View>
      ) : (
        <View style={[styles.composerRow, padBottom]}>
          {/* Camera always; the gallery steps aside while you type (emoji come from the keyboard). */}
          <Pressable style={[styles.roundButton, styles.cameraButton]} onPress={onTakePhoto} hitSlop={4} accessibilityRole="button" accessibilityLabel={t("conversation.takeAPhotoOrVideo")}>
            <Icon name={ICONS.camera} size={20} color={colors.onAccent} />
          </Pressable>
          {draft.trim() ? null : (
            <Pressable style={styles.roundButton} onPress={onPickFromGallery} hitSlop={4} accessibilityRole="button" accessibilityLabel={t("conversation.sendAPhotoOrVideo")}>
              <Icon name={ICONS.gallery} size={22} color={colors.textPrimary} />
            </Pressable>
          )}
          <TextInput
            ref={inputRef}
            style={styles.composerInput}
            accessibilityLabel={t("common.message")}
            placeholder={t("conversation.message")}
            placeholderTextColor={colors.textDisabled}
            value={draft}
            onChangeText={onChangeDraft}
            maxLength={MAX_MESSAGE_LENGTH}
            multiline
          />
          {draft.trim() ? (
            <Pressable style={[styles.roundButton, styles.sendRound]} onPress={() => void onSend()} accessibilityRole="button" accessibilityLabel={t("common.send")}>
              <Icon name={ICONS.send} size={20} color={colors.onAccent} />
            </Pressable>
          ) : (
            // Nothing typed: the microphone, like Instagram and WhatsApp. Tap to record.
            <Pressable style={styles.roundButton} onPress={onMic} accessibilityRole="button" accessibilityLabel={t("conversation.recordAVoiceMessage")}>
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
    what === "camera" ? t("common.allowCameraAccess") : t("common.allowPhotoAccess"),
    what === "camera"
      ? t("conversation.toTakeAPhotoOr")
      : t("conversation.toSendPhotosAndVideos"),
    [
      { text: t("common.notNow"), style: "cancel" },
      { text: t("common.openSettings"), onPress: () => void Linking.openSettings().catch(() => undefined) },
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
  const { conversationId, otherUsername, otherDisplayName, otherAvatarMediaId, otherVerified, group: isGroupParam, title: groupTitleParam } = route.params;
  const { top: insetsTop, bottom: insetsBottom } = useSafeAreaInsets();
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
  /** Voice and video calls work here (the server says so: calls on, no block, their account active). */
  const [callsAvailable, setCallsAvailable] = useState(false);
  const calls = useCallsIfAvailable();
  const otherIdRef = useRef<string | null>(null);
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
  /** The chat's pinned messages, latest first (the bar under the header), and the list of them. */
  const [pins, setPins] = useState<PinnedMessage[]>([]);
  const pinsRef = useRef<PinnedMessage[]>([]);
  pinsRef.current = pins;
  const [pinsOpen, setPinsOpen] = useState(false);
  // The last pin unpinned closes the list (and a later pin doesn't open it again).
  useEffect(() => { if (!pins.length) setPinsOpen(false); }, [pins.length]);
  /** Forward opens a screen over the chat, so on iOS it waits for the message menu to finish closing. */
  const afterMenu = useRef<(() => void) | null>(null);
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
        setCallsAvailable(!!conversation.callsAvailable);
        otherIdRef.current = conversation.otherUser.id;
        navigation.setParams({
          otherUsername: conversation.otherUser.username,
          otherDisplayName: conversation.otherUser.displayName,
          otherAvatarMediaId: conversation.otherUser.avatarMediaId ?? null,
          otherVerified: !!conversation.otherUser.verified,
        });
      }
    } catch (error: unknown) {
      if (error instanceof ApiError && error.status === 404) setLoadError(isGroupParam ? t("conversation.youreNoLongerInThis") : t("conversation.thisConversationIsntAvailable"));
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
  const labelOf = useCallback((id: string): string | undefined => {
    const display = members.get(id)?.displayName ?? (!isGroup && id !== userId ? otherDisplayName : undefined);
    if (display?.trim()) return display;
    const username = nameOf(id);
    return username ? `@${username}` : undefined;
  }, [isGroup, members, nameOf, otherDisplayName, userId]);

  // Calls: from a 1:1 chat with someone the server says can be called, in a build that can call.
  const canCall = !isGroup && callsAvailable && !!calls?.supported && !!otherUsername;
  const placeCall = useCallback((media: "audio" | "video") => {
    if (!calls || !otherUsername || !canCall) return;
    calls.startCall(conversationId, media, {
      id: otherIdRef.current ?? "",
      username: otherUsername,
      displayName: otherDisplayName ?? otherUsername,
      avatarMediaId: otherAvatarMediaId ?? null,
      verified: !!otherVerified,
    });
  }, [calls, canCall, conversationId, otherAvatarMediaId, otherDisplayName, otherUsername, otherVerified]);
  const placeCallRef = useRef(placeCall);
  placeCallRef.current = placeCall;

  // The header: who you're talking to, with their photo; a tap opens their profile. `initial: false`
  // keeps the Search tab's own first screen under it (a first visit creates that stack).
  const openProfile = useCallback(() => {
    if (otherUsername) rootNavigation.navigate("Main", { screen: "Search", params: { screen: "UserProfile", params: { username: otherUsername }, initial: false } });
  }, [otherUsername, rootNavigation]);
  useEffect(() => {
    if (isGroup) {
      const others = (group?.members ?? []).filter((m) => m.userId !== userId);
      const title = group ? groupName(group.title, others, others.length) : groupTitleParam ?? t("common.group");
      navigation.setOptions({
        headerTitle: () => (
          <Pressable
            onPress={() => navigation.navigate("GroupInfo", { conversationId })}
            style={styles.header}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel={`${title}${group ? `, ${group.members.length} people` : ""}`}
            accessibilityHint={t("conversation.showsTheGroupsPeopleAnd")}
          >
            <GroupAvatar members={others} size={34} />
            <View style={styles.headerNames}>
              <Text style={styles.headerName} numberOfLines={1}>{title}</Text>
              {group ? <Text style={styles.headerUsername} numberOfLines={1}>{t("conversation.lengthPeople", { length: group.members.length })}</Text> : null}
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
          accessibilityLabel={otherUsername ? `${otherDisplayName ?? otherUsername}${otherVerified ? ", verified" : ""}, @${otherUsername}` : "Conversation"}
          accessibilityHint={t("conversation.opensTheirProfile")}
        >
          {otherUsername ? <Avatar username={otherUsername} displayName={otherDisplayName ?? otherUsername} avatarMediaId={otherAvatarMediaId ?? null} size={34} /> : null}
          <View style={styles.headerNames}>
            <VerifiedName name={otherDisplayName ?? otherUsername ?? ""} verified={otherVerified} style={styles.headerName} />
            {otherUsername ? <Text style={styles.headerUsername} numberOfLines={1}>@{otherUsername}</Text> : null}
          </View>
        </Pressable>
      ),
      headerRight: () => (
        <View style={styles.headerActions}>
          {canCall ? (
            <>
              <Pressable onPress={() => placeCall("audio")} hitSlop={6} style={styles.headerMore} accessibilityRole="button" accessibilityLabel={`Voice call ${otherDisplayName || `@${otherUsername}`}`}>
                <Icon name={ICONS.call} size={22} color={colors.textPrimary} />
              </Pressable>
              <Pressable onPress={() => placeCall("video")} hitSlop={6} style={styles.headerMore} accessibilityRole="button" accessibilityLabel={`Video call ${otherDisplayName || `@${otherUsername}`}`}>
                <Icon name={ICONS.video} size={24} color={colors.textPrimary} />
              </Pressable>
            </>
          ) : null}
          <Pressable onPress={() => setChatMenuOpen(true)} hitSlop={10} style={styles.headerMore} accessibilityRole="button" accessibilityLabel={t("conversation.chatOptions")}>
            <Icon name={ICONS.more} size={22} color={colors.textPrimary} />
          </Pressable>
        </View>
      ),
    });
  }, [canCall, conversationId, group, groupTitleParam, isGroup, navigation, openProfile, otherAvatarMediaId, otherDisplayName, otherUsername, otherVerified, placeCall, userId]);

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
        setLoadError(error instanceof ApiError && error.status === 404 ? t("conversation.thisConversationIsntAvailable") : t("conversation.couldntLoadMessagesCheckYour"));
      }
    }
  }, [conversationId, markRead, userId]);

  const catchingUp = useRef<Promise<Set<string> | null> | null>(null);
  /**
   * Fetches everything newer than what the thread has, page by page. Resolves with the ids it
   * found that way (null when it loaded the latest page instead, or couldn't load anything).
   */
  const catchUp = useCallback(async (): Promise<Set<string> | null> => {
    if (catchingUp.current) return catchingUp.current;
    const work = (async (): Promise<Set<string> | null> => {
      const token = tokenRef.current;
      const known = messagesRef.current;
      const after = known ? newestId(known) : null;
      if (!token || !after) {
        await loadLatest();
        return null;
      }
      try {
        let cursor = after;
        let receivedFromOther = false;
        const found = new Set<string>();
        for (let page = 0; page < MAX_CATCH_UP_PAGES; page++) {
          const result = await listMessages(conversationId, token, { after: cursor, limit: PAGE_SIZE });
          if (result.messages.length) {
            setMessages((current) => mergeMessages(current ?? [], result.messages));
            receivedFromOther ||= result.messages.some((m) => m.senderId !== userId);
            result.messages.forEach((m) => found.add(m.id));
            cursor = result.messages[0]!.id;
          }
          if (!result.hasMore) {
            if (receivedFromOther) markRead();
            return found;
          }
        }
        await loadLatest(true); // a very long gap: start again from the latest page
      } catch (error) {
        // Taken out of a group (or the chat is gone): say so. Offline: the next event, resync or poll tries again.
        if (error instanceof ApiError && error.status === 404) {
          setMessages(null);
          setLoadError(isGroupParam ? t("conversation.youreNoLongerInThis") : t("conversation.thisConversationIsntAvailable"));
        }
      }
      return null;
    })();
    catchingUp.current = work;
    try { return await work; } finally { catchingUp.current = null; }
  }, [conversationId, isGroupParam, loadLatest, markRead, userId]);

  /** Everything new since the thread was last current, then fresh statuses for recent messages. */
  const syncThread = useCallback(async () => {
    await catchUp();
    await loadLatest();
  }, [catchUp, loadLatest]);

  /** Pins change rarely: loaded with the thread and again whenever someone pins or unpins. */
  const loadPins = useCallback(async () => {
    const token = tokenRef.current;
    if (!token) return;
    try {
      const { pins: latest } = await listPins(conversationId, token);
      setPins(latest);
    } catch {
      // An older server has no pins, and offline the bar keeps what it showed.
    }
  }, [conversationId]);

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
      void loadPins();
    } else if (event.type === "pins_changed" && event.conversationId === conversationId) {
      void loadPins();
    } else if (event.type === "message" && event.conversationId === conversationId) {
      if (event.senderId === typingRef.current) stopTyping(); // what they were typing just arrived
      void catchUp().then((found) => {
        // Not found "newer than" the thread's newest message: that one was unsent while this phone
        // was offline, so nothing is newer than it any more. The latest page brings the thread on.
        if (found && !found.has(event.messageId) && !messagesRef.current?.some((m) => m.id === event.messageId)) void loadLatest();
      });
      if (isGroup) void loadDetails(); // someone may have joined, left or renamed it
    } else if (event.type === "unsent" && event.conversationId === conversationId) {
      setMessages((current) => current?.filter((m) => m.id !== event.messageId) ?? current);
      // Its pin went with it.
      setPins((current) => (current.some((p) => p.messageId === event.messageId) ? current.filter((p) => p.messageId !== event.messageId) : current));
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
      void loadPins();
      if (isGroupRef.current) void loadDetailsRef.current(); // back from the group's info: names may have changed
      const interval = setInterval(() => {
        if (AppState.currentState === "active") void catchUp();
      }, connected ? POLL_LIVE_MS : POLL_OFFLINE_MS);
      return () => {
        focusedRef.current = false;
        clearInterval(interval);
        // A voice note doesn't go on playing over a profile or another screen opened from here.
        setPlayingKey(null);
      };
    }, [catchUp, connected, loadPins, syncThread]),
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
    if (!userId) throw new Error(t("common.youreSignedOut"));
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
      Alert.alert(t("conversation.notSent"), t("conversation.couldntSendThatTryAgain"));
    });
  }, [conversationId, getToken, takeReply, userId]);

  const onVoiceNote = useCallback((uri: string, durationMs: number) => sendMedia(newVoiceNote(uri, durationMs)), [sendMedia]);
  const onStartRecording = useCallback(() => setPlayingKey(null), []);

  const onPickedAssets = useCallback((assets: Asset[] | undefined) => {
    for (const asset of assets ?? []) {
      if (!asset.uri) continue;
      if (asset.type?.startsWith("video/") && (asset.fileSize ?? 0) > MAX_DM_VIDEO_BYTES) {
        Alert.alert(t("common.videoTooLarge"), t("conversation.chooseAVideoUnder100"));
        continue;
      }
      sendMedia(newPendingMedia({ uri: asset.uri, type: asset.type, width: asset.width, height: asset.height }));
    }
  }, [sendMedia]);
  const onPicked = useCallback((result: ImagePickerResponse, source: "camera" | "photos") => {
    if (result.didCancel) return;
    // iOS reports a refused camera or photo library as "permission": offer Settings, not "try again".
    if (result.errorCode === "permission") accessRefused(source);
    else if (result.errorCode === "camera_unavailable") Alert.alert(t("conversation.noCamera"), t("conversation.theresNoCameraAvailableChoose"));
    else if (result.errorCode) Alert.alert(source === "camera" ? t("common.cameraUnavailable") : t("common.galleryUnavailable"), result.errorMessage ?? t("common.tryAgain2"));
    else if (source === "camera" && result.assets?.length === 1 && result.assets[0]!.uri) {
      const asset = result.assets[0]!;
      if (asset.type?.startsWith("video/") && (asset.fileSize ?? 0) > MAX_DM_VIDEO_BYTES) Alert.alert(t("common.videoTooLarge"), t("conversation.recordAShorterVideo"));
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
      Alert.alert(t("conversation.couldntReact"), error instanceof ApiError && error.status !== 404 ? error.message : t("conversation.checkYourConnectionAndTry"));
    }
  };

  const toggleMute = async () => {
    const token = tokenRef.current;
    if (!token) return;
    const next = !muted;
    setMuted(next);
    try {
      await setConversationMuted(conversationId, next, token);
      showToast(next ? t("common.notificationsMuted") : t("common.notificationsOn"));
    } catch {
      setMuted(!next);
      Alert.alert(t("common.couldntChangeThat"), t("conversation.checkYourConnectionAndTry"));
    }
  };
  const blockOther = () => {
    if (!otherUsername) return;
    Alert.alert(t("conversation.blockOtherusername2", { otherUsername }), t("conversation.theyWontBeAbleTo"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("common.block"),
        style: "destructive",
        onPress: async () => {
          const token = tokenRef.current;
          if (!token) return;
          try {
            await blockUser(otherUsername, token);
            showToast(t("conversation.blockedOtherusername", { otherUsername }));
            navigation.popToTop();
          } catch {
            Alert.alert(t("common.couldntBlock"), t("conversation.checkYourConnectionAndTry"));
          }
        },
      },
    ]);
  };
  const deleteChat = () => {
    Alert.alert(t("common.deleteThisChat"), t("conversation.itsRemovedFromYourInbox"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("common.delete"),
        style: "destructive",
        onPress: async () => {
          const token = tokenRef.current;
          if (!token) return;
          try {
            await hideConversation(conversationId, token);
            void refreshUnreadCount();
            navigation.popToTop();
          } catch {
            Alert.alert(t("common.couldntDelete"), t("conversation.checkYourConnectionAndTry"));
          }
        },
      },
    ]);
  };

  /** Unsend your own message, after a confirmation; it goes at once and comes back if that fails. */
  const unsend = (message: Message) => {
    Alert.alert(t("conversation.unsendMessage"), t("conversation.itWillBeRemovedFor"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("conversation.unsend"),
        style: "destructive",
        onPress: async () => {
          const token = tokenRef.current;
          if (!token) return;
          setMessages((current) => current?.filter((m) => m.id !== message.id) ?? current);
          try {
            await unsendMessage(conversationId, message.id, token);
            setPins((current) => current.filter((p) => p.messageId !== message.id));
          } catch {
            setMessages((current) => (current ? mergeMessages(current, [message]) : current));
            Alert.alert(t("conversation.couldntUnsend"), t("conversation.checkYourConnectionAndTry"));
          }
        },
      },
    ]);
  };

  /** Three pins at most: pinning a fourth offers to take the oldest one's place. */
  const replaceOldestPin = async (message: Message) => {
    const token = tokenRef.current;
    if (!token) return;
    try {
      const { pins: current } = await listPins(conversationId, token); // the oldest as it is now
      const oldest = current[current.length - 1];
      if (oldest) await unpinMessage(conversationId, oldest.messageId, token);
      await pinMessage(conversationId, message.id, token);
      showToast(t("conversation.pinned"));
    } catch {
      Alert.alert(t("conversation.couldntPin"), t("conversation.checkYourConnectionAndTry"));
    }
    void loadPins();
  };
  const togglePin = async (message: Message) => {
    const token = tokenRef.current;
    if (!token) return;
    const pinned = pinsRef.current.some((p) => p.messageId === message.id);
    try {
      if (pinned) await unpinMessage(conversationId, message.id, token);
      else await pinMessage(conversationId, message.id, token);
      showToast(pinned ? t("conversation.unpinned") : t("conversation.pinned"));
      void loadPins();
    } catch (error) {
      if (!pinned && error instanceof ApiError && error.status === 409 && error.details?.code === "too_many_pins") {
        Alert.alert(t("conversation.replaceTheOldestPin"), t("conversation.youCanPinUpTo", { MAX_PINS }), [
          { text: t("common.cancel"), style: "cancel" },
          { text: t("conversation.replaceOldest"), onPress: () => void replaceOldestPin(message) },
        ]);
        return;
      }
      Alert.alert(pinned ? t("conversation.couldntUnpin") : t("conversation.couldntPin"), error instanceof ApiError && error.status !== 404 && error.status !== 0 ? error.message : t("conversation.checkYourConnectionAndTry"));
    }
  };
  const forward = (message: Message) => {
    const go = () => rootNavigation.navigate("ForwardMessage", { conversationId, messageId: message.id });
    if (Platform.OS === "ios") afterMenu.current = go; // the menu's onDismiss runs it
    setReactingTo(null);
    if (Platform.OS !== "ios") go();
  };
  /** Who sent a pinned message, as its list says it. */
  const authorOf = (senderId: string) => (senderId === userId ? t("common.you") : nameOf(senderId) ? `@${nameOf(senderId)}` : t("common.someone"));

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
      Alert.alert(t("conversation.notSent"), row.error ?? undefined, [
        { text: t("common.tryAgain"), onPress: () => void retryMedia(owner, row.clientMessageId, latest.current.getToken) },
        { text: t("common.delete"), style: "destructive", onPress: () => void discardMedia(owner, row.clientMessageId) },
        { text: t("common.cancel"), style: "cancel" },
      ]);
    },
    onPendingPress: (row) => {
      const owner = latest.current.userId;
      if (!owner || row.status === "sending") return;
      Alert.alert(row.status === "failed" ? t("conversation.messageNotSent") : t("conversation.messageWaitingToSend"), row.error ?? undefined, [
        { text: t("common.tryAgain"), onPress: () => void retryMessage(owner, row.clientMessageId, latest.current.getToken) },
        { text: t("common.delete"), style: "destructive", onPress: () => void discardMessage(owner, row.clientMessageId) },
        { text: t("common.cancel"), style: "cancel" },
      ]);
    },
    // Long-press any stored message to react to it (and, on the other person's, to report it:
    // the DM safety workflow). Screen reader users get the same choices as actions on the message.
    onLongPress: (row) => {
      if (row.kind !== "sent") return;
      tapFeedback("tap");
      Keyboard.dismiss();
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
    onCallBack: (media) => placeCallRef.current(media),
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
    return { author: replyingTo.senderId === userId ? "yourself" : labelOf(replyingTo.senderId) ?? "them", snippet: quoteSnippet(quoteOf(replyingTo)) };
  }, [labelOf, replyingTo, userId]);

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
        labelOf={labelOf}
        senderLabel={senderLabel}
        accessToken={accessToken}
        showStatus={key === statusRowKey}
        playing={playingKey === key}
        maxMediaSide={maxMediaSide}
        actions={actions}
      />
    );
  }, [accessToken, actions, isGroup, maxMediaSide, members, nameOf, labelOf, playingKey, rows, statusRowKey, userId]);

  if (messages === null) {
    return (
      <View style={styles.centered}>
        {loadError ? (
          <>
            <Text style={[typography.body, styles.loadError]}>{loadError}</Text>
            <Pressable style={styles.retryButton} onPress={() => void loadLatest(true)} accessibilityRole="button">
              <Text style={styles.retryButtonText}>{t("common.tryAgain")}</Text>
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
      {pins.length ? (
        // The latest pin, one line; a tap lists them all (each one can be shown or unpinned).
        <Pressable
          style={styles.pinBar}
          onPress={() => setPinsOpen(true)}
          accessibilityRole="button"
          accessibilityLabel={`Pinned: ${messagePreview(pins[0]!.message)}${pins.length > 1 ? `, ${pins.length} pinned messages` : ""}`}
          accessibilityHint={t("conversation.showsThePinnedMessages")}
        >
          <Icon name={ICONS.pin} size={16} color={colors.textSecondary} />
          <Text style={styles.pinBarText} numberOfLines={1}>{messagePreview(pins[0]!.message)}</Text>
          {pins.length > 1 ? <Text style={styles.pinBarCount}>{t("conversation.lengthPinned", { length: pins.length })}</Text> : null}
        </Pressable>
      ) : null}
      <FlatList
        ref={listRef}
        onScrollToIndexFailed={onScrollToIndexFailed}
        style={styles.list}
        contentContainerStyle={styles.listContent}
        data={rows}
        inverted
        // With the keyboard up (just after sending), a tap or long-press on a message still works
        // the first time, like WhatsApp; scrolling the chat lowers the keyboard.
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        keyExtractor={rowKey}
        onEndReachedThreshold={0.4}
        onEndReached={onEndReached}
        renderItem={renderItem}
        initialNumToRender={12}
        maxToRenderPerBatch={8}
        windowSize={7}
        ListFooterComponent={loadingMore ? <ActivityIndicator color={colors.accentText} style={styles.footerSpinner} /> : undefined}
      />
      {/* Outside the inverted list: Android flips an inverted list on both axes, which mirrored this text. */}
      {rows.length === 0 ? (
        <View style={styles.emptyState} pointerEvents="none">
          <Text style={typography.body}>{otherUsername && !isGroup ? t("conversation.sayHiToOtherusername", { otherUsername }) : t("conversation.sayHiToTheGroup")}</Text>
        </View>
      ) : null}
      {otherTyping ? (
        <View style={styles.typingRow} accessibilityLiveRegion="polite">
          <View style={styles.typingBubble}>
            <Text style={styles.typingText}>{typingUserId && nameOf(typingUserId) ? t("conversation.isTyping", { username: nameOf(typingUserId) ?? "" }) : t("conversation.typing")}</Text>
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
          <Pressable style={[styles.viewerClose, { top: insetsTop + spacing.sm }]} onPress={() => setViewing(null)} hitSlop={12} accessibilityRole="button" accessibilityLabel={t("common.close")}>
            <Icon name={ICONS.close} size={24} color="#FFFFFF" />
          </Pressable>
        </View>
      </Modal>
      <Modal
        visible={reactingTo !== null}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setReactingTo(null)}
        onDismiss={() => {
          const next = afterMenu.current;
          afterMenu.current = null;
          next?.();
        }}
      >
        <Pressable pressEffect="none" style={styles.reactBackdrop} onPress={() => setReactingTo(null)} accessibilityRole="button" accessibilityLabel={t("common.close")}>
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
              <Pressable style={styles.menuRow} onPress={() => { if (reactingTo) actions.onReply(reactingTo); }} accessibilityRole="button" accessibilityLabel={t("common.reply")}>
                <Text style={styles.menuText}>{t("common.reply")}</Text>
                <Icon name={ICONS.reply} size={18} color={colors.textPrimary} />
              </Pressable>
              {reactingTo && !reactingTo.event && (reactingTo.body || reactingTo.media || reactingTo.sharedStoryId) ? (
                <Pressable style={styles.menuRow} onPress={() => forward(reactingTo)} accessibilityRole="button" accessibilityLabel={t("conversation.forward")}>
                  <Text style={styles.menuText}>{t("conversation.forward")}</Text>
                  <Icon name={ICONS.forward} size={18} color={colors.textPrimary} />
                </Pressable>
              ) : null}
              {reactingTo?.body ? (
                <Pressable
                  style={styles.menuRow}
                  onPress={() => {
                    Clipboard.setString(reactingTo.body ?? "");
                    setReactingTo(null);
                    showToast(t("conversation.copied"));
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={t("conversation.copy")}
                >
                  <Text style={styles.menuText}>{t("conversation.copy")}</Text>
                  <Icon name={ICONS.copy} size={18} color={colors.textPrimary} />
                </Pressable>
              ) : null}
              {reactingTo ? (() => {
                const pinned = pins.some((p) => p.messageId === reactingTo.id);
                return (
                  <Pressable
                    style={styles.menuRow}
                    onPress={() => {
                      const target = reactingTo;
                      setReactingTo(null);
                      void togglePin(target);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={pinned ? "Unpin" : "Pin"}
                  >
                    <Text style={styles.menuText}>{pinned ? t("conversation.unpin") : t("conversation.pin")}</Text>
                    <Icon name={ICONS.pin} size={18} color={colors.textPrimary} />
                  </Pressable>
                );
              })() : null}
              {reactingTo && reactingTo.senderId === userId ? (
                <Pressable
                  style={styles.menuRow}
                  onPress={() => {
                    const target = reactingTo;
                    setReactingTo(null);
                    unsend(target);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={t("conversation.unsend")}
                >
                  <Text style={styles.menuDanger}>{t("conversation.unsend")}</Text>
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
                  accessibilityLabel={t("conversation.reportMessage")}
                >
                  <Text style={styles.menuDanger}>{t("common.report")}</Text>
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
            { label: muted ? t("common.unmuteNotifications") : t("common.muteNotifications"), onPress: () => void toggleMute() },
            ...(otherUsername ? [{ label: t("common.viewProfile"), onPress: openProfile }] : []),
          ],
          [
            ...(otherUsername ? [{ label: t("conversation.blockOtherusername", { otherUsername }), destructive: true, onPress: blockOther }] : []),
            { label: t("common.deleteChat"), destructive: true, onPress: deleteChat },
          ],
        ]}
      />
      <Modal visible={pinsOpen && pins.length > 0} transparent animationType="slide" statusBarTranslucent onRequestClose={() => setPinsOpen(false)}>
        <View style={styles.sheetFill}>
          <Pressable pressEffect="none" style={styles.sheetBackdrop} onPress={() => setPinsOpen(false)} accessibilityRole="button" accessibilityLabel={t("common.close")} />
          <View style={[styles.sheet, { paddingBottom: spacing.lg + insetsBottom }]} accessibilityViewIsModal>
            <Text style={styles.sheetTitle} accessibilityRole="header">{t("conversation.pinnedMessages")}</Text>
            {pins.map((pin) => {
              const preview = messagePreview(pin.message);
              const author = authorOf(pin.message.senderId);
              return (
                <View key={pin.messageId} style={styles.pinRow}>
                  <Pressable
                    style={styles.pinRowText}
                    onPress={() => {
                      setPinsOpen(false);
                      scrollToMessage(pin.messageId);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={`${author}: ${preview}`}
                    accessibilityHint={t("conversation.showsItInTheChat")}
                  >
                    <Text style={styles.pinRowAuthor} numberOfLines={1}>{author}</Text>
                    <Text style={styles.pinRowBody} numberOfLines={3}>{preview}</Text>
                  </Pressable>
                  <Pressable style={styles.unpinButton} onPress={() => void togglePin(pin.message)} hitSlop={6} accessibilityRole="button" accessibilityLabel={`Unpin ${preview}`}>
                    <Text style={styles.unpinText}>{t("conversation.unpin")}</Text>
                  </Pressable>
                </View>
              );
            })}
          </View>
        </View>
      </Modal>
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
  headerActions: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  callLine: { alignSelf: "center", flexDirection: "row", alignItems: "center", gap: spacing.xs, marginVertical: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.xs + 2, borderRadius: radii.pill, backgroundColor: colors.surface, minHeight: 32 },
  callLineText: { color: colors.textSecondary, fontSize: 13, fontWeight: "500" },
  callLineMissed: { color: colors.danger },
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
  menuCard: { alignSelf: "center", width: 240, borderRadius: radii.md, backgroundColor: colors.surfaceElevated, overflow: "hidden" },
  menuRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md, minHeight: 48, paddingHorizontal: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
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
  forwardedLabel: { flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 2, marginHorizontal: spacing.xs },
  forwardedText: { color: colors.textSecondary, fontSize: 12, fontStyle: "italic" },
  pinBar: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.xs + 2, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, backgroundColor: colors.surface },
  pinBarText: { flex: 1, color: colors.textPrimary, fontSize: 13 },
  pinBarCount: { color: colors.textSecondary, fontSize: 12 },
  sheetFill: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)" },
  sheetBackdrop: { flex: 1 },
  sheet: { borderTopLeftRadius: radii.lg, borderTopRightRadius: radii.lg, backgroundColor: colors.surfaceElevated, paddingHorizontal: spacing.md, paddingTop: spacing.md },
  sheetTitle: { color: colors.textPrimary, fontSize: 16, fontWeight: "700", marginBottom: spacing.xs },
  pinRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  pinRowText: { flex: 1, gap: 2 },
  pinRowAuthor: { color: colors.textSecondary, fontSize: 12, fontWeight: "600" },
  pinRowBody: { color: colors.textPrimary, fontSize: 15 },
  unpinButton: { paddingHorizontal: spacing.sm, minHeight: 36, justifyContent: "center" },
  unpinText: { color: colors.accentText, fontSize: 14, fontWeight: "600" },
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
  // A failed message keeps its colours (readable) with a red edge; "Not sent · Tap to retry" says the rest.
  bubbleFailed: { borderWidth: 1.5, borderColor: colors.danger, opacity: 1 },
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
