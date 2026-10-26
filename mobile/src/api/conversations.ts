import { apiDelete, apiGet, apiPatch, apiPost, apiPut } from "./client";

/**
 * Mirrors backend/src/modules/conversations/conversations.repository.ts —
 * see the note atop client.ts about keeping these in lockstep by hand
 * until there's a shared types package.
 */
export interface PersonSummary { id: string; username: string; displayName: string; avatarMediaId?: string | null; verified?: boolean }

/** A line in a group's thread about the group itself ("@asha added @dev"). */
export type GroupEvent =
  | { type: "created"; title: string | null }
  | { type: "added"; userIds: string[] }
  | { type: "removed"; userIds: string[] }
  | { type: "left" }
  | { type: "renamed"; title: string | null };

export interface ConversationSummary {
  id: string;
  /** Older servers don't send it: a missing kind is a 1:1 conversation. */
  kind?: "direct" | "group";
  /** The other person in a 1:1 conversation; null for a group. */
  otherUser: PersonSummary | null;
  /** A group's name (null if nobody named it), size, and up to three of the others. */
  group?: { title: string | null; memberCount: number; members: PersonSummary[] };
  lastMessage: {
    id: string;
    senderId: string;
    /** Who sent it, in a group. */
    senderUsername?: string;
    body: string | null;
    sharedStoryId: string | null;
    /** Set when the last message was a photo or video. */
    mediaKind?: "photo" | "video" | "audio" | null;
    event?: GroupEvent | null;
    createdAt: string;
  } | null;
  unread: boolean;
  /** You muted it: no pushes from it. */
  muted?: boolean;
  createdAt: string;
}

export type MessageDeliveryStatus = "sent" | "delivered" | "read";

export type StoryReplyKind = "reply" | "reaction";

/** The quick reactions to a Story — same list as backend conversations.service.ts STORY_REACTIONS. */
export const STORY_REACTIONS = ["😂", "😮", "😍", "😢", "👏", "🔥", "🎉", "💯"] as const;

export interface Message {
  id: string;
  conversationId: string;
  senderId: string;
  body: string | null;
  sharedStoryId: string | null;
  /** Set when the message answers a Story; `storyId` is null once that Story is deleted. */
  storyReply?: { storyId: string | null; kind: StoryReplyKind } | null;
  /** A photo or video sent in the message (null once it's been removed). */
  media?: { id: string; kind: "photo" | "video" | "audio"; width: number | null; height: number | null; durationMs: number | null } | null;
  createdAt: string;
  /** Only present on messages the viewer themselves sent — see backend/src/modules/conversations/conversations.service.ts's listMessages. */
  status?: MessageDeliveryStatus;
  /** The id this device chose when sending (own messages only): matches an outbox entry to its stored message. */
  clientMessageId?: string;
  /** Who reacted, and with what: at most one reaction per person. */
  reactions?: MessageReaction[];
  /** The message this one replies to (swipe a message to reply), quoted; null once it's gone. */
  replyTo?: QuotedMessage | null;
  /** A group's "what happened" line (no text of its own). */
  event?: GroupEvent | null;
  /** A group only, on your own messages: who has read it so far. */
  seenBy?: string[];
  /** A shared Story's card: whose, and whether it's still up (`mediaId` only then). */
  sharedStory?: { ownerUsername: string; ownerAvatarMediaId: string | null; mediaId: string | null; active: boolean } | null;
}

/** The start of a replied-to message: enough to show it above the reply. */
export interface QuotedMessage {
  id: string;
  senderId: string;
  body: string | null;
  mediaKind: "photo" | "video" | "audio" | null;
  sharedStory: boolean;
}

export interface MessageReaction {
  userId: string;
  emoji: string;
}

/** The reactions a message can get (long-press a message), same as the server's list. */
export const MESSAGE_REACTIONS = ["❤️", "😂", "😮", "😢", "😡", "👍"] as const;

/** Reacts to a message, replacing your earlier reaction to it; returns its reactions. */
export function reactToMessage(conversationId: string, messageId: string, emoji: string, accessToken: string): Promise<{ reactions: MessageReaction[] }> {
  return apiPut(`/api/v1/conversations/${conversationId}/messages/${messageId}/reaction`, { emoji }, accessToken);
}

/** Takes back your reaction to a message; returns its reactions. */
export function removeMessageReaction(conversationId: string, messageId: string, accessToken: string): Promise<{ reactions: MessageReaction[] }> {
  return apiDelete(`/api/v1/conversations/${conversationId}/messages/${messageId}/reaction`, accessToken);
}

export interface ConversationWithOtherUser {
  id: string;
  createdAt: string;
  otherUser: { id: string; username: string; displayName: string; avatarMediaId?: string | null; verified?: boolean };
}

export function openConversation(username: string, accessToken: string): Promise<{ conversation: ConversationWithOtherUser }> {
  return apiPost(`/api/v1/users/${username}/conversation`, undefined, accessToken);
}

export interface GroupMember {
  userId: string;
  username: string;
  displayName: string;
  avatarMediaId: string | null;
  verified?: boolean;
  role: "admin" | "member";
  joinedAt: string;
}

/** A group as its members see it: name, people (admins first) and your own role. */
export interface GroupDetails {
  id: string;
  kind: "group";
  createdAt: string;
  title: string | null;
  otherUser: null;
  role: "admin" | "member";
  muted?: boolean;
  members: GroupMember[];
}

export const MAX_GROUP_MEMBERS = 32;
export const MAX_GROUP_TITLE = 60;

/** A new group with these people (at least two, besides you); you're its admin. */
export function createGroup(usernames: string[], title: string | null, accessToken: string): Promise<{ conversation: GroupDetails }> {
  return apiPost("/api/v1/conversations/groups", { usernames, ...(title ? { title } : {}) }, accessToken);
}

export function renameGroup(conversationId: string, title: string | null, accessToken: string): Promise<{ conversation: GroupDetails }> {
  return apiPatch(`/api/v1/conversations/${conversationId}`, { title }, accessToken);
}

export function addGroupMembers(conversationId: string, usernames: string[], accessToken: string): Promise<{ conversation: GroupDetails }> {
  return apiPost(`/api/v1/conversations/${conversationId}/members`, { usernames }, accessToken);
}

/** Admins only. */
export function removeGroupMember(conversationId: string, userId: string, accessToken: string): Promise<{ conversation: GroupDetails }> {
  return apiDelete(`/api/v1/conversations/${conversationId}/members/${userId}`, accessToken);
}

/** Unsend your own message, for everyone. */
export function unsendMessage(conversationId: string, messageId: string, accessToken: string): Promise<void> {
  return apiDelete(`/api/v1/conversations/${conversationId}/messages/${messageId}`, accessToken);
}

/** Mute (or unmute) a conversation's notifications, for you. */
export function setConversationMuted(conversationId: string, muted: boolean, accessToken: string): Promise<void> {
  return apiPut(`/api/v1/conversations/${conversationId}/mute`, { muted }, accessToken);
}

/** Delete a chat from your inbox (it comes back with the next message). */
export function hideConversation(conversationId: string, accessToken: string): Promise<void> {
  return apiPost(`/api/v1/conversations/${conversationId}/hide`, undefined, accessToken);
}

export function leaveGroup(conversationId: string, accessToken: string): Promise<void> {
  return apiPost(`/api/v1/conversations/${conversationId}/leave`, undefined, accessToken);
}

export function listConversations(
  accessToken: string,
  params: { limit?: number; offset?: number; q?: string } = {},
): Promise<{ conversations: ConversationSummary[]; limit: number; offset: number }> {
  // This app shows group chats (older ones are never sent any).
  const query = new URLSearchParams({ groups: "1" });
  if (params.limit) query.set("limit", String(params.limit));
  if (params.offset) query.set("offset", String(params.offset));
  if (params.q?.trim()) query.set("q", params.q.trim());
  return apiGet(`/api/v1/conversations?${query.toString()}`, accessToken);
}

/** One of your conversations by id (a push notification's link carries only the id). */
export function getConversation(conversationId: string, accessToken: string): Promise<{ conversation: (ConversationWithOtherUser & { kind?: "direct"; muted?: boolean }) | GroupDetails }> {
  return apiGet(`/api/v1/conversations/${encodeURIComponent(conversationId)}?groups=1`, accessToken);
}

/** A group's name, or its people's names when nobody named it ("Asha, Dev and 2 others"). */
export function groupName(title: string | null | undefined, people: Array<{ displayName: string }>, total?: number): string {
  if (title) return title;
  const names = people.slice(0, 2).map((p) => p.displayName.split(" ")[0] || p.displayName);
  const rest = (total ?? people.length) - names.length;
  if (!names.length) return "Group";
  return rest > 0 ? `${names.join(", ")} and ${rest} other${rest === 1 ? "" : "s"}` : names.join(" and ");
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
  input: { body?: string; storyId?: string; mediaId?: string; clientMessageId?: string; replyToMessageId?: string },
  accessToken: string,
): Promise<{ message: Message }> {
  return apiPost(`/api/v1/conversations/${conversationId}/messages`, input, accessToken);
}

/** "typing…" for the other person: the app sends it every few seconds while you type. */
export function sendTyping(conversationId: string, accessToken: string): Promise<void> {
  return apiPost(`/api/v1/conversations/${conversationId}/typing`, undefined, accessToken);
}

export function markConversationRead(conversationId: string, accessToken: string): Promise<void> {
  return apiPost(`/api/v1/conversations/${conversationId}/read`, undefined, accessToken);
}

/** A reply or quick reaction to a Story, delivered to its owner's DMs. */
export function replyToStory(
  storyId: string,
  input: { body: string } | { reaction: string },
  accessToken: string,
  clientMessageId?: string,
): Promise<{ message: Message; conversationId: string }> {
  return apiPost(`/api/v1/stories/${encodeURIComponent(storyId)}/replies`, { ...input, ...(clientMessageId ? { clientMessageId } : {}) }, accessToken);
}
