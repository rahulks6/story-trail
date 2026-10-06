import { nullable, query, queryOne, type Row } from "../../db/psql";
import { containsPattern } from "../../shared/validation";

export interface ConversationRow {
  id: string;
  userAId: string;
  userBId: string;
  createdAt: string;
}

function mapConversationRow(row: Row): ConversationRow {
  return {
    id: row.id as string,
    userAId: row.user_a_id as string,
    userBId: row.user_b_id as string,
    createdAt: row.created_at as string,
  };
}

/** The canonical (a, b) ordering this schema's UNIQUE constraint expects — a < b, not caller order. */
function orderedPair(userIdA: string, userIdB: string): [string, string] {
  return userIdA < userIdB ? [userIdA, userIdB] : [userIdB, userIdA];
}

export async function findConversationBetween(userIdA: string, userIdB: string): Promise<ConversationRow | null> {
  const [a, b] = orderedPair(userIdA, userIdB);
  const row = await queryOne(
    `SELECT id, user_a_id, user_b_id, created_at FROM conversations WHERE user_a_id = :'a' AND user_b_id = :'b'`,
    { a, b },
  );
  return row ? mapConversationRow(row) : null;
}

export async function createConversation(userIdA: string, userIdB: string): Promise<ConversationRow> {
  const [a, b] = orderedPair(userIdA, userIdB);
  const rows = await query(
    `INSERT INTO conversations (user_a_id, user_b_id) VALUES (:'a', :'b')
     ON CONFLICT (user_a_id, user_b_id) DO NOTHING
     RETURNING id, user_a_id, user_b_id, created_at`,
    { a, b },
  );
  if (rows.length > 0) return mapConversationRow(rows[0]!);
  // Lost a create race against the other participant — the row now exists; fetch it.
  const existing = await findConversationBetween(a, b);
  if (!existing) throw new Error("Conversation not found immediately after a conflicting insert");
  return existing;
}

export async function findConversationById(id: string): Promise<ConversationRow | null> {
  const row = await queryOne(`SELECT id, user_a_id, user_b_id, created_at FROM conversations WHERE id = :'id'`, { id });
  return row ? mapConversationRow(row) : null;
}

export interface MessageRow {
  id: string;
  conversationId: string;
  senderId: string;
  body: string | null;
  sharedStoryId: string | null;
  createdAt: string;
  /** The sender's device id for the message; only ever shown to the sender (see conversations.service.ts). */
  clientMessageId?: string;
}

function mapMessageRow(row: Row): MessageRow {
  return {
    id: row.id as string,
    conversationId: row.conversation_id as string,
    senderId: row.sender_id as string,
    body: (row.body as string | null) ?? null,
    sharedStoryId: (row.shared_story_id as string | null) ?? null,
    createdAt: row.created_at as string,
    ...(row.client_message_id ? { clientMessageId: row.client_message_id as string } : {}),
  };
}

const MESSAGE_COLUMNS = "id, conversation_id, sender_id, body, shared_story_id, created_at, client_message_id";

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
): Promise<{ message: MessageRow; created: boolean }> {
  const row = await queryOne(
    `WITH m AS (
       INSERT INTO messages (conversation_id, sender_id, body, shared_story_id, client_message_id)
       VALUES (:'conversation_id', :'sender_id', ${nullable("body")}, ${nullable("shared_story_id", "uuid")}, ${nullable("client_message_id")})
       ON CONFLICT (conversation_id, sender_id, client_message_id) WHERE client_message_id IS NOT NULL DO NOTHING
       RETURNING ${MESSAGE_COLUMNS}),
     c AS (SELECT CASE WHEN user_a_id = :'sender_id' THEN user_b_id ELSE user_a_id END AS recipient_id
           FROM conversations WHERE id = :'conversation_id'),
     p AS (INSERT INTO push_outbox (user_id, kind, actor_id, ref_id)
           SELECT c.recipient_id, 'message', m.sender_id, m.conversation_id FROM m, c RETURNING id),
     n AS (SELECT pg_notify('realtime', json_build_object('u', json_build_array(m.sender_id, c.recipient_id),
             'e', json_build_object('type', 'message', 'conversationId', m.conversation_id, 'messageId', m.id,
                                    'senderId', m.sender_id, 'createdAt', m.created_at))::text) AS sent
           FROM m, c)
     SELECT m.*, (SELECT count(*) FROM p) AS queued, (SELECT count(*) FROM n) AS notified FROM m`,
    {
      conversation_id: conversationId, sender_id: senderId, body: body ?? "",
      shared_story_id: sharedStoryId ?? "", client_message_id: clientMessageId ?? "",
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
export async function listMessages(conversationId: string, limit: number, offset: number): Promise<MessageRow[]> {
  const rows = await query(
    `SELECT ${MESSAGE_COLUMNS}
     FROM messages
     WHERE conversation_id = :'conversation_id'
     ORDER BY created_at DESC, id DESC
     LIMIT :'limit' OFFSET :'offset'`,
    { conversation_id: conversationId, limit, offset },
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
): Promise<{ messages: MessageRow[]; hasMore: boolean }> {
  const older = "before" in cursor;
  const rows = await query(
    `SELECT ${MESSAGE_COLUMNS} FROM messages
     WHERE conversation_id = :'conversation_id'
       AND (created_at, id) ${older ? "<" : ">"} (SELECT created_at, id FROM messages WHERE id = :'cursor' AND conversation_id = :'conversation_id')
     ORDER BY created_at ${older ? "DESC" : "ASC"}, id ${older ? "DESC" : "ASC"}
     LIMIT :'limit'`,
    { conversation_id: conversationId, cursor: older ? cursor.before : cursor.after, limit: limit + 1 },
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
     other AS (
       SELECT CASE WHEN user_a_id = :'user_id' THEN user_b_id ELSE user_a_id END AS id FROM conversations WHERE id = :'conversation_id'),
     changed AS (
       SELECT 1 FROM messages m, other
       WHERE m.conversation_id = :'conversation_id' AND m.sender_id = other.id
         AND m.created_at > coalesce((SELECT ${read ? "last_read_at" : "last_delivered_at"} FROM prev), 'epoch')
       LIMIT 1)
     SELECT pg_notify('realtime', json_build_object('u', json_build_array(other.id, :'user_id'::uuid),
              'e', json_build_object('type', 'receipt', 'conversationId', :'conversation_id'::uuid, 'userId', :'user_id'::uuid,
                                     'lastReadAt', up.last_read_at, 'lastDeliveredAt', up.last_delivered_at))::text)
            ${read ? ", queue_badge_update(:'user_id')" : ""}
     FROM up, other WHERE EXISTS (SELECT 1 FROM changed)`,
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

const EPOCH = new Date(0).toISOString();

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

function mapConversationSummaryRow(row: Row): ConversationSummary {
  return {
    id: row.id as string,
    otherUser: {
      id: row.other_user_id as string,
      username: row.other_username as string,
      displayName: row.other_display_name as string,
    },
    lastMessage: row.last_message_id
      ? {
          id: row.last_message_id as string,
          senderId: row.last_message_sender_id as string,
          body: (row.last_message_body as string | null) ?? null,
          sharedStoryId: (row.last_message_shared_story_id as string | null) ?? null,
          createdAt: row.last_message_created_at as string,
        }
      : null,
    unread: row.is_unread === "t",
    createdAt: row.created_at as string,
  };
}

export async function listConversationsForUser(userId: string, limit: number, offset: number, search = ""): Promise<ConversationSummary[]> {
  const rows = await query(
    `SELECT
       c.id, c.created_at,
       ou.id AS other_user_id, ou.username AS other_username, ou.display_name AS other_display_name,
       lm.id AS last_message_id, lm.sender_id AS last_message_sender_id, lm.body AS last_message_body,
       lm.shared_story_id AS last_message_shared_story_id, lm.created_at AS last_message_created_at,
       (lm.created_at IS NOT NULL AND lm.created_at > COALESCE(cr.last_read_at, 'epoch')) AS is_unread
     FROM conversations c
     JOIN users ou ON ou.id = (CASE WHEN c.user_a_id = :'user_id' THEN c.user_b_id ELSE c.user_a_id END)
     LEFT JOIN LATERAL (
       SELECT id, sender_id, body, shared_story_id, created_at
       FROM messages m
       WHERE m.conversation_id = c.id
       ORDER BY m.created_at DESC
       LIMIT 1
     ) lm ON true
     LEFT JOIN conversation_reads cr ON cr.conversation_id = c.id AND cr.user_id = :'user_id'
     WHERE (c.user_a_id = :'user_id' OR c.user_b_id = :'user_id')
       AND (:'search' = '' OR ou.username::text ILIKE :'pattern' OR ou.display_name ILIKE :'pattern')
     ORDER BY COALESCE(lm.created_at, c.created_at) DESC
     LIMIT :'limit' OFFSET :'offset'`,
    { user_id: userId, limit, offset, search, pattern: containsPattern(search) },
  );
  return rows.map(mapConversationSummaryRow);
}

export async function countUnreadConversations(userId: string): Promise<number> {
  const row = await queryOne(
    `SELECT COUNT(*) AS n FROM (
       SELECT c.id
       FROM conversations c
       JOIN LATERAL (
         SELECT created_at FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1
       ) lm ON true
       LEFT JOIN conversation_reads cr ON cr.conversation_id = c.id AND cr.user_id = :'user_id'
       WHERE (c.user_a_id = :'user_id' OR c.user_b_id = :'user_id')
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
       WHERE m.conversation_id = :'conversation' AND (m.created_at, m.id) <= (t.created_at, t.id)
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
