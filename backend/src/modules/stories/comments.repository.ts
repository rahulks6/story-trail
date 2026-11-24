import { query, queryOne, type Row } from "../../db/psql";
import { verifiedSql } from "../../shared/verified";

export interface CommentRecord {
  id: string;
  storyId: string;
  userId: string;
  username: string;
  displayName: string;
  avatarMediaId: string | null;
  verified: boolean;
  body: string;
  createdAt: string;
  /** The top-level comment this replies to, or null for a top-level comment. */
  parentId: string | null;
  likeCount: number;
  /** Whether the person asking has liked it (false where nobody asked). */
  likedByMe: boolean;
}

function mapRow(row: Row): CommentRecord {
  return {
    id: row.id as string,
    storyId: row.story_id as string,
    userId: row.user_id as string,
    username: row.username as string,
    displayName: row.display_name as string,
    avatarMediaId: (row.avatar_media_id as string | null) ?? null,
    verified: row.verified === "t",
    body: row.body as string,
    createdAt: row.created_at as string,
    parentId: (row.parent_id as string | null) ?? null,
    likeCount: Number(row.like_count ?? 0),
    likedByMe: row.liked_by_me === "t",
  };
}

/** Not deleted, and not a reply whose top-level comment was deleted or removed. */
const VISIBLE = `c.deleted_at IS NULL AND (c.parent_id IS NULL OR EXISTS (SELECT 1 FROM story_comments p WHERE p.id = c.parent_id AND p.deleted_at IS NULL))`;

export async function createComment(storyId: string, userId: string, body: string, parentId: string | null = null): Promise<CommentRecord> {
  const row = await queryOne(
    `WITH inserted AS (
       INSERT INTO story_comments (story_id, user_id, body, parent_id)
       VALUES (:'story_id', :'user_id', :'body', NULLIF(:'parent_id', '')::uuid)
       RETURNING id, story_id, user_id, body, created_at, parent_id
     )
     SELECT inserted.id, inserted.story_id, inserted.user_id, inserted.body, inserted.created_at, inserted.parent_id,
            0 AS like_count, false AS liked_by_me,
            u.username, u.display_name, u.avatar_media_id, ${verifiedSql("u")} AS verified
     FROM inserted JOIN users u ON u.id = inserted.user_id`,
    { story_id: storyId, user_id: userId, body, parent_id: parentId ?? "" },
  );
  if (!row) throw new Error("Insert did not return a row");
  return mapRow(row);
}

/**
 * Oldest first, replies among them (a reply is always newer than the comment it answers, so it
 * comes after it). Never comments from someone the viewer blocked or who blocked them, or from a
 * suspended account, nor replies whose top-level comment is gone.
 */
export async function listComments(storyId: string, limit: number, offset: number, viewerId = ""): Promise<CommentRecord[]> {
  const rows = await query(
    `SELECT c.id, c.story_id, c.user_id, c.body, c.created_at, c.parent_id, u.username, u.display_name, u.avatar_media_id, ${verifiedSql("u")} AS verified,
            (SELECT count(*) FROM comment_likes l JOIN users lu ON lu.id = l.user_id AND lu.deleted_at IS NULL AND lu.is_active WHERE l.comment_id = c.id) AS like_count,
            (:'viewer' <> '' AND EXISTS (SELECT 1 FROM comment_likes l WHERE l.comment_id = c.id AND l.user_id::text = :'viewer')) AS liked_by_me
     FROM story_comments c
     JOIN users u ON u.id = c.user_id
     WHERE c.story_id = :'story_id' AND ${VISIBLE} AND u.deleted_at IS NULL AND u.is_active
       AND (:'viewer' = '' OR NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id::text = :'viewer' AND b.blocked_id = c.user_id)
                                                                 OR (b.blocker_id = c.user_id AND b.blocked_id::text = :'viewer')))
     ORDER BY c.created_at ASC, c.id ASC
     LIMIT :'limit' OFFSET :'offset'`,
    { story_id: storyId, limit, offset, viewer: viewerId },
  );
  return rows.map(mapRow);
}

export async function countComments(storyId: string): Promise<number> {
  const row = await queryOne(
    `SELECT COUNT(*) AS n FROM story_comments c WHERE c.story_id = :'story_id' AND ${VISIBLE}`,
    { story_id: storyId },
  );
  return Number(row?.n ?? 0);
}

interface CommentOwnership {
  id: string;
  storyId: string;
  userId: string;
  storyOwnerId: string;
  parentId: string | null;
}

export async function findCommentWithStoryOwner(commentId: string): Promise<CommentOwnership | null> {
  const row = await queryOne(
    `SELECT c.id, c.story_id, c.user_id, c.parent_id, s.owner_id AS story_owner_id
     FROM story_comments c
     JOIN stories s ON s.id = c.story_id
     WHERE c.id = :'id' AND ${VISIBLE}`,
    { id: commentId },
  );
  if (!row) return null;
  return {
    id: row.id as string,
    storyId: row.story_id as string,
    userId: row.user_id as string,
    storyOwnerId: row.story_owner_id as string,
    parentId: (row.parent_id as string | null) ?? null,
  };
}

/** How many times this viewer has commented on this creator's Stories, ever — a real "meaningful reply" signal for recommendation scoring (spec section 7). */
export async function countCommentsByUserOnCreator(viewerId: string, creatorId: string): Promise<number> {
  const row = await queryOne(
    `SELECT COUNT(*) AS n FROM story_comments c
     JOIN stories s ON s.id = c.story_id
     WHERE c.user_id = :'viewer_id' AND s.owner_id = :'creator_id' AND c.deleted_at IS NULL`,
    { viewer_id: viewerId, creator_id: creatorId },
  );
  return Number(row?.n ?? 0);
}

/** Deleting a comment takes its replies with it. */
export async function softDeleteComment(commentId: string): Promise<void> {
  await query(`UPDATE story_comments SET deleted_at = now() WHERE (id = :'id' OR parent_id = :'id') AND deleted_at IS NULL`, { id: commentId });
}

/** True when this is a new like. */
export async function likeComment(commentId: string, userId: string): Promise<boolean> {
  const rows = await query(
    `INSERT INTO comment_likes (comment_id, user_id) VALUES (:'comment', :'user') ON CONFLICT DO NOTHING RETURNING comment_id`,
    { comment: commentId, user: userId },
  );
  return rows.length > 0;
}

export async function unlikeComment(commentId: string, userId: string): Promise<void> {
  await query(`DELETE FROM comment_likes WHERE comment_id = :'comment' AND user_id = :'user'`, { comment: commentId, user: userId });
}

export interface CommentModerationView {
  id: string;
  storyId: string;
  userId: string;
  username: string;
  displayName: string;
  body: string;
  createdAt: string;
  deletedAt: string | null;
}

/**
 * Unlike findCommentWithStoryOwner, deliberately doesn't filter out an
 * already-deleted comment — moderation.service.ts's queue needs to show
 * what a report was actually about even after the comment itself has
 * since been removed (by its author, the Story's owner, or an earlier
 * moderation action).
 */
export async function findCommentForModeration(commentId: string): Promise<CommentModerationView | null> {
  const row = await queryOne(
    `SELECT c.id, c.story_id, c.user_id, c.body, c.created_at, c.deleted_at, u.username, u.display_name
     FROM story_comments c
     JOIN users u ON u.id = c.user_id
     WHERE c.id = :'id'`,
    { id: commentId },
  );
  if (!row) return null;
  return {
    id: row.id as string,
    storyId: row.story_id as string,
    userId: row.user_id as string,
    username: row.username as string,
    displayName: row.display_name as string,
    body: row.body as string,
    createdAt: row.created_at as string,
    deletedAt: row.deleted_at ?? null,
  };
}
