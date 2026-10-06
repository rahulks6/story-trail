import { containsPattern } from "../../shared/validation";
import { nullable, query, queryOne } from "../../db/psql";

export interface UserRecord {
  id: string;
  username: string;
  email: string | null;
  passwordHash: string | null;
  displayName: string;
  bio: string;
  avatarMediaId: string | null;
  interests: string[];
  isPrivate: boolean;
  isActive: boolean;
  isModerator: boolean;
  createdAt: string;
}

const SELECT_COLUMNS = "id, username, email, password_hash, display_name, bio, avatar_media_id, interests_json, is_private, is_active, is_moderator, created_at";

function mapRow(row: Record<string, string | null>): UserRecord {
  return {
    id: row.id as string,
    username: row.username as string,
    email: row.email as string | null,
    passwordHash: row.password_hash as string | null,
    displayName: row.display_name as string,
    bio: row.bio as string,
    avatarMediaId: row.avatar_media_id as string | null,
    interests: (() => { try { const parsed = JSON.parse(row.interests_json ?? "[]"); return Array.isArray(parsed) && parsed.every((v) => typeof v === "string") ? parsed : []; } catch { return []; } })(),
    isPrivate: row.is_private === "t",
    isActive: row.is_active === "t",
    isModerator: row.is_moderator === "t",
    createdAt: row.created_at as string,
  };
}

export async function createUser(input: {
  username: string;
  email: string;
  passwordHash: string;
  displayName: string;
}): Promise<UserRecord> {
  const row = await queryOne(
    `INSERT INTO users (username, email, password_hash, display_name)
     VALUES (:'username', :'email', :'password_hash', :'display_name')
     RETURNING ${SELECT_COLUMNS}`,
    {
      username: input.username,
      email: input.email,
      password_hash: input.passwordHash,
      display_name: input.displayName,
    },
  );
  if (!row) throw new Error("Insert did not return a row");
  return mapRow(row);
}

export async function findUserByEmail(email: string): Promise<UserRecord | null> {
  const row = await queryOne(
    `SELECT ${SELECT_COLUMNS}
     FROM users
     WHERE email = :'email' AND deleted_at IS NULL`,
    { email },
  );
  return row ? mapRow(row) : null;
}

export async function findUserByUsername(username: string): Promise<UserRecord | null> {
  const row = await queryOne(
    `SELECT ${SELECT_COLUMNS}
     FROM users
     WHERE username = :'username' AND deleted_at IS NULL`,
    { username },
  );
  return row ? mapRow(row) : null;
}

export async function findUserById(id: string): Promise<UserRecord | null> {
  const row = await queryOne(
    `SELECT ${SELECT_COLUMNS}
     FROM users
     WHERE id = :'id' AND deleted_at IS NULL`,
    { id },
  );
  return row ? mapRow(row) : null;
}

export async function usernameOrEmailTaken(username: string, email: string): Promise<boolean> {
  const rows = await query(
    `SELECT id FROM users
     WHERE deleted_at IS NULL AND (username = :'username' OR email = :'email')
     LIMIT 1`,
    { username, email },
  );
  return rows.length > 0;
}

export async function usernameTaken(username: string, exceptUserId: string): Promise<boolean> {
  const row = await queryOne(
    `SELECT id FROM users
     WHERE deleted_at IS NULL AND username = :'username' AND id <> :'except_id'
     LIMIT 1`,
    { username, except_id: exceptUserId },
  );
  return row !== null;
}

/**
 * Updates only explicitly supplied fields atomically, preserving concurrent edits.
 * An explicit empty bio clears it; an omitted field remains unchanged.
 */
export async function setProfile(
  id: string,
  values: { username?: string; displayName?: string; bio?: string; isPrivate?: boolean; interests?: string[]; avatarMediaId?: string | null },
): Promise<UserRecord> {
  const row = await queryOne(
    `UPDATE users
     SET username = CASE WHEN :'has_username'::boolean THEN :'username' ELSE username END,
         display_name = CASE WHEN :'has_name'::boolean THEN :'display_name' ELSE display_name END,
         bio = CASE WHEN :'has_bio'::boolean THEN :'bio' ELSE bio END,
         interests_json = CASE WHEN :'has_interests'::boolean THEN :'interests_json' ELSE interests_json END,
         is_private = CASE WHEN :'has_private'::boolean THEN :'is_private'::boolean ELSE is_private END,
         avatar_media_id = CASE WHEN :'has_avatar'::boolean THEN ${nullable("avatar_media_id", "uuid")} ELSE avatar_media_id END
     WHERE id = :'id' AND deleted_at IS NULL
     RETURNING ${SELECT_COLUMNS}`,
    {
      id,
      username: values.username ?? '',
      display_name: values.displayName ?? '',
      bio: values.bio ?? '',
      interests_json: JSON.stringify(values.interests ?? []),
      avatar_media_id: values.avatarMediaId ?? null,
      is_private: values.isPrivate ?? false,
      has_username: values.username !== undefined,
      has_name: values.displayName !== undefined,
      has_bio: values.bio !== undefined,
      has_interests: values.interests !== undefined,
      has_private: values.isPrivate !== undefined,
      has_avatar: values.avatarMediaId !== undefined,
    },
  );
  if (!row) throw new Error("Update did not return a row");
  return mapRow(row);
}

/** Moderator-only action (see moderation.service.ts) — login and token refresh both already check isActive, so this is the one lever that actually enforces a suspension. */
export async function setActive(id: string, isActive: boolean): Promise<void> {
  await query(`UPDATE users SET is_active = :'is_active' WHERE id = :'id'`, { id, is_active: isActive });
}

/**
 * Self-service account deletion (see profiles.service.deleteMyAccount).
 * Every read in this file already filters `deleted_at IS NULL`, so this
 * alone makes the account unfindable by username/email/id (login,
 * lookups, search) immediately — the same mechanism Phase 4's soft
 * Story-delete and Phase 10's moderator suspension both already rely on.
 * It also frees the username/email for reuse, the same way any other
 * soft-deleted row here already does.
 */
export async function softDeleteUser(id: string): Promise<void> {
  await query(`UPDATE users SET deleted_at = now() WHERE id = :'id'`, { id });
}

export interface UserSearchResult {
  id: string;
  username: string;
  displayName: string;
  avatarMediaId: string | null;
  bio: string;
}

export async function searchUsers(
  searchTerm: string,
  excludeUserId: string,
  limit: number,
  offset: number,
): Promise<UserSearchResult[]> {
  const rows = await query(
    `SELECT u.id, u.username, u.display_name, u.avatar_media_id, u.bio
     FROM users u
     WHERE u.deleted_at IS NULL AND u.is_active
       AND u.id <> :'exclude_id'
       AND (u.username::text ILIKE :'pattern' OR u.display_name ILIKE :'pattern')
       AND NOT EXISTS (
         SELECT 1 FROM blocks b
         WHERE (b.blocker_id = :'exclude_id' AND b.blocked_id = u.id)
            OR (b.blocker_id = u.id AND b.blocked_id = :'exclude_id')
       )
     ORDER BY u.username ASC
     LIMIT :'limit' OFFSET :'offset'`,
    { exclude_id: excludeUserId, pattern: containsPattern(searchTerm), limit, offset },
  );
  return rows.map((row) => ({
    id: row.id as string,
    username: row.username as string,
    displayName: row.display_name as string,
    avatarMediaId: (row.avatar_media_id as string | null) ?? null,
    bio: row.bio as string,
  }));
}
