import { enforceAction } from "../safety/limits";
import { assertLinksAllowed } from "../safety/links";
import { HttpError } from "../../http/errors";
import { assertCanContribute } from "../admin/account-policy";
import * as usersRepo from "../users/users.repository";
import * as socialRepo from "../social/social.repository";
import * as engagementService from "../stories/engagement.service";
import * as conversationsRepo from "./conversations.repository";
import * as groupsRepo from "./groups.repository";
import type { ConversationRow, ConversationSummary, MessageRow, StoryReplyKind } from "./conversations.repository";
import { getStoryForViewer } from "../stories/stories.service";
import * as mediaRepo from "../media/media.repository";
import { publishRealtime } from "../../realtime/hub";

async function requireOtherUser(username: string, viewerId: string): Promise<usersRepo.UserRecord> {
  const target = await usersRepo.findUserByUsername(username);
  if (!target) throw new HttpError(404, "User not found.");
  if (target.id === viewerId) throw new HttpError(400, "You can't message yourself.");
  return target;
}

async function assertNotBlocked(userIdA: string, userIdB: string): Promise<void> {
  const blocked = await socialRepo.anyBlockBetween(userIdA, userIdB);
  if (blocked) throw new HttpError(404, "User not found.");
}

export interface ConversationWithOtherUser {
  id: string;
  createdAt: string;
  otherUser: { id: string; username: string; displayName: string; avatarMediaId: string | null };
}

/** Find-or-create the 1:1 conversation with `targetUsername`, denied the same way a blocked profile 404s. */
export async function openConversationWith(viewerId: string, targetUsername: string): Promise<ConversationWithOtherUser> {
  const target = await requireOtherUser(targetUsername, viewerId);
  await assertNotBlocked(viewerId, target.id);
  const existing = await conversationsRepo.findConversationBetween(viewerId, target.id);
  if (!existing) {
    await assertCanContribute(viewerId);
    await enforceAction(viewerId, "conversation"); // cold-DM spam protection
  }
  const conversation = existing ?? (await conversationsRepo.createConversation(viewerId, target.id));
  return {
    id: conversation.id,
    createdAt: conversation.createdAt,
    otherUser: { id: target.id, username: target.username, displayName: target.displayName, avatarMediaId: target.avatarMediaId },
  };
}

export async function listConversations(viewerId: string, limit: number, offset: number, search = "", includeGroups = false): Promise<ConversationSummary[]> {
  return conversationsRepo.listConversationsForUser(viewerId, limit, offset, search.trim().slice(0, 60), includeGroups);
}

export async function getUnreadConversationCount(viewerId: string): Promise<number> {
  return conversationsRepo.countUnreadConversations(viewerId);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface Participation extends ConversationRow {
  /** When the viewer joined: a group's members see what was sent from then on (1:1: everything). */
  since: string;
  role: conversationsRepo.Membership["role"];
}

/** The conversation, if the viewer is in it now (a 1:1 participant, or a group member who hasn't left). */
export async function requireParticipant(conversationId: string, viewerId: string): Promise<Participation> {
  // A malformed id is just "not found" (and never reaches the uuid cast in SQL).
  const conversation = UUID_RE.test(conversationId) ? await conversationsRepo.findConversationById(conversationId) : null;
  const membership = conversation ? await conversationsRepo.findActiveMembership(conversation.id, viewerId) : null;
  if (!conversation || !membership) throw new HttpError(404, "Conversation not found.");
  return { ...conversation, since: conversation.kind === "group" ? membership.joinedAt : new Date(0).toISOString(), role: membership.role };
}

/** The other person in a 1:1 conversation (null in a group). */
function otherParticipant(conversation: ConversationRow, viewerId: string): string | null {
  if (conversation.kind !== "direct") return null;
  return conversation.userAId === viewerId ? conversation.userBId : conversation.userAId;
}

export interface GroupDetails {
  id: string;
  kind: "group";
  createdAt: string;
  title: string | null;
  otherUser: null;
  /** The viewer's own role (admins can remove people). */
  role: conversationsRepo.Membership["role"];
  members: conversationsRepo.MemberRow[];
}

/**
 * One of the viewer's conversations, e.g. to open a thread from a push notification's link.
 * A group only for an app that shows groups (`includeGroups`); to an older one it isn't there.
 */
export async function getConversation(viewerId: string, conversationId: string, includeGroups = false): Promise<(ConversationWithOtherUser & { kind: "direct" }) | GroupDetails> {
  const conversation = await requireParticipant(conversationId, viewerId);
  if (conversation.kind === "group") {
    if (!includeGroups) throw new HttpError(404, "Conversation not found.");
    return { id: conversation.id, kind: "group", createdAt: conversation.createdAt, title: conversation.title, otherUser: null, role: conversation.role,
             members: await conversationsRepo.listActiveMembers(conversation.id) };
  }
  const other = await usersRepo.findUserById(otherParticipant(conversation, viewerId)!);
  if (!other) throw new HttpError(404, "Conversation not found.");
  return {
    id: conversation.id,
    kind: "direct",
    createdAt: conversation.createdAt,
    otherUser: { id: other.id, username: other.username, displayName: other.displayName, avatarMediaId: other.avatarMediaId },
  };
}

export interface SendMessageInput {
  body: string | null;
  storyId: string | null;
  /** The device's id for this message: a retried send with the same id never duplicates it. */
  clientMessageId: string | null;
  /** A photo or video the sender uploaded (POST /api/v1/media/photos or /videos) to send. */
  mediaId?: string | null;
  /** Set by replyToStory only: the Story this message answers. */
  storyReply?: { storyId: string; kind: StoryReplyKind } | null;
  /** A message in this conversation that this one replies to (swipe to reply). */
  replyToMessageId?: string | null;
}

export async function sendMessage(viewerId: string, conversationId: string, input: SendMessageInput): Promise<{ message: MessageRow; created: boolean }> {
  const conversation = await requireParticipant(conversationId, viewerId);
  const otherId = otherParticipant(conversation, viewerId);

  if (input.clientMessageId) {
    // A retry of a send whose response was lost: answer with the original, no side effects.
    const existing = await conversationsRepo.findMessageByClientId(conversationId, viewerId, input.clientMessageId);
    if (existing) return replayed(existing, input);
  }
  // Re-checked at send time, not just at conversation creation. In a group, a block between two
  // members doesn't silence the group (like Instagram); it keeps them out of each other's 1:1s.
  if (otherId) await assertNotBlocked(viewerId, otherId);
  await enforceAction(viewerId, "message"); // retries above never count
  if (input.body) await assertLinksAllowed(input.body, "message", viewerId);

  if (input.mediaId) {
    // Only your own upload, and only once it's been received (it may still be processing).
    const media = await mediaRepo.findMediaById(input.mediaId, true);
    if (!media || media.ownerId !== viewerId || media.purgedAt || (media.status !== "ready" && media.status !== "processing")) {
      throw new HttpError(422, "That photo or video can't be sent.", { mediaId: "Upload the photo or video first." });
    }
  }

  if (input.replyToMessageId && !(await conversationsRepo.messageInConversation(conversationId, input.replyToMessageId))) {
    throw new HttpError(422, "That message can't be replied to.", { replyToMessageId: "Reply to a message in this conversation." });
  }

  if (input.storyId) {
    // Reuses the exact same view-access + allowSharing rule and analytics
    // logging as the Share sheet's other two options (native share, copy
    // link) — see engagement.service.shareStory. A "Send to a Katkee user"
    // that skipped this check could leak a followers-only Story to someone
    // who couldn't otherwise see it.
    await engagementService.shareStory(viewerId, input.storyId);
  }

  const result = await conversationsRepo.createMessage(conversationId, viewerId, input.body, input.storyId, input.clientMessageId, input.storyReply ?? null, input.mediaId ?? null, input.replyToMessageId ?? null);
  return result.created ? result : replayed(result.message, input);
}

/** Reactions on a message (long-press it); migration 0052 allows exactly these. */
export const MESSAGE_REACTIONS = ["❤️", "😂", "😮", "😢", "😡", "👍"] as const;

/** Reacts to a message in one of the viewer's conversations (null removes the reaction). */
export async function reactToMessage(viewerId: string, conversationId: string, messageId: string, emoji: string | null): Promise<conversationsRepo.MessageReaction[]> {
  const conversation = await requireParticipant(conversationId, viewerId);
  const otherId = otherParticipant(conversation, viewerId);
  if (!UUID_RE.test(messageId)) throw new HttpError(404, "Message not found.");
  if (emoji !== null && !(MESSAGE_REACTIONS as readonly string[]).includes(emoji)) {
    throw new HttpError(422, "Choose one of the reactions.", { emoji: `One of ${MESSAGE_REACTIONS.join(" ")}` });
  }
  if (emoji !== null && otherId) await assertNotBlocked(viewerId, otherId);
  const reactions = await conversationsRepo.setMessageReaction(conversationId, messageId, viewerId, emoji, conversation.since);
  if (!reactions) throw new HttpError(404, "Message not found.");
  return reactions;
}

/** The quick reactions a viewer can send to a Story with one tap. */
export const STORY_REACTIONS = ["😂", "😮", "😍", "😢", "👏", "🔥", "🎉", "💯"] as const;

export interface StoryReplyInput {
  /** A written reply, or one of STORY_REACTIONS for a quick reaction. */
  body: string;
  kind: StoryReplyKind;
  clientMessageId: string | null;
}

/**
 * A viewer answers a Story in its owner's DMs (like Instagram): only someone who can see the
 * Story right now can reply to it, and every rule for a direct message still applies (blocks,
 * spam limits, links). The message keeps which Story it answers.
 */
export async function replyToStory(viewerId: string, storyId: string, input: StoryReplyInput): Promise<{ message: MessageRow; created: boolean; conversationId: string }> {
  const story = await getStoryForViewer(storyId, viewerId); // 404 unless the viewer can see it
  if (story.ownerId === viewerId) throw new HttpError(400, "You can't reply to your own Story.");
  const owner = await usersRepo.findUserById(story.ownerId);
  if (!owner) throw new HttpError(404, "Story not found.");
  const conversation = await openConversationWith(viewerId, owner.username);
  const result = await sendMessage(viewerId, conversation.id, {
    body: input.body,
    storyId: null,
    clientMessageId: input.clientMessageId,
    storyReply: { storyId, kind: input.kind },
  });
  return { ...result, conversationId: conversation.id };
}

function replayed(message: MessageRow, input: SendMessageInput): { message: MessageRow; created: boolean } {
  const reply = input.storyReply ?? null;
  if (message.body !== input.body || message.sharedStoryId !== input.storyId || (message.media?.id ?? null) !== (input.mediaId ?? null) ||
      (message.storyReply?.kind ?? null) !== (reply?.kind ?? null) || (reply && message.storyReply?.storyId !== reply.storyId) ||
      // A quoted message that has since gone (null) doesn't make a retry a different message.
      (input.replyToMessageId && message.replyTo && message.replyTo.id !== input.replyToMessageId)) {
    throw new HttpError(409, "This message id was already used for a different message.");
  }
  return { message, created: false };
}

export type MessageDeliveryStatus = "sent" | "delivered" | "read";

export interface MessageWithStatus extends MessageRow {
  /** A group only, on the viewer's own messages: who has read it so far. */
  seenBy?: string[];
  /** Only present on the viewer's OWN messages — spec: Sending/Failed are
   * purely client-local (never reach here at all); a message that exists
   * in the database is definitionally at least "sent". Absent entirely on
   * messages from the other participant — there's nothing to show a
   * viewer about the delivery status of a message they received. */
  status?: MessageDeliveryStatus;
}

export async function listMessages(
  viewerId: string,
  conversationId: string,
  limit: number,
  offset: number,
  cursor?: { before: string } | { after: string },
): Promise<{ messages: MessageWithStatus[]; hasMore: boolean | null }> {
  const conversation = await requireParticipant(conversationId, viewerId);
  const otherId = otherParticipant(conversation, viewerId);

  const [page] = await Promise.all([
    cursor
      ? conversationsRepo.listMessagesByCursor(conversationId, cursor, limit, conversation.since)
      : conversationsRepo.listMessages(conversationId, limit, offset, conversation.since).then((messages) => ({ messages, hasMore: null })),
    // Fetching messages at all is itself the real "my client received
    // this" signal (see markDelivered's own comment) — every fetch, not
    // just the first page, since even loading older history proves the
    // client is online and synced up through now.
    conversationsRepo.markDelivered(conversationId, viewerId),
  ]);

  // The device id of a message is the sender's business only.
  const rows = page.messages.map((m) => (m.senderId === viewerId || m.clientMessageId === undefined ? m : withoutClientId(m)));
  const mine = rows.filter((m) => m.senderId === viewerId && !m.event);
  if (mine.length === 0) return { messages: rows, hasMore: page.hasMore };

  if (!otherId) {
    // A group: read once everyone else has read it (delivered likewise), and who has so far.
    const others = [...(await conversationsRepo.getOthersReadState(conversationId, viewerId))];
    return {
      hasMore: page.hasMore,
      messages: rows.map((m): MessageWithStatus => {
        if (m.senderId !== viewerId || m.event) return m;
        const at = new Date(m.createdAt).getTime();
        const seenBy = others.filter(([, s]) => new Date(s.lastReadAt).getTime() >= at).map(([id]) => id);
        const delivered = others.every(([, s]) => new Date(s.lastDeliveredAt).getTime() >= at);
        const status: MessageDeliveryStatus = others.length > 0 && seenBy.length === others.length ? "read" : delivered && others.length > 0 ? "delivered" : "sent";
        return { ...m, status, seenBy };
      }),
    };
  }

  const otherState = await conversationsRepo.getReadState(conversationId, otherId);
  const lastReadMs = new Date(otherState.lastReadAt).getTime();
  const lastDeliveredMs = new Date(otherState.lastDeliveredAt).getTime();

  const messages = rows.map((m): MessageWithStatus => {
    if (m.senderId !== viewerId || m.event) return m;
    const createdAtMs = new Date(m.createdAt).getTime();
    const status: MessageDeliveryStatus =
      createdAtMs <= lastReadMs ? "read" : createdAtMs <= lastDeliveredMs ? "delivered" : "sent";
    return { ...m, status };
  });
  return { messages, hasMore: page.hasMore };
}

function withoutClientId(message: MessageRow): MessageRow {
  const { clientMessageId: _hidden, ...rest } = message;
  return rest;
}

/** At most one "typing…" signal per person per conversation in this window (per API instance). */
const TYPING_INTERVAL_MS = 2_000;
const lastTyping = new Map<string, number>();

/**
 * "typing…" in the other person's open thread: a realtime signal only, never stored. The
 * app sends it every few seconds while someone types and hides it after a few seconds
 * without one, so a lost signal costs nothing.
 */
export async function signalTyping(viewerId: string, conversationId: string): Promise<void> {
  const conversation = await requireParticipant(conversationId, viewerId);
  const key = `${viewerId}:${conversationId}`;
  const now = Date.now();
  if (now - (lastTyping.get(key) ?? 0) < TYPING_INTERVAL_MS) return;
  // Everyone else in it, except anyone with a block either way: nothing to tell a blocked person.
  const others = (await conversationsRepo.listActiveMembers(conversationId)).map((m) => m.userId).filter((id) => id !== viewerId);
  const told: string[] = [];
  for (const id of others) if (!(await socialRepo.anyBlockBetween(viewerId, id))) told.push(id);
  if (lastTyping.size > 10_000) lastTyping.clear(); // bounded: losing it only lets one extra signal through
  lastTyping.set(key, now);
  await publishRealtime(told, { type: "typing", conversationId, userId: viewerId });
}

export async function markConversationRead(viewerId: string, conversationId: string): Promise<void> {
  await requireParticipant(conversationId, viewerId);
  await conversationsRepo.markRead(conversationId, viewerId);
}

/** Reports a message the other participant sent; see conversationsRepo.reportMessage. */
export async function reportMessage(
  reporterId: string,
  conversationId: string,
  input: { messageId: string; reason: string; details: string | null },
): Promise<{ report: { id: string }; created: boolean }> {
  await requireParticipant(conversationId, reporterId);
  // The person who sent it (in a group, one of the others); never your own message.
  const otherId = UUID_RE.test(input.messageId) ? await groupsRepo.messageSender(conversationId, input.messageId) : null;
  if (!otherId || otherId === reporterId) throw new HttpError(404, "Message not found.");
  const result = await conversationsRepo.reportMessage({ reporterId, otherId, conversationId, ...input });
  if (!result.found || !result.reportId) throw new HttpError(404, "Message not found.");
  return { report: { id: result.reportId }, created: result.created };
}
