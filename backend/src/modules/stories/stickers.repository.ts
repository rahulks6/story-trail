import { query, queryOne } from "../../db/psql";
import { verifiedSql } from "../../shared/verified";
import { VISIBLE_STORY_SQL } from "./audience";

/**
 * What viewers do with a Story's interactive stickers (migration 0062). Access rules are the
 * service's (stickers.service.ts); everything here is scoped to one Story and sticker id.
 */

export interface StickerActivity {
  /** "<stickerId>:<option>" → votes, from active accounts only. */
  counts: Record<string, number>;
  /** stickerId → the option this viewer chose. */
  mine: Record<string, number>;
  /** Question stickers this viewer has answered. */
  answered: string[];
  /** stickerId → answers received (the owner's Insights). */
  responses: Record<string, number>;
  /** Countdown stickers this viewer asked to be reminded about. */
  reminded: string[];
  /** stickerId → people who asked to be reminded. */
  reminders: Record<string, number>;
}

const parseJson = <T>(raw: string | null | undefined, fallback: T): T => {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

/** Everything a viewer's copy of one Story's stickers needs, in one round trip. */
export async function stickerActivity(storyId: string, viewerId: string): Promise<StickerActivity> {
  const row = await queryOne(
    `SELECT
       (SELECT coalesce(jsonb_object_agg(k, n), '{}'::jsonb) FROM (
          SELECT v.sticker_id || ':' || v.option_index AS k, count(*) AS n
          FROM story_sticker_votes v JOIN users u ON u.id = v.voter_id AND u.is_active AND u.deleted_at IS NULL
          WHERE v.story_id = :'story' GROUP BY v.sticker_id, v.option_index) c) AS counts,
       (SELECT coalesce(jsonb_object_agg(sticker_id, option_index), '{}'::jsonb)
          FROM story_sticker_votes WHERE story_id = :'story' AND voter_id = :'viewer') AS mine,
       (SELECT coalesce(jsonb_agg(DISTINCT sticker_id), '[]'::jsonb)
          FROM story_question_responses WHERE story_id = :'story' AND responder_id = :'viewer') AS answered,
       (SELECT coalesce(jsonb_object_agg(sticker_id, n), '{}'::jsonb) FROM (
          SELECT sticker_id, count(*) AS n FROM story_question_responses WHERE story_id = :'story' GROUP BY sticker_id) q) AS responses,
       (SELECT coalesce(jsonb_agg(sticker_id), '[]'::jsonb)
          FROM story_countdown_reminders WHERE story_id = :'story' AND user_id = :'viewer') AS reminded,
       (SELECT coalesce(jsonb_object_agg(sticker_id, n), '{}'::jsonb) FROM (
          SELECT sticker_id, count(*) AS n FROM story_countdown_reminders WHERE story_id = :'story' GROUP BY sticker_id) r) AS reminders`,
    { story: storyId, viewer: viewerId },
  );
  return {
    counts: parseJson(row?.counts, {}),
    mine: parseJson(row?.mine, {}),
    answered: parseJson(row?.answered, []),
    responses: parseJson(row?.responses, {}),
    reminded: parseJson(row?.reminded, []),
    reminders: parseJson(row?.reminders, {}),
  };
}

/** False when this person had already answered (the primary key keeps it to one, even when two taps race). */
export async function insertVote(storyId: string, stickerId: string, voterId: string, option: number): Promise<boolean> {
  const rows = await query(
    `INSERT INTO story_sticker_votes (story_id, sticker_id, voter_id, option_index)
     VALUES (:'story', :'sticker', :'voter', :'option')
     ON CONFLICT (story_id, sticker_id, voter_id) DO NOTHING
     RETURNING 1 AS ok`,
    { story: storyId, sticker: stickerId, voter: voterId, option },
  );
  return rows.length > 0;
}

export async function findVote(storyId: string, stickerId: string, voterId: string): Promise<number | null> {
  const row = await queryOne(
    `SELECT option_index FROM story_sticker_votes WHERE story_id = :'story' AND sticker_id = :'sticker' AND voter_id = :'voter'`,
    { story: storyId, sticker: stickerId, voter: voterId },
  );
  return row ? Number(row.option_index) : null;
}

export interface StickerVoter {
  id: string;
  username: string;
  displayName: string;
  avatarMediaId: string | null;
  verified: boolean;
  option: number;
  votedAt: string;
}

/** Owner-only (enforced in stickers.service.ts): who answered a poll or quiz, and what. */
export async function listVoters(storyId: string, stickerId: string, ownerId: string, limit: number, offset: number): Promise<StickerVoter[]> {
  const rows = await query(
    `SELECT u.id, u.username, u.display_name, u.avatar_media_id, ${verifiedSql("u")} AS verified, v.option_index, v.created_at
     FROM story_sticker_votes v
     JOIN users u ON u.id = v.voter_id AND u.is_active AND u.deleted_at IS NULL
     WHERE v.story_id = :'story' AND v.sticker_id = :'sticker'
       AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = :'owner' AND b.blocked_id = u.id) OR (b.blocker_id = u.id AND b.blocked_id = :'owner'))
     ORDER BY v.created_at DESC, u.id
     LIMIT :'limit' OFFSET :'offset'`,
    { story: storyId, sticker: stickerId, owner: ownerId, limit, offset },
  );
  return rows.map((r) => ({
    id: String(r.id),
    username: String(r.username),
    displayName: String(r.display_name),
    avatarMediaId: r.avatar_media_id ?? null,
    verified: r.verified === "t",
    option: Number(r.option_index),
    votedAt: String(r.created_at),
  }));
}

export async function insertQuestionResponse(storyId: string, stickerId: string, responderId: string, body: string): Promise<{ id: string; createdAt: string }> {
  const row = await queryOne(
    `INSERT INTO story_question_responses (story_id, sticker_id, responder_id, body)
     VALUES (:'story', :'sticker', :'responder', :'body')
     RETURNING id, created_at`,
    { story: storyId, sticker: stickerId, responder: responderId, body },
  );
  if (!row) throw new Error("Insert did not return a row");
  return { id: String(row.id), createdAt: String(row.created_at) };
}

/** How many answers this person has sent to one question sticker. */
export async function countOwnResponses(storyId: string, stickerId: string, responderId: string): Promise<number> {
  const row = await queryOne(
    `SELECT count(*) AS n FROM story_question_responses WHERE story_id = :'story' AND sticker_id = :'sticker' AND responder_id = :'responder'`,
    { story: storyId, sticker: stickerId, responder: responderId },
  );
  return Number(row?.n ?? 0);
}

export interface QuestionResponse {
  id: string;
  body: string;
  createdAt: string;
  responder: { id: string; username: string; displayName: string; avatarMediaId: string | null; verified: boolean };
}

/** Owner-only (enforced in stickers.service.ts): the answers, newest first, from people the owner hasn't blocked. */
export async function listQuestionResponses(storyId: string, stickerId: string, ownerId: string, limit: number, offset: number): Promise<QuestionResponse[]> {
  const rows = await query(
    `SELECT r.id, r.body, r.created_at, u.id AS user_id, u.username, u.display_name, u.avatar_media_id, ${verifiedSql("u")} AS verified
     FROM story_question_responses r
     JOIN users u ON u.id = r.responder_id AND u.is_active AND u.deleted_at IS NULL
     WHERE r.story_id = :'story' AND r.sticker_id = :'sticker'
       AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = :'owner' AND b.blocked_id = u.id) OR (b.blocker_id = u.id AND b.blocked_id = :'owner'))
     ORDER BY r.created_at DESC, r.id
     LIMIT :'limit' OFFSET :'offset'`,
    { story: storyId, sticker: stickerId, owner: ownerId, limit, offset },
  );
  return rows.map((r) => ({
    id: String(r.id),
    body: String(r.body),
    createdAt: String(r.created_at),
    responder: { id: String(r.user_id), username: String(r.username), displayName: String(r.display_name), avatarMediaId: r.avatar_media_id ?? null, verified: r.verified === "t" },
  }));
}

/** The owner can clear an answer they don't want to keep. */
export async function deleteQuestionResponse(storyId: string, responseId: string): Promise<boolean> {
  const rows = await query(`DELETE FROM story_question_responses WHERE id = :'id' AND story_id = :'story' RETURNING 1 AS ok`, { id: responseId, story: storyId });
  return rows.length > 0;
}

/**
 * "Remind me": the reminder and the push it sends when the countdown ends, together. The
 * push waits in push_outbox until `endsAt` (run_after) and is re-checked when it's sent
 * (push/dispatcher.ts), so a reminder switched off, a block or a deleted Story stops it.
 */
export async function addReminder(storyId: string, stickerId: string, userId: string, ownerId: string, endsAt: string): Promise<void> {
  await query(
    `WITH r AS (
       INSERT INTO story_countdown_reminders (story_id, sticker_id, user_id) VALUES (:'story', :'sticker', :'user')
       ON CONFLICT DO NOTHING RETURNING story_id)
     INSERT INTO push_outbox (user_id, kind, actor_id, ref_id, run_after)
     SELECT :'user', 'countdown', :'owner', :'story', :'at'::timestamptz FROM r`,
    { story: storyId, sticker: stickerId, user: userId, owner: ownerId, at: endsAt },
  );
}

export async function removeReminder(storyId: string, stickerId: string, userId: string): Promise<void> {
  await query(
    `WITH r AS (DELETE FROM story_countdown_reminders WHERE story_id = :'story' AND sticker_id = :'sticker' AND user_id = :'user' RETURNING 1)
     DELETE FROM push_outbox WHERE user_id = :'user' AND kind = 'countdown' AND ref_id = :'story' AND status = 'queued'`,
    { story: storyId, sticker: stickerId, user: userId },
  );
}

export interface ChainRecord {
  id: string;
  prompt: string;
  startedBy: string | null;
}

export async function findChain(chainId: string): Promise<ChainRecord | null> {
  const row = await queryOne(`SELECT id, prompt, started_by FROM add_yours_chains WHERE id = :'id'`, { id: chainId });
  return row ? { id: String(row.id), prompt: String(row.prompt), startedBy: row.started_by ?? null } : null;
}

/** The chain a Story belongs to, if it has an "Add Yours" sticker. */
export async function chainOfStory(storyId: string): Promise<ChainRecord | null> {
  const row = await queryOne(
    `SELECT c.id, c.prompt, c.started_by FROM story_add_yours a JOIN add_yours_chains c ON c.id = a.chain_id WHERE a.story_id = :'story'`,
    { story: storyId },
  );
  return row ? { id: String(row.id), prompt: String(row.prompt), startedBy: row.started_by ?? null } : null;
}

/** Starts a chain with this Story as its first, or joins `chainId` (once: a retried publish changes nothing). */
export async function linkStoryToChain(storyId: string, ownerId: string, prompt: string, chainId: string | null): Promise<string> {
  const row = await queryOne(
    `WITH existing AS (SELECT chain_id FROM story_add_yours WHERE story_id = :'story'),
     fresh AS (
       INSERT INTO add_yours_chains (prompt, started_by)
       SELECT :'prompt', :'owner' WHERE NOT EXISTS (SELECT 1 FROM existing) AND NULLIF(:'chain', '') IS NULL
       RETURNING id),
     linked AS (
       INSERT INTO story_add_yours (story_id, chain_id)
       SELECT :'story', coalesce((SELECT id FROM fresh), NULLIF(:'chain', '')::uuid)
       WHERE NOT EXISTS (SELECT 1 FROM existing)
       ON CONFLICT (story_id) DO NOTHING
       RETURNING chain_id)
     SELECT coalesce((SELECT chain_id FROM linked), (SELECT chain_id FROM existing)) AS chain_id`,
    { story: storyId, owner: ownerId, prompt, chain: chainId ?? "" },
  );
  return String(row?.chain_id);
}

export interface ChainSummary {
  participants: number;
  recent: { username: string; avatarMediaId: string | null }[];
}

/**
 * How many people have taken part (each person once, deleted Stories and accounts not
 * counted), and the faces of the latest few this viewer may see — someone they've blocked, or
 * who blocked them, never shows up.
 */
export async function chainSummary(chainId: string, viewerId: string): Promise<ChainSummary> {
  const row = await queryOne(
    `WITH members AS (
       SELECT s.owner_id, max(a.joined_at) AS at
       FROM story_add_yours a JOIN stories s ON s.id = a.story_id AND s.deleted_at IS NULL
       JOIN users u ON u.id = s.owner_id AND u.is_active AND u.deleted_at IS NULL
       WHERE a.chain_id = :'chain'
       GROUP BY s.owner_id)
     SELECT (SELECT count(*) FROM members) AS participants,
            (SELECT coalesce(jsonb_agg(jsonb_build_object('username', u.username, 'avatarMediaId', u.avatar_media_id) ORDER BY m.at DESC), '[]'::jsonb)
             FROM (SELECT * FROM members m
                   WHERE NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = :'viewer' AND b.blocked_id = m.owner_id) OR (b.blocker_id = m.owner_id AND b.blocked_id = :'viewer'))
                   ORDER BY m.at DESC LIMIT 3) m
             JOIN users u ON u.id = m.owner_id) AS recent`,
    { chain: chainId, viewer: viewerId },
  );
  return { participants: Number(row?.participants ?? 0), recent: parseJson(row?.recent, []) };
}

export interface ChainStory {
  storyId: string;
  mediaId: string;
  createdAt: string;
  owner: { id: string; username: string; displayName: string; avatarMediaId: string | null; verified: boolean };
}

/**
 * A chain's Stories this viewer may see right now: active, and through exactly the rules
 * every other list of Stories uses (blocks, private accounts, audience, collab blocks — see
 * audience.ts's VISIBLE_STORY_SQL). Newest first.
 */
export async function listChainStories(chainId: string, viewerId: string, limit: number, offset: number): Promise<ChainStory[]> {
  const rows = await query(
    `SELECT s.id, s.media_id, s.created_at, u.id AS owner_id, u.username, u.display_name, u.avatar_media_id, ${verifiedSql("u")} AS verified
     FROM story_add_yours a
     JOIN stories s ON s.id = a.story_id
     JOIN users u ON u.id = s.owner_id AND u.is_active AND u.deleted_at IS NULL
     WHERE a.chain_id = :'chain' AND s.deleted_at IS NULL AND s.expires_at > now()
       AND ${VISIBLE_STORY_SQL}
     ORDER BY a.joined_at DESC, s.id
     LIMIT :'limit' OFFSET :'offset'`,
    { chain: chainId, viewer: viewerId, limit, offset },
  );
  return rows.map((r) => ({
    storyId: String(r.id),
    mediaId: String(r.media_id),
    createdAt: String(r.created_at),
    owner: { id: String(r.owner_id), username: String(r.username), displayName: String(r.display_name), avatarMediaId: r.avatar_media_id ?? null, verified: r.verified === "t" },
  }));
}
