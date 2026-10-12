import { query, queryOne } from "../../db/psql";
import { AREA_CELL_LENGTH, cellsAround } from "./geohash";
import { decideReach, type ReachSettings, type ReachStage, type StageStats } from "./reach";

/** An area that hasn't been refreshed for this long no longer counts (and retention deletes it). */
const AREA_FRESH = "interval '30 days'";

export interface Area {
  cell: string | null;
  timeZone: string | null;
  updatedAt: string;
}

/** `cell` or `timeZone` left undefined keeps what is stored; null clears it. */
export async function setArea(userId: string, input: { cell?: string | null; timeZone?: string | null }): Promise<Area> {
  const row = await queryOne(
    `INSERT INTO user_areas (user_id, cell, time_zone) VALUES (:'user', NULLIF(:'cell', ''), NULLIF(:'tz', ''))
     ON CONFLICT (user_id) DO UPDATE SET
       cell = CASE WHEN :'set_cell'::boolean THEN NULLIF(:'cell', '') ELSE user_areas.cell END,
       time_zone = CASE WHEN :'set_tz'::boolean THEN NULLIF(:'tz', '') ELSE user_areas.time_zone END,
       updated_at = now()
     RETURNING cell, time_zone, updated_at`,
    {
      user: userId,
      cell: input.cell ?? "",
      tz: input.timeZone ?? "",
      set_cell: input.cell !== undefined,
      set_tz: input.timeZone !== undefined,
    },
  );
  return { cell: row?.cell ?? null, timeZone: row?.time_zone ?? null, updatedAt: row?.updated_at as string };
}

export async function getArea(userId: string): Promise<Area | null> {
  const row = await queryOne(`SELECT cell, time_zone, updated_at FROM user_areas WHERE user_id = :'user'`, { user: userId });
  return row ? { cell: row.cell ?? null, timeZone: row.time_zone ?? null, updatedAt: row.updated_at as string } : null;
}

export async function deleteArea(userId: string): Promise<void> {
  await query(`DELETE FROM user_areas WHERE user_id = :'user'`, { user: userId });
}

/** How close a new person is: 0 nearby, 1 the wider area, 2 the same time zone, 3 unknown or further. */
export type Locality = 0 | 1 | 2 | 3;

export interface DiscoveryCandidate {
  ownerId: string;
  locality: Locality;
}

/**
 * People the viewer doesn't follow whose public Stories have earned reach that includes the
 * viewer (Phase 9). A Story at stage 1 reaches people near its owner, stage 2 the wider area,
 * stage 3 the same time zone and stage 4 everyone; a testing stage stops once its audience is
 * used up, and a held Story reaches no new people. Where either side shares no area, the time
 * zone stands in for it, and where neither has one, nothing narrows it. Private, followers-only,
 * removed, blocked (either way), muted and "not interested" are never included. Nearest first.
 */
export async function listDiscoveryCandidates(viewerId: string, settings: ReachSettings, limit: number): Promise<DiscoveryCandidate[]> {
  const viewer = await queryOne(
    `SELECT cell, time_zone FROM user_areas WHERE user_id = :'viewer' AND updated_at > now() - ${AREA_FRESH}`,
    { viewer: viewerId },
  );
  const cell = viewer?.cell ?? null;
  const nearby = cell ? cellsAround(cell) : [];
  const wider = cell ? cellsAround(cell.slice(0, AREA_CELL_LENGTH - 1)) : [];
  const rows = await query(
    `WITH stories_in_reach AS (
       SELECT s.owner_id, s.created_at, COALESCE(r.stage, 1) AS stage,
              (oa.cell IS NOT NULL AND :'viewer_cell' <> '') AS cells_known,
              oa.cell = ANY (:'nearby'::text[]) AS is_nearby,
              left(oa.cell, 3) = ANY (:'wider'::text[]) AS is_wider,
              (:'viewer_tz' = '' OR oa.time_zone IS NULL OR oa.time_zone = :'viewer_tz') AS tz_ok,
              (:'viewer_tz' <> '' AND oa.time_zone = :'viewer_tz') AS same_tz
       FROM stories s
       JOIN users u ON u.id = s.owner_id
       LEFT JOIN story_reach r ON r.story_id = s.id
       LEFT JOIN user_areas oa ON oa.user_id = s.owner_id AND oa.updated_at > now() - ${AREA_FRESH}
       WHERE s.deleted_at IS NULL AND s.expires_at > now() AND s.audience = 'public' AND s.moderation_removed_at IS NULL
         AND u.deleted_at IS NULL AND u.is_active AND NOT u.is_private AND u.moderation_state = 'ACTIVE'
         AND s.owner_id <> :'viewer'
         AND NOT COALESCE(r.held, false)
         AND (COALESCE(r.stage, 1) = 4 OR COALESCE(r.stage_impressions, 0) < (:'caps'::jsonb ->> (COALESCE(r.stage, 1) - 1))::integer)
         AND NOT EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = :'viewer' AND f.followee_id = s.owner_id)
         AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = :'viewer' AND b.blocked_id = s.owner_id)
                                                OR (b.blocker_id = s.owner_id AND b.blocked_id = :'viewer'))
         AND NOT EXISTS (SELECT 1 FROM mutes m WHERE m.muter_id = :'viewer' AND m.muted_id = s.owner_id)
         AND NOT EXISTS (SELECT 1 FROM creator_not_interested n WHERE n.viewer_id = :'viewer' AND n.creator_id = s.owner_id)
     ),
     reachable AS (
       SELECT owner_id, created_at, stage,
              CASE WHEN cells_known AND is_nearby THEN 0 WHEN cells_known AND is_wider THEN 1 WHEN same_tz THEN 2 ELSE 3 END AS locality
       FROM stories_in_reach
       WHERE stage = 4
          OR (stage >= 3 AND tz_ok)
          OR (stage >= 2 AND CASE WHEN cells_known THEN is_wider ELSE tz_ok END)
          OR CASE WHEN cells_known THEN is_nearby ELSE tz_ok END
     )
     SELECT owner_id, min(locality) AS locality
     FROM reachable
     GROUP BY owner_id
     ORDER BY min(locality), max(stage) DESC, max(created_at) DESC, owner_id
     LIMIT :'limit'`,
    {
      viewer: viewerId,
      viewer_cell: cell ?? "",
      viewer_tz: viewer?.time_zone ?? "",
      nearby: `{${nearby.join(",")}}`,
      wider: `{${wider.join(",")}}`,
      caps: JSON.stringify(settings.caps),
      limit,
    },
  );
  return rows.map((row) => ({ ownerId: row.owner_id as string, locality: Number(row.locality) as Locality }));
}

/**
 * One round of the reach evaluator: the Stories still testing, least recently judged first.
 * Counts what the people who didn't follow the owner when they saw it did since the current
 * stage began (each person once), and stores the decision.
 */
export async function evaluateReachBatch(settings: ReachSettings, batch: number, now = new Date()): Promise<{ evaluated: number; changed: number }> {
  // Each viewer appears once per Story in `seen` (story_views is unique per pair), so counting
  // the viewers for whom something exists counts each person once. One grouped pass with index
  // probes per viewer, instead of re-reading every view once per Story.
  const rows = await query(
    `WITH testing AS MATERIALIZED (
       SELECT s.id, s.owner_id, COALESCE(r.stage, 1) AS stage, COALESCE(r.stage_started_at, s.created_at) AS since
       FROM stories s
       JOIN users u ON u.id = s.owner_id
       LEFT JOIN story_reach r ON r.story_id = s.id
       WHERE s.deleted_at IS NULL AND s.expires_at > now() AND s.audience = 'public' AND s.moderation_removed_at IS NULL
         AND u.deleted_at IS NULL AND u.is_active AND NOT u.is_private
         AND COALESCE(r.stage, 1) < 4 AND NOT COALESCE(r.held, false)
       ORDER BY COALESCE(r.evaluated_at, s.created_at)
       LIMIT :'batch'
     ),
     seen AS MATERIALIZED (
       SELECT t.id AS story_id, t.owner_id, v.viewer_id, v.viewed_at
       FROM testing t JOIN story_views v ON v.story_id = t.id AND NOT v.was_following AND v.viewed_at >= t.since
     ),
     counts AS (
       SELECT x.story_id,
         count(*) AS impressions,
         count(*) FILTER (WHERE EXISTS (SELECT 1 FROM recommendation_events e
           WHERE e.viewer_id = x.viewer_id AND e.story_id = x.story_id AND e.event_type = 'story_complete')) AS completions,
         count(*) FILTER (WHERE EXISTS (SELECT 1 FROM story_likes l WHERE l.story_id = x.story_id AND l.user_id = x.viewer_id)) AS likes,
         count(*) FILTER (WHERE EXISTS (SELECT 1 FROM story_comments c
           WHERE c.story_id = x.story_id AND c.user_id = x.viewer_id AND c.deleted_at IS NULL)) AS comments,
         count(*) FILTER (WHERE EXISTS (SELECT 1 FROM story_shares h WHERE h.story_id = x.story_id AND h.user_id = x.viewer_id)) AS shares,
         count(*) FILTER (WHERE EXISTS (SELECT 1 FROM recommendation_events e
           WHERE e.viewer_id = x.viewer_id AND e.creator_id = x.owner_id AND e.event_type = 'profile_visit' AND e.created_at >= x.viewed_at)) AS profile_visits,
         count(*) FILTER (WHERE EXISTS (SELECT 1 FROM follows f
           WHERE f.follower_id = x.viewer_id AND f.followee_id = x.owner_id AND f.created_at >= x.viewed_at)) AS follows,
         count(*) FILTER (WHERE EXISTS (SELECT 1 FROM creator_not_interested n
           WHERE n.viewer_id = x.viewer_id AND n.creator_id = x.owner_id AND n.created_at >= x.viewed_at)) AS not_interested,
         count(*) FILTER (WHERE EXISTS (SELECT 1 FROM recommendation_events e
           WHERE e.viewer_id = x.viewer_id AND e.creator_id = x.owner_id AND e.event_type = 'quick_creator_skip' AND e.created_at >= x.viewed_at)) AS quick_skips
       FROM seen x
       GROUP BY x.story_id
     )
     SELECT t.id, t.stage, t.since,
       COALESCE(c.impressions, 0) AS impressions, COALESCE(c.completions, 0) AS completions, COALESCE(c.likes, 0) AS likes,
       COALESCE(c.comments, 0) AS comments, COALESCE(c.shares, 0) AS shares, COALESCE(c.profile_visits, 0) AS profile_visits,
       COALESCE(c.follows, 0) AS follows, COALESCE(c.not_interested, 0) AS not_interested, COALESCE(c.quick_skips, 0) AS quick_skips
     FROM testing t LEFT JOIN counts c ON c.story_id = t.id`,
    { batch },
  );
  const decisions = rows.map((row) => {
    const stats: StageStats = {
      impressions: Number(row.impressions), completions: Number(row.completions), likes: Number(row.likes),
      comments: Number(row.comments), shares: Number(row.shares), profileVisits: Number(row.profile_visits),
      follows: Number(row.follows), notInterested: Number(row.not_interested), quickSkips: Number(row.quick_skips),
    };
    const stage = Number(row.stage) as ReachStage;
    const decision = decideReach({ stage, held: false, stageStartedAt: new Date(row.since as string) }, stats, now, settings);
    return {
      story_id: row.id,
      stage: decision.stage,
      held: decision.held,
      stage_started_at: decision.stageStartedAt.toISOString(),
      // A new stage counts its own audience from zero.
      stage_impressions: decision.stage === stage ? stats.impressions : 0,
      stage_score: decision.score,
      reason: decision.reason,
    };
  });
  if (decisions.length > 0) {
    await query(
      `INSERT INTO story_reach (story_id, stage, held, stage_started_at, stage_impressions, stage_score, reason, evaluated_at)
       SELECT d.story_id, d.stage, d.held, d.stage_started_at, d.stage_impressions, d.stage_score, d.reason, now()
       FROM jsonb_to_recordset(:'decisions'::jsonb) AS d(story_id uuid, stage smallint, held boolean, stage_started_at timestamptz,
                                                         stage_impressions integer, stage_score real, reason text)
       ON CONFLICT (story_id) DO UPDATE SET
         stage = EXCLUDED.stage, held = EXCLUDED.held, stage_started_at = EXCLUDED.stage_started_at,
         stage_impressions = EXCLUDED.stage_impressions, stage_score = EXCLUDED.stage_score,
         reason = COALESCE(EXCLUDED.reason, story_reach.reason), evaluated_at = now()`,
      { decisions: JSON.stringify(decisions) },
    );
  }
  return { evaluated: decisions.length, changed: decisions.filter((d) => d.reason !== null).length };
}
