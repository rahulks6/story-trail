import { query, queryOne } from "../../db/psql";
import { verifiedSql } from "../../shared/verified";

/** Collab Stories (migration 0063): one invited collaborator per Story. */

export type CollabStatus = "pending" | "accepted" | "declined";

export interface CollabPerson {
  id: string;
  username: string;
  displayName: string;
  avatarMediaId: string | null;
  verified: boolean;
}

export interface CollabRecord {
  storyId: string;
  status: CollabStatus;
  /** Accepted, the collaborator's account active, and no block between the two creators. */
  live: boolean;
  owner: CollabPerson;
  collaborator: CollabPerson;
}

const SELECT = `
  SELECT sc.story_id, sc.status,
         EXISTS (SELECT 1 FROM story_collabs_live l WHERE l.story_id = sc.story_id) AS live,
         o.id AS o_id, o.username AS o_username, o.display_name AS o_display_name, o.avatar_media_id AS o_avatar, ${verifiedSql("o")} AS o_verified,
         c.id AS c_id, c.username AS c_username, c.display_name AS c_display_name, c.avatar_media_id AS c_avatar, ${verifiedSql("c")} AS c_verified
  FROM story_collaborators sc
  JOIN stories s ON s.id = sc.story_id
  JOIN users o ON o.id = s.owner_id
  JOIN users c ON c.id = sc.user_id AND c.is_active AND c.deleted_at IS NULL`;

function mapRow(r: Record<string, string | null>): CollabRecord {
  return {
    storyId: String(r.story_id),
    status: r.status as CollabStatus,
    live: r.live === "t",
    owner: { id: String(r.o_id), username: String(r.o_username), displayName: String(r.o_display_name), avatarMediaId: r.o_avatar ?? null, verified: r.o_verified === "t" },
    collaborator: { id: String(r.c_id), username: String(r.c_username), displayName: String(r.c_display_name), avatarMediaId: r.c_avatar ?? null, verified: r.c_verified === "t" },
  };
}

export async function findCollab(storyId: string): Promise<CollabRecord | null> {
  const row = await queryOne(`${SELECT} WHERE sc.story_id = :'story'`, { story: storyId });
  return row ? mapRow(row) : null;
}

/** Lists: every Story's collab in one query. */
export async function findCollabs(storyIds: string[]): Promise<Map<string, CollabRecord>> {
  if (storyIds.length === 0) return new Map();
  const rows = await query(`${SELECT} WHERE sc.story_id = ANY (string_to_array(:'ids', ',')::uuid[])`, { ids: storyIds.join(",") });
  return new Map(rows.map((r) => [String(r.story_id), mapRow(r)]));
}

/** The direct publish path's invitation (a Story published by the media worker gets it in SQL, migration 0063). */
export async function invite(storyId: string, userId: string): Promise<void> {
  await query(`INSERT INTO story_collaborators (story_id, user_id) VALUES (:'story', :'user') ON CONFLICT DO NOTHING`, { story: storyId, user: userId });
}

/** Answers a pending invitation; false when there was none to answer (already answered, withdrawn, someone else's). */
export async function respond(storyId: string, userId: string, status: "accepted" | "declined"): Promise<boolean> {
  const rows = await query(
    `UPDATE story_collaborators SET status = :'status', responded_at = now()
     WHERE story_id = :'story' AND user_id = :'user' AND status = 'pending'
     RETURNING 1 AS ok`,
    { story: storyId, user: userId, status },
  );
  return rows.length > 0;
}

/** The collaborator leaving an accepted collab: it becomes the owner's alone again. */
export async function leave(storyId: string, userId: string): Promise<boolean> {
  const rows = await query(
    `UPDATE story_collaborators SET status = 'declined', responded_at = now()
     WHERE story_id = :'story' AND user_id = :'user' AND status = 'accepted'
     RETURNING 1 AS ok`,
    { story: storyId, user: userId },
  );
  return rows.length > 0;
}

/** The owner removing the collaborator (or withdrawing an invitation). */
export async function remove(storyId: string): Promise<boolean> {
  const rows = await query(`DELETE FROM story_collaborators WHERE story_id = :'story' RETURNING 1 AS ok`, { story: storyId });
  return rows.length > 0;
}

/** Active Stories `userId` is the live collaborator on (their ring shows them beside their own). */
export async function listActiveCollabStoryIds(userId: string): Promise<string[]> {
  const rows = await query(
    `SELECT s.id FROM story_collabs_live l JOIN stories s ON s.id = l.story_id
     WHERE l.user_id = :'user' AND s.deleted_at IS NULL AND s.expires_at > now()
     ORDER BY s.created_at ASC`,
    { user: userId },
  );
  return rows.map((r) => String(r.id));
}

/**
 * Who the owner may invite: people who follow them or whom they follow, active, with no block
 * either way. `search` narrows by username or name; without it, the most recent first.
 */
export async function listInvitable(ownerId: string, search: string, limit: number): Promise<CollabPerson[]> {
  const rows = await query(
    `WITH related AS (
       SELECT followee_id AS id, created_at FROM follows WHERE follower_id = :'owner'
       UNION ALL
       SELECT follower_id AS id, created_at FROM follows WHERE followee_id = :'owner'),
     people AS (SELECT id, max(created_at) AS at FROM related GROUP BY id)
     SELECT u.id, u.username, u.display_name, u.avatar_media_id, ${verifiedSql("u")} AS verified
     FROM people p JOIN users u ON u.id = p.id
     WHERE u.is_active AND u.deleted_at IS NULL AND u.id <> :'owner'
       AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = :'owner' AND b.blocked_id = u.id) OR (b.blocker_id = u.id AND b.blocked_id = :'owner'))
       AND (:'search' = '' OR u.username ILIKE :'pattern' OR u.display_name ILIKE :'pattern')
     ORDER BY (:'search' <> '' AND lower(u.username) = lower(:'search')) DESC, p.at DESC, u.id
     LIMIT :'limit'`,
    { owner: ownerId, search, pattern: `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`, limit },
  );
  return rows.map((r) => ({ id: String(r.id), username: String(r.username), displayName: String(r.display_name), avatarMediaId: r.avatar_media_id ?? null, verified: r.verified === "t" }));
}

/** Whether `ownerId` may invite `userId`: one follows the other, both active, no block either way. */
export async function canInvite(ownerId: string, userId: string): Promise<boolean> {
  if (ownerId === userId) return false;
  const row = await queryOne(
    `SELECT (EXISTS (SELECT 1 FROM follows WHERE (follower_id = :'owner' AND followee_id = :'user') OR (follower_id = :'user' AND followee_id = :'owner'))
             AND EXISTS (SELECT 1 FROM users WHERE id = :'user' AND is_active AND deleted_at IS NULL)
             AND NOT EXISTS (SELECT 1 FROM blocks WHERE (blocker_id = :'owner' AND blocked_id = :'user') OR (blocker_id = :'user' AND blocked_id = :'owner'))) AS ok`,
    { owner: ownerId, user: userId },
  );
  return row?.ok === "t";
}
