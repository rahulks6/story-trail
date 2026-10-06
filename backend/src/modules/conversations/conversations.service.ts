import { enforceAction } from "../safety/limits";
import { assertLinksAllowed } from "../safety/links";
import { HttpError } from "../../http/errors";
import { assertCanContribute } from "../admin/account-policy";
import * as usersRepo from "../users/users.repository";
import * as socialRepo from "../social/social.repository";
import * as engagementService from "../stories/engagement.service";
import * as conversationsRepo from "./conversations.repository";
import type { ConversationRow, ConversationSummary, MessageRow } from "./conversations.repository";

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

export async function listConversations(viewerId: string, limit: number, offset: number, search = ""): Promise<ConversationSummary[]> {
  return conversationsRepo.listConversationsForUser(viewerId, limit, offset, search.trim().slice(0, 60));
}

export async function getUnreadConversationCount(viewerId: string): Promise<number> {
  return conversationsRepo.countUnreadConversations(viewerId);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function requireParticipant(conversationId: string, viewerId: string): Promise<ConversationRow> {
  // A malformed id is just "not found" (and never reaches the uuid cast in SQL).
  const conversation = UUID_RE.test(conversationId) ? await conversationsRepo.findConversationById(conversationId) : null;
  if (!conversation || (conversation.userAId !== viewerId && conversation.userBId !== viewerId)) {
    throw new HttpError(404, "Conversation not found.");
  }
  return conversation;
}

function otherParticipant(conversation: ConversationRow, viewerId: string): string {
  return conversation.userAId === viewerId ? conversation.userBId : conversation.userAId;
}

/** One of the viewer's conversations, e.g. to open a thread from a push notification's link. */
export async function getConversation(viewerId: string, conversationId: string): Promise<ConversationWithOtherUser> {
  const conversation = await requireParticipant(conversationId, viewerId);
  const other = await usersRepo.findUserById(otherParticipant(conversation, viewerId));
  if (!other) throw new HttpError(404, "Conversation not found.");
  return {
    id: conversation.id,
    createdAt: conversation.createdAt,
    otherUser: { id: other.id, username: other.username, displayName: other.displayName, avatarMediaId: other.avatarMediaId },
  };
}

export interface SendMessageInput {
  body: string | null;
  storyId: string | null;
  /** The device's id for this message: a retried send with the same id never duplicates it. */
  clientMessageId: string | null;
}

export async function sendMessage(viewerId: string, conversationId: string, input: SendMessageInput): Promise<{ message: MessageRow; created: boolean }> {
  const conversation = await requireParticipant(conversationId, viewerId);
  const otherId = otherParticipant(conversation, viewerId);

  if (input.clientMessageId) {
    // A retry of a send whose response was lost: answer with the original, no side effects.
    const existing = await conversationsRepo.findMessageByClientId(conversationId, viewerId, input.clientMessageId);
    if (existing) return replayed(existing, input);
  }
  await assertNotBlocked(viewerId, otherId); // re-checked at send time, not just at conversation creation
  await enforceAction(viewerId, "message"); // retries above never count
  if (input.body) await assertLinksAllowed(input.body, "message", viewerId);

  if (input.storyId) {
    // Reuses the exact same view-access + allowSharing rule and analytics
    // logging as the Share sheet's other two options (native share, copy
    // link) — see engagement.service.shareStory. A "Send to a Katkee user"
    // that skipped this check could leak a followers-only Story to someone
    // who couldn't otherwise see it.
    await engagementService.shareStory(viewerId, input.storyId);
  }

  const result = await conversationsRepo.createMessage(conversationId, viewerId, input.body, input.storyId, input.clientMessageId);
  return result.created ? result : replayed(result.message, input);
}

function replayed(message: MessageRow, input: SendMessageInput): { message: MessageRow; created: boolean } {
  if (message.body !== input.body || message.sharedStoryId !== input.storyId) {
    throw new HttpError(409, "This message id was already used for a different message.");
  }
  return { message, created: false };
}

export type MessageDeliveryStatus = "sent" | "delivered" | "read";

export interface MessageWithStatus extends MessageRow {
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
      ? conversationsRepo.listMessagesByCursor(conversationId, cursor, limit)
      : conversationsRepo.listMessages(conversationId, limit, offset).then((messages) => ({ messages, hasMore: null })),
    // Fetching messages at all is itself the real "my client received
    // this" signal (see markDelivered's own comment) — every fetch, not
    // just the first page, since even loading older history proves the
    // client is online and synced up through now.
    conversationsRepo.markDelivered(conversationId, viewerId),
  ]);

  // The device id of a message is the sender's business only.
  const rows = page.messages.map((m) => (m.senderId === viewerId || m.clientMessageId === undefined ? m : withoutClientId(m)));
  const mine = rows.filter((m) => m.senderId === viewerId);
  if (mine.length === 0) return { messages: rows, hasMore: page.hasMore };

  const otherState = await conversationsRepo.getReadState(conversationId, otherId);
  const lastReadMs = new Date(otherState.lastReadAt).getTime();
  const lastDeliveredMs = new Date(otherState.lastDeliveredAt).getTime();

  const messages = rows.map((m): MessageWithStatus => {
    if (m.senderId !== viewerId) return m;
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
  const conversation = await requireParticipant(conversationId, reporterId);
  const otherId = otherParticipant(conversation, reporterId);
  const result = await conversationsRepo.reportMessage({ reporterId, otherId, conversationId, ...input });
  if (!result.found || !result.reportId) throw new HttpError(404, "Message not found.");
  return { report: { id: result.reportId }, created: result.created };
}
