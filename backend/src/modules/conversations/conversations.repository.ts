import { nullable, query, queryOne, type Row } from "../../db/psql";
import { containsPattern } from "../../shared/validation";

export type ConversationKind = "direct" | "group";

const EPOCH = new Date(0).toISOString();

export interface ConversationRow {
  id: string;
  kind: ConversationKind;
  /** 1:1 conversations only (null for a group). */
  userAId: string | null;
  userBId: string | null;
  /** A group's name; null for a 1:1 conversation (and for a group nobody named). */
  title: string | null;
  createdAt: string;
}

const CONVERSATION_COLUMNS = "id, kind, user_a_id, user_b_id, title, created_at";

function mapConversationRow(row: Row): ConversationRow {
  return {
    id: row.id as string,
    kind: (row.kind as ConversationKind) ?? "direct",
    userAId: (row.user_a_id as string | null) ?? null,
    userBId: (row.user_b_id as string | null) ?? null,
    title: (row.title as string | null) ?? null,
    createdAt: row.created_at as string,
  };
}

/** Everyone still in a conversation, as a JSON array of ids (realtime recipients). */
const ACTIVE_MEMBERS_JSON = (conversation: string) =>
  `(SELECT coalesce(json_agg(cm.user_id), '[]'::json) FROM conversation_members cm WHERE cm.conversation_id = ${conversation} AND cm.left_at IS NULL)`;

export interface Membership {
  role: "admin" | "member";
  joinedAt: string;
}

/** The viewer's place in a conversation, or null when they aren't (or are no longer) in it. */
export async function findActiveMembership(conversationId: string, userId: string): Promise<Membership | null> {
  const row = await queryOne(
    `SELECT role, joined_at FROM conversation_members WHERE conversation_id = :'c' AND user_id = :'u' AND left_at IS NULL`,
    { c: conversationId, u: userId },
  );
  return row ? { role: row.role as Membership["role"], joinedAt: row.joined_at as string } : null;
}

export interface MemberRow {
  userId: string;
  username: string;
  displayName: string;
  avatarMediaId: string | null;
  role: "admin" | "member";
  joinedAt: string;
}

/** The people in a conversation now, admins first, then by when they joined. */
export async function listActiveMembers(conversationId: string): Promise<MemberRow[]> {
  const rows = await query(
    `SELECT u.id, u.username, u.display_name, u.avatar_media_id, cm.role, cm.joined_at
     FROM conversation_members cm JOIN users u ON u.id = cm.user_id
     WHERE cm.conversation_id = :'c' AND cm.left_at IS NULL
     ORDER BY cm.role = 'admin' DESC, cm.joined_at, u.username`,
    { c: conversationId },
  );
  return rows.map((r) => ({
    userId: r.id as string, username: r.username as string, displayName: r.display_name as string,
    avatarMediaId: (r.avatar_media_id as string | null) ?? null, role: r.role as MemberRow["role"], joinedAt: r.joined_at as string,
  }));
}

/** The canonical (a, b) ordering this schema's UNIQUE constraint expects — a < b, not caller order. */
function orderedPair(userIdA: string, userIdB: string): [string, string] {
  return userIdA < userIdB ? [userIdA, userIdB] : [userIdB, userIdA];
}

export async function findConversationBetween(userIdA: string, userIdB: string): Promise<ConversationRow | null> {
  const [a, b] = orderedPair(userIdA, userIdB);
  const row = await queryOne(
    `SELECT ${CONVERSATION_COLUMNS} FROM conversations WHERE user_a_id = :'a' AND user_b_id = :'b'`,
    { a, b },
  );
  return row ? mapConversationRow(row) : null;
}

export async function createConversation(userIdA: string, userIdB: string): Promise<ConversationRow> {
  const [a, b] = orderedPair(userIdA, userIdB);
  const rows = await query(
    `INSERT INTO conversations (user_a_id, user_b_id) VALUES (:'a', :'b')
     ON CONFLICT (user_a_id, user_b_id) DO NOTHING
     RETURNING ${CONVERSATION_COLUMNS}`,
    { a, b },
  );
  if (rows.length > 0) return mapConversationRow(rows[0]!);
  // Lost a create race against the other participant — the row now exists; fetch it.
  const existing = await findConversationBetween(a, b);
  if (!existing) throw new Error("Conversation not found immediately after a conflicting insert");
  return existing;
}

export async function findConversationById(id: string): Promise<ConversationRow | null> {
  const row = await queryOne(`SELECT ${CONVERSATION_COLUMNS} FROM conversations WHERE id = :'id'`, { id });
  return row ? mapConversationRow(row) : null;
}

export interface MessageRow {
  id: string;
  conversationId: string;
  senderId: string;
  body: string | null;
  sharedStoryId: string | null;
  /**
   * Set when the message answers a Story (a reply or a quick reaction from its viewer).
   * `storyId` becomes null once that Story is deleted; the message stays a reply.
   */
  storyReply: StoryReply | null;
  /** A photo or video sent in the message; null once that media has been purged. */
  media: MessageMedia | null;
  /** Each participant's reaction (long-press, like Instagram), oldest first. */
  reactions: MessageReaction[];
  /** The message this one replies to (swipe to reply), quoted; null once that message is gone. */
  replyTo: QuotedMessage | null;
  /** Set on a group's "what happened" line (someone was added, left, renamed it); no text then. */
  event: GroupEvent | null;
  createdAt: string;
  /** The sender's device id for the message; only ever shown to the sender (see conversations.service.ts). */
  clientMessageId?: string;
}

export type StoryReplyKind = "reply" | "reaction";

/** A line in a group's thread about the group itself. `userIds` are who was added or removed. */
export type GroupEvent =
  | { type: "created"; title: string | null }
  | { type: "added"; userIds: string[] }
  | { type: "removed"; userIds: string[] }
  | { type: "left" }
  | { type: "renamed"; title: string | null };
export interface MessageMedia {
  id: string;
  kind: "photo" | "video" | "audio";
  width: number | null;
  height: number | null;
  durationMs: number | null;
}

function parseMessageMedia(raw: unknown): MessageMedia | null {
  if (!raw) return null;
  const m = (typeof raw === "string" ? JSON.parse(raw) : raw) as Record<string, unknown>;
  return { id: m.id as string, kind: m.kind as MessageMedia["kind"], width: (m.width as number | null) ?? null, height: (m.height as number | null) ?? null, durationMs: (m.durationMs as number | null) ?? null };
}
export interface StoryReply {
  storyId: string | null;
  kind: StoryReplyKind;
}

/** Enough of a replied-to message to quote it above the reply. */
export interface QuotedMessage {
  id: string;
  senderId: string;
  /** The start of its text, if it has any. */
  body: string | null;
  mediaKind: MessageMedia["kind"] | null;
  sharedStory: boolean;
}

/** How much of a replied-to message's text a quote carries. */
export const QUOTE_LENGTH = 160;

function parseQuote(raw: unknown): QuotedMessage | null {
  if (!raw) return null;
  const q = (typeof raw === "string" ? JSON.parse(raw) : raw) as Record<string, unknown>;
  return {
    id: q.id as string,
    senderId: q.senderId as string,
    body: (q.body as string | null) ?? null,
    mediaKind: (q.mediaKind as QuotedMessage["mediaKind"]) ?? null,
    sharedStory: q.sharedStory === true,
  };
}

export interface MessageReaction {
  userId: string;
  emoji: string;
}

function parseReactions(raw: unknown): MessageReaction[] {
  if (!raw) return [];
  const list = (typeof raw === "string" ? JSON.parse(raw) : raw) as MessageReaction[];
  return Array.isArray(list) ? list : [];
}

function mapMessageRow(row: Row): MessageRow {
  return {
    id: row.id as string,
    conversationId: row.conversation_id as string,
    senderId: row.sender_id as string,
    body: (row.body as string | null) ?? null,
    sharedStoryId: (row.shared_story_id as string | null) ?? null,
    storyReply: row.reply_kind ? { storyId: (row.reply_story_id as string | null) ?? null, kind: row.reply_kind as StoryReplyKind } : null,
    media: parseMessageMedia(row.media_json),
    reactions: parseReactions(row.reactions_json),
    replyTo: parseQuote(row.reply_to_json),
    event: row.event ? ((typeof row.event === "string" ? JSON.parse(row.event) : row.event) as GroupEvent) : null,
    createdAt: row.created_at as string,
    ...(row.client_message_id ? { clientMessageId: row.client_message_id as string } : {}),
  };
}

// The attached media's shape travels with the message, so a thread renders without a lookup per photo.
const MESSAGE_COLUMNS = `id, conversation_id, sender_id, body, shared_story_id, created_at, client_message_id, reply_story_id, reply_kind, media_id, event,
  (SELECT json_build_object('id', md.id, 'kind', md.kind, 'width', md.width, 'height', md.height, 'durationMs', md.duration_ms)
     FROM media md WHERE md.id = messages.media_id AND md.purged_at IS NULL) AS media_json,
  (SELECT coalesce(json_agg(json_build_object('userId', r.user_id, 'emoji', r.emoji) ORDER BY r.created_at), '[]')
     FROM message_reactions r WHERE r.message_id = messages.id) AS reactions_json,
  (SELECT json_build_object('id', q.id, 'senderId', q.sender_id, 'body', left(q.body, ${QUOTE_LENGTH}),
                            'mediaKind', qm.kind, 'sharedStory', q.shared_story_id IS NOT NULL)
     FROM messages q LEFT JOIN media qm ON qm.id = q.media_id AND qm.purged_at IS NULL
     WHERE q.id = messages.reply_to_message_id) AS reply_to_json`;

/**
 * Inserts a message, or — when `clientMessageId` was already used by this sender in
 * this conversation (a retried send) — returns the original instead of a duplicate.
 * The push to the recipient and the realtime event to both participants are written
 * in the same statement, so they exist only for a message that was really created.
 */
export async function createMessage(
  conversationId: string,
  senderId: string,
  body: string | null,
  sharedStoryId: string | null,
  clientMessageId: string | null = null,
  storyReply: { storyId: string; kind: StoryReplyKind } | null = null,
  mediaId: string | null = null,
  replyToMessageId: string | null = null,
): Promise<{ message: MessageRow; created: boolean }> {
  const row = await queryOne(
    `WITH m AS (
       INSERT INTO messages (conversation_id, sender_id, body, shared_story_id, client_message_id, reply_story_id, reply_kind, media_id, reply_to_message_id)
       VALUES (:'conversation_id', :'sender_id', ${nullable("body")}, ${nullable("shared_story_id", "uuid")}, ${nullable("client_message_id")},
               ${nullable("reply_story_id", "uuid")}, ${nullable("reply_kind")}, ${nullable("media_id", "uuid")},
               -- Only ever a message in this same conversation.
               (SELECT id FROM messages WHERE id = ${nullable("reply_to", "uuid")} AND conversation_id = :'conversation_id'))
       ON CONFLICT (conversation_id, sender_id, client_message_id) WHERE client_message_id IS NOT NULL DO NOTHING
       RETURNING ${MESSAGE_COLUMNS}),
     conv AS (SELECT kind, title FROM conversations WHERE id = :'conversation_id'),
     -- Everyone else still in the conversation gets the push; a group's says which group.
     c AS (SELECT cm.user_id AS recipient_id FROM conversation_members cm
           WHERE cm.conversation_id = :'conversation_id' AND cm.left_at IS NULL AND cm.user_id <> :'sender_id'),
     p AS (INSERT INTO push_outbox (user_id, kind, actor_id, ref_id, body, link)
           SELECT c.recipient_id, 'message', m.sender_id, m.conversation_id,
                  CASE WHEN conv.kind = 'group' THEN
                    '@' || (SELECT username FROM users WHERE id = m.sender_id) || ' sent a message in ' || coalesce(conv.title, 'your group') END,
                  CASE WHEN conv.kind = 'group' THEN 'katkee://conversation/' || m.conversation_id END
           FROM m, c, conv RETURNING id),
     n AS (SELECT pg_notify('realtime', json_build_object('u', ${ACTIVE_MEMBERS_JSON(":'conversation_id'")},
             'e', json_build_object('type', 'message', 'conversationId', m.conversation_id, 'messageId', m.id,
                                    'senderId', m.sender_id, 'createdAt', m.created_at))::text) AS sent
           FROM m)
     SELECT m.*, (SELECT count(*) FROM p) AS queued, (SELECT count(*) FROM n) AS notified FROM m`,
    {
      conversation_id: conversationId, sender_id: senderId, body: body ?? "",
      shared_story_id: sharedStoryId ?? "", client_message_id: clientMessageId ?? "",
      reply_story_id: storyReply?.storyId ?? "", reply_kind: storyReply?.kind ?? "", media_id: mediaId ?? "",
      reply_to: replyToMessageId ?? "",
    },
  );
  if (row) {
    await markRead(conversationId, senderId);
    return { message: mapMessageRow(row), created: true };
  }
  const existing = clientMessageId ? await findMessageByClientId(conversationId, senderId, clientMessageId) : null;
  if (!existing) throw new Error("Message insert returned no row");
  return { message: existing, created: false };
}

/**
 * Writes a group's "what happened" line (created, added, removed, left, renamed) and tells
 * everyone in the group, including anyone just removed, so their app drops the thread.
 */
export async function createGroupEvent(conversationId: string, actorId: string, event: GroupEvent, alsoNotify: string[] = []): Promise<MessageRow> {
  const row = await queryOne(
    `WITH m AS (
       INSERT INTO messages (conversation_id, sender_id, event) VALUES (:'c', :'actor', :'event'::jsonb)
       RETURNING ${MESSAGE_COLUMNS}),
     n AS (SELECT pg_notify('realtime', json_build_object(
             'u', (${ACTIVE_MEMBERS_JSON(":'c'")})::jsonb || :'extra'::jsonb,
             'e', json_build_object('type', 'message', 'conversationId', m.conversation_id, 'messageId', m.id,
                                    'senderId', m.sender_id, 'createdAt', m.created_at))::text) FROM m)
     SELECT m.*, (SELECT count(*) FROM n) AS notified FROM m`,
    { c: conversationId, actor: actorId, event: JSON.stringify(event), extra: JSON.stringify(alsoNotify) },
  );
  return mapMessageRow(row!);
}

/** Whether a message is in this conversation (what a reply may quote). */
export async function messageInConversation(conversationId: string, messageId: string): Promise<boolean> {
  const row = await queryOne(`SELECT 1 AS ok FROM messages WHERE id = :'id' AND conversation_id = :'conversation_id' AND event IS NULL`, { id: messageId, conversation_id: conversationId });
  return !!row;
}

/** Whether `viewerId` is in a conversation where this media was sent: they may see it. */
export async function canAccessMediaViaMessage(mediaId: string, viewerId: string): Promise<boolean> {
  const row = await queryOne(
    `SELECT 1 AS ok FROM messages m JOIN conversations c ON c.id = m.conversation_id
     WHERE m.media_id = :'media' AND (c.user_a_id = :'viewer' OR c.user_b_id = :'viewer') LIMIT 1`,
    { media: mediaId, viewer: viewerId },
  );
  return !!row;
}

export async function findMessageByClientId(conversationId: string, senderId: string, clientMessageId: string): Promise<MessageRow | null> {
  const row = await queryOne(
    `SELECT ${MESSAGE_COLUMNS} FROM messages
     WHERE conversation_id = :'conversation_id' AND sender_id = :'sender_id' AND client_message_id = :'client_message_id'`,
    { conversation_id: conversationId, sender_id: senderId, client_message_id: clientMessageId },
  );
  return row ? mapMessageRow(row) : null;
}

/**
 * Newest first, unlike comments' oldest-first listing — a chat thread's
 * default page should be the latest activity, not the start of a
 * potentially months-old conversation. Callers reverse for top-to-bottom
 * display.
 */
export async function listMessages(conversationId: string, limit: number, offset: number, since: string = EPOCH): Promise<MessageRow[]> {
  const rows = await query(
    `SELECT ${MESSAGE_COLUMNS}
     FROM messages
     WHERE conversation_id = :'conversation_id' AND created_at >= :'since'::timestamptz
     ORDER BY created_at DESC, id DESC
     LIMIT :'limit' OFFSET :'offset'`,
    { conversation_id: conversationId, limit, offset, since },
  );
  return rows.map(mapMessageRow);
}

/**
 * Keyset pages that don't shift while new messages arrive: `before` returns older
 * messages than the cursor message, `after` the next newer ones (what a client asks
 * for when a realtime event says something new arrived). Always newest first.
 */
export async function listMessagesByCursor(
  conversationId: string,
  cursor: { before: string } | { after: string },
  limit: number,
  since: string = EPOCH,
): Promise<{ messages: MessageRow[]; hasMore: boolean }> {
  const older = "before" in cursor;
  const rows = await query(
    `SELECT ${MESSAGE_COLUMNS} FROM messages
     WHERE conversation_id = :'conversation_id' AND created_at >= :'since'::timestamptz
       AND (created_at, id) ${older ? "<" : ">"} (SELECT created_at, id FROM messages WHERE id = :'cursor' AND conversation_id = :'conversation_id')
     ORDER BY created_at ${older ? "DESC" : "ASC"}, id ${older ? "DESC" : "ASC"}
     LIMIT :'limit'`,
    { conversation_id: conversationId, cursor: older ? cursor.before : cursor.after, limit: limit + 1, since },
  );
  const page = rows.slice(0, limit).map(mapMessageRow);
  return { messages: older ? page : page.reverse(), hasMore: rows.length > limit };
}

/**
 * Moves a participant's read/delivered watermarks forward and, when that changed what
 * the other participant sees (one of their messages became delivered/read), tells both
 * participants' devices in realtime. A read that cleared an unread conversation also
 * sends the reader's iPhones their new badge (migration 0036).
 */
async function advanceWatermarks(conversationId: string, userId: string, read: boolean): Promise<void> {
  await query(
    `WITH prev AS (
       SELECT last_read_at, last_delivered_at FROM conversation_reads WHERE conversation_id = :'conversation_id' AND user_id = :'user_id'),
     up AS (
       INSERT INTO conversation_reads (conversation_id, user_id, last_read_at, last_delivered_at)
       VALUES (:'conversation_id', :'user_id', ${read ? "now()" : "'epoch'"}, now())
       ON CONFLICT (conversation_id, user_id) DO UPDATE SET
         last_read_at = ${read ? "now()" : "conversation_reads.last_read_at"},
         last_delivered_at = GREATEST(conversation_reads.last_delivered_at, now())
       RETURNING last_read_at, last_delivered_at),
     changed AS (
       SELECT 1 FROM messages m
       WHERE m.conversation_id = :'conversation_id' AND m.sender_id <> :'user_id' AND m.event IS NULL
         AND m.created_at > coalesce((SELECT ${read ? "last_read_at" : "last_delivered_at"} FROM prev), 'epoch')
       LIMIT 1)
     SELECT pg_notify('realtime', json_build_object('u', ${ACTIVE_MEMBERS_JSON(":'conversation_id'")},
              'e', json_build_object('type', 'receipt', 'conversationId', :'conversation_id'::uuid, 'userId', :'user_id'::uuid,
                                     'lastReadAt', up.last_read_at, 'lastDeliveredAt', up.last_delivered_at))::text)
            ${read ? ", queue_badge_update(:'user_id')" : ""}
     FROM up WHERE EXISTS (SELECT 1 FROM changed)`,
    { conversation_id: conversationId, user_id: userId },
  );
}

/** Reading obviously implies delivery too, so this bumps both watermarks. */
export function markRead(conversationId: string, userId: string): Promise<void> {
  return advanceWatermarks(conversationId, userId, true);
}

/**
 * Bumped whenever a participant's client successfully fetches messages
 * (see conversations.service.ts's listMessages) — the recipient's app actually
 * received the data on a real fetch, not just "the server has it" (that's `sent`).
 */
export function markDelivered(conversationId: string, userId: string): Promise<void> {
  return advanceWatermarks(conversationId, userId, false);
}

export interface ReadState {
  lastReadAt: string;
  lastDeliveredAt: string;
}

/** Everyone else's watermarks in a conversation (a group's "Seen by"), by user id. */
export async function getOthersReadState(conversationId: string, userId: string): Promise<Map<string, ReadState>> {
  const rows = await query(
    `SELECT cm.user_id, coalesce(r.last_read_at, 'epoch') AS last_read_at, coalesce(r.last_delivered_at, 'epoch') AS last_delivered_at
     FROM conversation_members cm
     LEFT JOIN conversation_reads r ON r.conversation_id = cm.conversation_id AND r.user_id = cm.user_id
     WHERE cm.conversation_id = :'c' AND cm.left_at IS NULL AND cm.user_id <> :'u'`,
    { c: conversationId, u: userId },
  );
  return new Map(rows.map((r) => [r.user_id as string, { lastReadAt: r.last_read_at as string, lastDeliveredAt: r.last_delivered_at as string }]));
}

/** A participant's own read/delivered watermarks — defaults to epoch (never read, never delivered) if they've never fetched or read this conversation at all. */
export async function getReadState(conversationId: string, userId: string): Promise<ReadState> {
  const row = await queryOne(
    `SELECT last_read_at, last_delivered_at FROM conversation_reads WHERE conversation_id = :'conversation_id' AND user_id = :'user_id'`,
    { conversation_id: conversationId, user_id: userId },
  );
  return {
    lastReadAt: (row?.last_read_at as string) ?? EPOCH,
    lastDeliveredAt: (row?.last_delivered_at as string) ?? EPOCH,
  };
}

export interface PersonSummary { id: string; username: string; displayName: string; avatarMediaId: string | null }

export interface ConversationSummary {
  id: string;
  kind: ConversationKind;
  /** The other person in a 1:1 conversation; null for a group. */
  otherUser: PersonSummary | null;
  /** A group's name (null if nobody named it), size, and up to three of the others, for its picture. */
  group?: { title: string | null; memberCount: number; members: PersonSummary[] };
  lastMessage: {
    id: string;
    senderId: string;
    /** Who sent it, for a group's preview ("asha: see you at 8"). */
    senderUsername?: string;
    body: string | null;
    sharedStoryId: string | null;
    /** "photo" or "video" when the last message carried one (the inbox shows "Sent a photo"). */
    mediaKind?: "photo" | "video" | "audio" | null;
    event?: GroupEvent | null;
    createdAt: string;
  } | null;
  unread: boolean;
  createdAt: string;
}

function mapConversationSummaryRow(row: Row): ConversationSummary {
  const group = row.kind === "group";
  return {
    id: row.id as string,
    kind: group ? "group" : "direct",
    otherUser: group ? null : {
      id: row.other_user_id as string,
      username: row.other_username as string,
      displayName: row.other_display_name as string,
      avatarMediaId: (row.other_avatar_media_id as string | null) ?? null,
    },
    ...(group ? { group: {
      title: (row.title as string | null) ?? null,
      memberCount: Number(row.member_count ?? 0),
      members: (typeof row.member_preview === "string" ? JSON.parse(row.member_preview) : row.member_preview ?? []) as PersonSummary[],
    } } : {}),
    lastMessage: row.last_message_id
      ? {
          id: row.last_message_id as string,
          senderId: row.last_message_sender_id as string,
          body: (row.last_message_body as string | null) ?? null,
          sharedStoryId: (row.last_message_shared_story_id as string | null) ?? null,
          mediaKind: (row.last_message_media_kind as "photo" | "video" | "audio" | null) ?? null,
          ...(group ? { senderUsername: row.last_message_sender_username as string } : {}),
          event: row.last_message_event ? ((typeof row.last_message_event === "string" ? JSON.parse(row.last_message_event) : row.last_message_event) as GroupEvent) : null,
          createdAt: row.last_message_created_at as string,
        }
      : null,
    unread: row.is_unread === "t",
    createdAt: row.created_at as string,
  };
}

/**
 * The viewer's conversations, latest activity first. Groups are listed only to apps that
 * show them (`includeGroups`): an older app expects one other person in every conversation.
 */
export async function listConversationsForUser(userId: string, limit: number, offset: number, search = "", includeGroups = false): Promise<ConversationSummary[]> {
  const rows = await query(
    `SELECT
       c.id, c.created_at, c.kind, c.title,
       ou.id AS other_user_id, ou.username AS other_username, ou.display_name AS other_display_name, ou.avatar_media_id AS other_avatar_media_id,
       lm.id AS last_message_id, lm.sender_id AS last_message_sender_id, lm.body AS last_message_body, lm.event AS last_message_event,
       (SELECT username FROM users WHERE id = lm.sender_id) AS last_message_sender_username,
       lm.shared_story_id AS last_message_shared_story_id, lm.created_at AS last_message_created_at, lm.media_kind AS last_message_media_kind,
       (lm.created_at IS NOT NULL AND lm.created_at > COALESCE(cr.last_read_at, 'epoch')) AS is_unread,
       CASE WHEN c.kind = 'group' THEN (SELECT count(*) FROM conversation_members g WHERE g.conversation_id = c.id AND g.left_at IS NULL) END AS member_count,
       CASE WHEN c.kind = 'group' THEN (
         SELECT coalesce(json_agg(json_build_object('id', p.id, 'username', p.username, 'displayName', p.display_name, 'avatarMediaId', p.avatar_media_id)), '[]'::json)
         FROM (SELECT u.id, u.username, u.display_name, u.avatar_media_id FROM conversation_members g JOIN users u ON u.id = g.user_id
               WHERE g.conversation_id = c.id AND g.left_at IS NULL AND g.user_id <> :'user_id' ORDER BY g.joined_at, u.username LIMIT 3) p) END AS member_preview
     FROM conversation_members me
     JOIN conversations c ON c.id = me.conversation_id
     LEFT JOIN users ou ON c.kind = 'direct' AND ou.id = (CASE WHEN c.user_a_id = :'user_id' THEN c.user_b_id ELSE c.user_a_id END)
     LEFT JOIN LATERAL (
       SELECT id, sender_id, body, shared_story_id, created_at, event,
              (SELECT md.kind FROM media md WHERE md.id = m.media_id) AS media_kind
       FROM messages m
       WHERE m.conversation_id = c.id AND m.created_at >= me.joined_at
       ORDER BY m.created_at DESC
       LIMIT 1
     ) lm ON true
     LEFT JOIN conversation_reads cr ON cr.conversation_id = c.id AND cr.user_id = :'user_id'
     WHERE me.user_id = :'user_id' AND me.left_at IS NULL
       AND (c.kind = 'direct' OR :'groups' = '1')
       AND (:'search' = '' OR ou.username::text ILIKE :'pattern' OR ou.display_name ILIKE :'pattern' OR c.title ILIKE :'pattern'
            OR (c.kind = 'group' AND EXISTS (SELECT 1 FROM conversation_members g JOIN users u ON u.id = g.user_id
                  WHERE g.conversation_id = c.id AND g.left_at IS NULL AND g.user_id <> :'user_id'
                    AND (u.username::text ILIKE :'pattern' OR u.display_name ILIKE :'pattern'))))
     ORDER BY COALESCE(lm.created_at, c.created_at) DESC
     LIMIT :'limit' OFFSET :'offset'`,
    { user_id: userId, limit, offset, search, pattern: containsPattern(search), groups: includeGroups ? "1" : "" },
  );
  return rows.map(mapConversationSummaryRow);
}

export async function countUnreadConversations(userId: string): Promise<number> {
  const row = await queryOne(
    `SELECT COUNT(*) AS n FROM (
       SELECT c.id
       FROM conversation_members me
       JOIN conversations c ON c.id = me.conversation_id
       JOIN LATERAL (
         SELECT created_at FROM messages m WHERE m.conversation_id = c.id AND m.created_at >= me.joined_at ORDER BY m.created_at DESC LIMIT 1
       ) lm ON true
       LEFT JOIN conversation_reads cr ON cr.conversation_id = c.id AND cr.user_id = :'user_id'
       WHERE me.user_id = :'user_id' AND me.left_at IS NULL
         AND lm.created_at > COALESCE(cr.last_read_at, 'epoch')
     ) unread_conversations`,
    { user_id: userId },
  );
  return Number(row?.n ?? 0);
}

/**
 * A participant reports a message the other person sent. The report (against that person,
 * source `direct_message`) carries a snapshot of the reported message and up to nine
 * messages before it, for context. That snapshot is all moderators can ever see of the
 * conversation (see admin/moderation-admin.ts). A repeat report against the same person
 * while one is open adds its evidence to that report instead of opening another.
 */
export async function reportMessage(input: {
  reporterId: string;
  otherId: string;
  conversationId: string;
  messageId: string;
  reason: string;
  details: string | null;
}): Promise<{ found: boolean; reportId: string | null; created: boolean; attached: number }> {
  const row = await queryOne(
    `WITH target AS (
       SELECT m.id, m.created_at FROM messages m
       WHERE m.id = :'message' AND m.conversation_id = :'conversation' AND m.sender_id = :'other'),
     evidence AS (
       SELECT m.id, m.conversation_id, m.sender_id, m.body, m.shared_story_id, m.created_at
       FROM messages m, target t
       WHERE m.conversation_id = :'conversation' AND m.event IS NULL AND (m.created_at, m.id) <= (t.created_at, t.id)
       ORDER BY m.created_at DESC, m.id DESC LIMIT 10),
     created AS (
       INSERT INTO reports (reporter_id, target_type, target_id, reason, details, source)
       SELECT :'reporter', 'user', :'other', :'reason', NULLIF(:'details', ''), 'direct_message' FROM target
       ON CONFLICT DO NOTHING RETURNING id),
     report AS (
       SELECT id, true AS created FROM created
       UNION ALL
       SELECT r.id, false FROM reports r, target
       WHERE NOT EXISTS (SELECT 1 FROM created) AND r.reporter_id = :'reporter' AND r.target_type = 'user'
         AND r.target_id = :'other' AND r.status IN ('OPEN', 'UNDER_REVIEW')),
     marked AS (
       UPDATE reports SET source = 'direct_message', updated_at = now()
       WHERE id IN (SELECT id FROM report WHERE NOT created) AND source <> 'direct_message' RETURNING id),
     attached AS (
       INSERT INTO report_message_evidence (report_id, message_id, conversation_id, sender_id, body, shared_story_id, sent_at)
       SELECT report.id, e.id, e.conversation_id, e.sender_id, e.body, e.shared_story_id, e.created_at FROM report, evidence e
       ON CONFLICT DO NOTHING RETURNING 1)
     SELECT EXISTS (SELECT 1 FROM target) AS found, (SELECT id FROM report LIMIT 1) AS report_id,
            coalesce((SELECT created FROM report LIMIT 1), false) AS created,
            (SELECT count(*) FROM attached) AS attached, (SELECT count(*) FROM marked) AS marked`,
    {
      reporter: input.reporterId, other: input.otherId, conversation: input.conversationId,
      message: input.messageId, reason: input.reason, details: input.details ?? "",
    },
  );
  return {
    found: row?.found === "t",
    reportId: (row?.report_id as string | null) ?? null,
    created: row?.created === "t",
    attached: Number(row?.attached ?? 0),
  };
}

/**
 * Sets (or with null, removes) the reactor's reaction to a message in this conversation, and tells
 * both participants in realtime. Adding one to the other person's message queues them a push.
 * Returns the message's reactions, or null when the message isn't in this conversation.
 */
export async function setMessageReaction(conversationId: string, messageId: string, userId: string, emoji: string | null, since: string = EPOCH): Promise<MessageReaction[] | null> {
  const row = await queryOne(
    `WITH m AS (SELECT id, sender_id FROM messages
                WHERE id = :'message' AND conversation_id = :'conversation' AND event IS NULL AND created_at >= :'since'::timestamptz),
     removed AS (DELETE FROM message_reactions r USING m WHERE :'emoji' = '' AND r.message_id = m.id AND r.user_id = :'user' RETURNING r.message_id),
     saved AS (
       INSERT INTO message_reactions (message_id, user_id, emoji)
       SELECT m.id, :'user', :'emoji' FROM m WHERE :'emoji' <> ''
       ON CONFLICT (message_id, user_id) DO UPDATE SET emoji = EXCLUDED.emoji, created_at = now()
       RETURNING message_id),
     pushed AS (
       INSERT INTO push_outbox (user_id, kind, actor_id, ref_id, body, link)
       SELECT m.sender_id, 'message_reaction', :'user', :'conversation',
              '@' || (SELECT username FROM users WHERE id = :'user') || ' reacted ' || :'emoji' || ' to your message',
              'katkee://conversation/' || :'conversation'
       FROM m, saved WHERE m.sender_id <> :'user'
         AND EXISTS (SELECT 1 FROM conversation_members cm WHERE cm.conversation_id = :'conversation' AND cm.user_id = m.sender_id AND cm.left_at IS NULL)
       RETURNING id),
     notified AS (
       SELECT pg_notify('realtime', json_build_object(
         'u', ${ACTIVE_MEMBERS_JSON(":'conversation'")},
         'e', json_build_object('type', 'reaction', 'conversationId', :'conversation', 'messageId', m.id, 'userId', :'user', 'emoji', NULLIF(:'emoji', ''))
       )::text) FROM m)
     SELECT (SELECT count(*) FROM m) AS found, (SELECT count(*) FROM notified) AS sent`,
    { conversation: conversationId, message: messageId, user: userId, emoji: emoji ?? "", since },
  );
  if (!row || Number(row.found) === 0) return null;
  const rows = await query(
    `SELECT user_id, emoji FROM message_reactions WHERE message_id = :'message' ORDER BY created_at`,
    { message: messageId },
  );
  return rows.map((r) => ({ userId: r.user_id as string, emoji: r.emoji as string }));
}
