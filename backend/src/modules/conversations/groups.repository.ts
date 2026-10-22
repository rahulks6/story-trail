import { query, queryOne } from "../../db/psql";

export interface AddableCheck {
  username: string;
  userId: string | null;
  /** Why this person can't be added, if they can't. */
  problem: "not_found" | "self" | "blocked" | "not_connected" | null;
}

/**
 * Who of these usernames `viewerId` may put in a group: someone real, not themselves, with no
 * block either way, and connected by a follow in either direction (so a stranger can't be
 * pulled into a group). Unknown names come back as not_found.
 */
export async function checkAddable(viewerId: string, usernames: string[]): Promise<AddableCheck[]> {
  const rows = await query(
    `SELECT n.username, u.id,
            EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = u.id AND b.blocked_id = :'v') OR (b.blocker_id = :'v' AND b.blocked_id = u.id)) AS blocked,
            EXISTS (SELECT 1 FROM follows f WHERE (f.follower_id = u.id AND f.followee_id = :'v') OR (f.follower_id = :'v' AND f.followee_id = u.id)) AS connected
     FROM unnest(string_to_array(:'names', ',')) AS n(username)
     LEFT JOIN users u ON u.username = n.username AND u.deleted_at IS NULL AND u.is_active`,
    { v: viewerId, names: usernames.join(",") },
  );
  return rows.map((r) => {
    const userId = (r.id as string | null) ?? null;
    const problem = !userId ? "not_found" : userId === viewerId ? "self" : r.blocked === "t" ? "blocked" : r.connected !== "t" ? "not_connected" : null;
    return { username: r.username as string, userId, problem };
  });
}

/** A new group with its maker as admin and these people in it. */
export async function createGroup(creatorId: string, title: string | null, memberIds: string[]): Promise<string> {
  const row = await queryOne(
    `WITH c AS (INSERT INTO conversations (kind, title, created_by) VALUES ('group', NULLIF(:'title', ''), :'creator') RETURNING id),
     m AS (INSERT INTO conversation_members (conversation_id, user_id, role, added_by)
           SELECT c.id, :'creator'::uuid, 'admin', :'creator'::uuid FROM c
           UNION ALL
           SELECT c.id, x::uuid, 'member', :'creator'::uuid FROM c, unnest(string_to_array(:'members', ',')) AS x
           RETURNING 1)
     SELECT id, (SELECT count(*) FROM m) AS n FROM c`,
    { creator: creatorId, title: title ?? "", members: memberIds.join(",") },
  );
  return row!.id as string;
}

export async function countActiveMembers(conversationId: string): Promise<number> {
  const row = await queryOne(`SELECT count(*) AS n FROM conversation_members WHERE conversation_id = :'c' AND left_at IS NULL`, { c: conversationId });
  return Number(row?.n ?? 0);
}

/** Adds people (or brings back people who left); returns who actually joined now. */
export async function addMembers(conversationId: string, adderId: string, userIds: string[]): Promise<string[]> {
  const rows = await query(
    `INSERT INTO conversation_members (conversation_id, user_id, role, added_by)
     SELECT :'c'::uuid, x::uuid, 'member', :'adder'::uuid FROM unnest(string_to_array(:'ids', ',')) AS x
     ON CONFLICT (conversation_id, user_id) DO UPDATE SET left_at = NULL, joined_at = now(), role = 'member', added_by = EXCLUDED.added_by
       WHERE conversation_members.left_at IS NOT NULL
     RETURNING user_id`,
    { c: conversationId, adder: adderId, ids: userIds.join(",") },
  );
  return rows.map((r) => r.user_id as string);
}

/**
 * Takes someone out of a group (they left, or an admin removed them). If no admin is left,
 * whoever has been in the group longest becomes one, so it can always be looked after.
 */
export async function removeMember(conversationId: string, userId: string): Promise<boolean> {
  const row = await queryOne(
    `WITH gone AS (UPDATE conversation_members SET left_at = now(), role = 'member'
                   WHERE conversation_id = :'c' AND user_id = :'u' AND left_at IS NULL RETURNING user_id)
     SELECT count(*) AS n FROM gone`,
    { c: conversationId, u: userId },
  );
  await query(
    `UPDATE conversation_members SET role = 'admin'
     WHERE conversation_id = :'c' AND left_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM conversation_members WHERE conversation_id = :'c' AND left_at IS NULL AND role = 'admin')
       AND user_id = (SELECT user_id FROM conversation_members WHERE conversation_id = :'c' AND left_at IS NULL ORDER BY joined_at, user_id LIMIT 1)`,
    { c: conversationId },
  );
  return Number(row?.n ?? 0) > 0;
}

export async function renameGroup(conversationId: string, title: string | null): Promise<void> {
  await query(`UPDATE conversations SET title = NULLIF(:'title', '') WHERE id = :'c' AND kind = 'group'`, { c: conversationId, title: title ?? "" });
}

/** The sender of a message in this conversation (null if it isn't one, or is a group's event line). */
export async function messageSender(conversationId: string, messageId: string): Promise<string | null> {
  const row = await queryOne(`SELECT sender_id FROM messages WHERE id = :'m' AND conversation_id = :'c' AND event IS NULL`, { m: messageId, c: conversationId });
  return (row?.sender_id as string | null) ?? null;
}
