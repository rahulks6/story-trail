import { apiGet, apiPost } from "./client";

/**
 * Mirrors backend/src/modules/conversations/conversations.repository.ts —
 * see the note atop client.ts about keeping these in lockstep by hand
 * until there's a shared types package.
 */
export interface ConversationSummary {
  id: string;
  otherUser: { id: string; username: string; displayName: string };
  lastMessage: {
    id: string;
    senderId: string;
    body: string | null;
    sharedStoryId: string | null;
    createdAt: string;
  } | null;
  unread: boolean;
  createdAt: string;
}

export type MessageDeliveryStatus = "sent" | "delivered" | "read";

export interface Message {
  id: string;
  conversationId: string;
  senderId: string;
  body: string | null;
  sharedStoryId: string | null;
  createdAt: string;
  /** Only present on messages the viewer themselves sent — see backend/src/modules/conversations/conversations.service.ts's listMessages. */
  status?: MessageDeliveryStatus;
  /** The id this device chose when sending (own messages only): matches an outbox entry to its stored message. */
  clientMessageId?: string;
}

export interface ConversationWithOtherUser {
  id: string;
  createdAt: string;
  otherUser: { id: string; username: string; displayName: string };
}

export function openConversation(username: string, accessToken: string): Promise<{ conversation: ConversationWithOtherUser }> {
  return apiPost(`/api/v1/users/${username}/conversation`, undefined, accessToken);
}

export function listConversations(
  accessToken: string,
  params: { limit?: number; offset?: number; q?: string } = {},
): Promise<{ conversations: ConversationSummary[]; limit: number; offset: number }> {
  const query = new URLSearchParams();
  if (params.limit) query.set("limit", String(params.limit));
  if (params.offset) query.set("offset", String(params.offset));
  if (params.q?.trim()) query.set("q", params.q.trim());
  const qs = query.toString();
  return apiGet(`/api/v1/conversations${qs ? `?${qs}` : ""}`, accessToken);
}

/** One of your conversations by id (a push notification's link carries only the id). */
export function getConversation(conversationId: string, accessToken: string): Promise<{ conversation: ConversationWithOtherUser }> {
  return apiGet(`/api/v1/conversations/${encodeURIComponent(conversationId)}`, accessToken);
}

export function getUnreadConversationCount(accessToken: string): Promise<{ count: number }> {
  return apiGet("/api/v1/conversations/unread-count", accessToken);
}

/**
 * Newest first. `before`/`after` take a message id and return the page older/newer than
 * it — stable while new messages arrive, unlike offsets — with `hasMore` set.
 */
export function listMessages(
  conversationId: string,
  accessToken: string,
  params: { limit?: number; offset?: number; before?: string; after?: string } = {},
): Promise<{ messages: Message[]; limit: number; offset: number; hasMore?: boolean }> {
  const query = new URLSearchParams();
  if (params.limit) query.set("limit", String(params.limit));
  if (params.offset) query.set("offset", String(params.offset));
  if (params.before) query.set("before", params.before);
  else if (params.after) query.set("after", params.after);
  const qs = query.toString();
  return apiGet(`/api/v1/conversations/${conversationId}/messages${qs ? `?${qs}` : ""}`, accessToken);
}

/** Matches the server's limit (backend/src/modules/conversations/dto.ts). */
export const MAX_MESSAGE_LENGTH = 2000;

/** A device-chosen id for one message: retrying a send with it never creates a duplicate. */
export function newClientMessageId(): string {
  const part = () => Math.random().toString(36).slice(2, 10).padEnd(8, "0");
  return `m_${Date.now().toString(36)}_${part()}${part()}${part()}`;
}

/**
 * 201 for a new message, 200 when `clientMessageId` was already used for this same
 * message (the response to an earlier attempt was lost): either way, the message.
 */
export function sendMessage(
  conversationId: string,
  input: { body?: string; storyId?: string; clientMessageId?: string },
  accessToken: string,
): Promise<{ message: Message }> {
  return apiPost(`/api/v1/conversations/${conversationId}/messages`, input, accessToken);
}

export function markConversationRead(conversationId: string, accessToken: string): Promise<void> {
  return apiPost(`/api/v1/conversations/${conversationId}/read`, undefined, accessToken);
}
