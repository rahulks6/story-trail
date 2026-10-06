import { containsPattern, escapeLike } from "../../shared/validation";
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

function parseInterests(json: string | null | undefined): string[] {
  try {
    const parsed = JSON.parse(json ?? "[]");
    return Array.isArray(parsed) && parsed.every((v) => typeof v === "string") ? parsed : [];
  } catch {
    return [];
  }
}

function mapRow(row: Record<string, string | null>): UserRecord {
  return {
    id: row.id as string,
    username: row.username as string,
    email: row.email as string | null,
    passwordHash: row.password_hash as string | null,
    displayName: row.display_name as string,
    bio: row.bio as string,
    avatarMediaId: row.avatar_media_id as string | null,
    interests: parseInterests(row.interests_json),
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

/** The signed-in person's relationship to someone in a list of people. */
export interface ListRelationship {
  isFollowing: boolean;
  isFollowedBy: boolean;
  hasPendingRequestFromViewer: boolean;
}

export interface UserSearchResult {
  id: string;
  username: string;
  displayName: string;
  avatarMediaId: string | null;
  bio: string;
  isPrivate: boolean;
  interests: string[];
  viewer: ListRelationship;
}

/** Shorter terms can't use the trigram indexes (pg_trgm needs three characters). */
const SHORT_TERM = 3;

/**
 * People search (spec section 10): username, display name or an interest contains the term.
 * Best matches first: the exact username, then names that start with the term, then a later
 * word of the display name, then anywhere in a name, then interests; within each, people the
 * searcher follows first, then by username (so pages are stable). A one- or two-letter term
 * lists usernames that start with it, then every other match, each alphabetically, read in
 * index order so a common letter stays cheap. Blocked either way, suspended and deleted
 * accounts never appear, nor does the searcher.
 */
export async function searchUsers(
  searchTerm: string,
  excludeUserId: string,
  limit: number,
  offset: number,
  options: { followingOnly?: boolean } = {},
): Promise<UserSearchResult[]> {
  const escaped = escapeLike(searchTerm);
  const columns = `u.id, u.username, u.display_name, u.avatar_media_id, u.bio, u.is_private, u.interests_json,
              (vf.followee_id IS NOT NULL) AS is_following`;
  const from = `FROM users u LEFT JOIN follows vf ON vf.follower_id = :'exclude_id' AND vf.followee_id = u.id`;
  const visible = `u.deleted_at IS NULL AND u.is_active AND u.id <> :'exclude_id'
         AND (NOT :'following_only'::boolean OR vf.followee_id IS NOT NULL)
         AND NOT EXISTS (
           SELECT 1 FROM blocks b
           WHERE (b.blocker_id = :'exclude_id' AND b.blocked_id = u.id)
              OR (b.blocker_id = u.id AND b.blocked_id = :'exclude_id')
         )`;
  const matches = `(u.username::text ILIKE :'pattern' OR u.display_name ILIKE :'pattern'
              -- The JSON text narrows the search (and can use an index); each interest is then
              -- checked on its own, so the array's quotes and commas never match.
              OR (u.interests_json ILIKE :'json_pattern'
                  AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(u.interests_json::jsonb) AS i(name) WHERE i.name ILIKE :'pattern')))`;
  const startsWith = `lower(u.username::text) COLLATE "C" LIKE :'lower_prefix'`;
  const page = searchTerm.length >= SHORT_TERM
    ? `SELECT ranked.*, row_number() OVER (ORDER BY ranked.rank, ranked.is_following DESC, ranked.sort_key) AS position
       FROM (
         SELECT ${columns}, u.username::text AS sort_key,
                CASE
                  WHEN u.username = :'term' THEN 0
                  WHEN u.username::text ILIKE :'prefix' THEN 1
                  WHEN u.display_name ILIKE :'prefix' THEN 2
                  WHEN u.display_name ILIKE :'word_prefix' THEN 3
                  WHEN u.username::text ILIKE :'pattern' OR u.display_name ILIKE :'pattern' THEN 4
                  ELSE 5
                END AS rank
         ${from}
         WHERE ${visible} AND ${matches}
         ORDER BY rank, is_following DESC, u.username
         LIMIT :'limit' OFFSET :'offset'
       ) ranked`
    : `SELECT short.*, row_number() OVER (ORDER BY short.rank, short.sort_key) AS position
       FROM (
         (SELECT ${columns}, lower(u.username::text) COLLATE "C" AS sort_key, 1 AS rank
          ${from}
          WHERE ${visible} AND ${startsWith}
          ORDER BY sort_key LIMIT :'window')
         UNION ALL
         (SELECT ${columns}, lower(u.username::text) COLLATE "C" AS sort_key, 4 AS rank
          ${from}
          WHERE ${visible} AND NOT ${startsWith} AND ${matches}
          ORDER BY sort_key LIMIT :'window')
       ) short
       ORDER BY short.rank, short.sort_key
       LIMIT :'limit' OFFSET :'offset'`;
  const rows = await query(
    `WITH page AS (${page})
     SELECT p.*,
            EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = p.id AND f.followee_id = :'exclude_id') AS is_followed_by,
            EXISTS (SELECT 1 FROM follow_requests r
                    WHERE r.requester_id = :'exclude_id' AND r.target_id = p.id AND r.status = 'pending') AS requested
     FROM page p
     ORDER BY p.position`,
    {
      exclude_id: excludeUserId,
      term: searchTerm,
      prefix: `${escaped}%`,
      lower_prefix: `${escapeLike(searchTerm.toLowerCase())}%`,
      word_prefix: `% ${escaped}%`,
      pattern: containsPattern(searchTerm),
      // As the term appears inside the stored JSON text (quotes and backslashes escaped).
      json_pattern: containsPattern(JSON.stringify(searchTerm).slice(1, -1)),
      following_only: options.followingOnly === true,
      limit,
      offset,
      // Each short-term list needs this many rows for the requested page.
      window: limit + offset,
    },
  );
  return rows.map((row) => ({
    id: row.id as string,
    username: row.username as string,
    displayName: row.display_name as string,
    avatarMediaId: (row.avatar_media_id as string | null) ?? null,
    bio: row.bio as string,
    isPrivate: row.is_private === "t",
    interests: parseInterests(row.interests_json),
    viewer: {
      isFollowing: row.is_following === "t",
      isFollowedBy: row.is_followed_by === "t",
      hasPendingRequestFromViewer: row.requested === "t",
    },
  }));
}

/** Why someone is suggested: only facts the person asking can already see. */
export type SuggestionReason =
  | { kind: "follows_you" }
  | { kind: "followed_by"; username: string; others: number }
  | { kind: "shared_interest"; interest: string }
  | { kind: "new" };

export interface SuggestedPerson {
  id: string;
  username: string;
  displayName: string;
  avatarMediaId: string | null;
  isPrivate: boolean;
  reason: SuggestionReason;
  viewer: ListRelationship;
}

/**
 * "Suggested for you" before typing in Search (spec section 10). In order: people who follow
 * you; people followed by people you follow (whose follows you can already see); people who
 * share an interest (interests are public on profiles); then new public accounts with a public
 * Story up now. Never suggests yourself, anyone you follow or have asked to follow, anyone
 * blocked either way, muted, marked "not interested", restricted, suspended or deleted. Each
 * source is bounded, so the cost doesn't grow with the size of the network.
 */
export async function suggestPeople(viewerId: string, limit: number): Promise<SuggestedPerson[]> {
  const rows = await query(
    `WITH viewer_interests AS MATERIALIZED (
       SELECT array(SELECT jsonb_array_elements_text(lower(interests_json)::jsonb)) AS keys FROM users WHERE id = :'viewer'
     ),
     follows_you AS (
       SELECT f.follower_id AS id, f.created_at FROM follows f
       WHERE f.followee_id = :'viewer' ORDER BY f.created_at DESC LIMIT 200
     ),
     friends AS (
       SELECT f.followee_id AS id, m.username FROM follows f
       JOIN users m ON m.id = f.followee_id AND m.deleted_at IS NULL AND m.is_active
       WHERE f.follower_id = :'viewer' ORDER BY f.created_at DESC LIMIT 200
     ),
     mutual AS (
       SELECT c.followee_id AS id, count(*) AS n, min(fr.username::text) AS via
       FROM friends fr
       CROSS JOIN LATERAL (SELECT followee_id FROM follows WHERE follower_id = fr.id ORDER BY created_at DESC LIMIT 200) c
       GROUP BY c.followee_id
     ),
     shared AS (
       SELECT u.id,
              (SELECT count(*) FROM jsonb_array_elements_text(lower(u.interests_json)::jsonb) AS k(key) WHERE k.key = ANY (vi.keys)) AS n,
              (SELECT i.name FROM jsonb_array_elements_text(u.interests_json::jsonb) AS i(name) WHERE lower(i.name) = ANY (vi.keys) LIMIT 1) AS via
       FROM viewer_interests vi
       JOIN users u ON lower(u.interests_json)::jsonb ?| vi.keys
       WHERE cardinality(vi.keys) > 0 AND u.id <> :'viewer'
         AND u.deleted_at IS NULL AND u.is_active AND u.moderation_state = 'ACTIVE'
         AND NOT EXISTS (SELECT 1 FROM follows WHERE follower_id = :'viewer' AND followee_id = u.id)
       ORDER BY u.created_at DESC LIMIT 300
     ),
     fresh AS (
       SELECT DISTINCT s.owner_id AS id FROM stories s
       WHERE s.deleted_at IS NULL AND s.moderation_removed_at IS NULL AND s.audience = 'public' AND s.expires_at > now()
     ),
     candidates AS (
       SELECT id FROM follows_you UNION SELECT id FROM mutual UNION SELECT id FROM shared UNION SELECT id FROM fresh
     )
     SELECT u.id, u.username, u.display_name, u.avatar_media_id, u.is_private,
            (fy.id IS NOT NULL) AS follows_viewer, m.n AS mutual_count, m.via AS mutual_via,
            s.n AS shared_count, s.via AS shared_via
     FROM candidates c
     JOIN users u ON u.id = c.id
     LEFT JOIN follows_you fy ON fy.id = u.id
     LEFT JOIN mutual m ON m.id = u.id
     LEFT JOIN shared s ON s.id = u.id
     LEFT JOIN fresh f ON f.id = u.id
     WHERE u.id <> :'viewer' AND u.deleted_at IS NULL AND u.is_active AND u.moderation_state = 'ACTIVE'
       AND NOT EXISTS (SELECT 1 FROM follows WHERE follower_id = :'viewer' AND followee_id = u.id)
       AND NOT EXISTS (SELECT 1 FROM follow_requests WHERE requester_id = :'viewer' AND target_id = u.id AND status = 'pending')
       AND NOT EXISTS (SELECT 1 FROM blocks
                       WHERE (blocker_id = :'viewer' AND blocked_id = u.id) OR (blocker_id = u.id AND blocked_id = :'viewer'))
       AND NOT EXISTS (SELECT 1 FROM mutes WHERE muter_id = :'viewer' AND muted_id = u.id)
       AND NOT EXISTS (SELECT 1 FROM creator_not_interested WHERE viewer_id = :'viewer' AND creator_id = u.id)
       AND (fy.id IS NOT NULL OR m.id IS NOT NULL OR s.id IS NOT NULL
            OR (f.id IS NOT NULL AND NOT u.is_private AND u.created_at > now() - interval '30 days'))
     ORDER BY CASE WHEN fy.id IS NOT NULL THEN 0 WHEN m.id IS NOT NULL THEN 1 WHEN s.id IS NOT NULL THEN 2 ELSE 3 END,
              m.n DESC NULLS LAST, s.n DESC NULLS LAST, fy.created_at DESC NULLS LAST, u.created_at DESC, u.username
     LIMIT :'limit'`,
    { viewer: viewerId, limit },
  );
  return rows.map((row) => {
    const mutual = Number(row.mutual_count ?? 0);
    const reason: SuggestionReason = row.follows_viewer === "t" ? { kind: "follows_you" }
      : mutual > 0 ? { kind: "followed_by", username: row.mutual_via as string, others: mutual - 1 }
      : row.shared_via ? { kind: "shared_interest", interest: row.shared_via }
      : { kind: "new" };
    return {
      id: row.id as string,
      username: row.username as string,
      displayName: row.display_name as string,
      avatarMediaId: (row.avatar_media_id as string | null) ?? null,
      isPrivate: row.is_private === "t",
      reason,
      viewer: { isFollowing: false, isFollowedBy: row.follows_viewer === "t", hasPendingRequestFromViewer: false },
    };
  });
}
