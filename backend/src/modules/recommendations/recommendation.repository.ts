import { query } from "../../db/psql";

/** People you follow with an active Story are never capped in practice; this only bounds the read. */
const MAX_FOLLOWED_CANDIDATES = 250;

/**
 * The people the viewer follows who have an active Story the viewer may see: not the viewer,
 * not blocked (either direction) or muted, not marked Not Interested. New people (discovery)
 * come from reach.repository.ts, which also decides how far each public Story has earned reach.
 * Most recently active first.
 */
export async function listFollowedCreatorIds(viewerId: string): Promise<string[]> {
  const rows = await query(
    `SELECT s.owner_id, max(s.created_at) AS latest_story_at
     FROM stories s
     JOIN users u ON u.id = s.owner_id
     JOIN follows f ON f.follower_id = :'viewer_id' AND f.followee_id = s.owner_id
     WHERE s.deleted_at IS NULL AND s.expires_at > now()
       AND u.deleted_at IS NULL AND u.is_active AND u.id <> :'viewer_id'
       AND NOT EXISTS (
         SELECT 1 FROM blocks b
         WHERE (b.blocker_id = :'viewer_id' AND b.blocked_id = s.owner_id)
            OR (b.blocker_id = s.owner_id AND b.blocked_id = :'viewer_id')
       )
       AND NOT EXISTS (SELECT 1 FROM mutes m WHERE m.muter_id = :'viewer_id' AND m.muted_id = s.owner_id)
       AND NOT EXISTS (
         SELECT 1 FROM creator_not_interested n WHERE n.viewer_id = :'viewer_id' AND n.creator_id = s.owner_id
       )
     GROUP BY s.owner_id
     ORDER BY latest_story_at DESC
     LIMIT :'limit'`,
    { viewer_id: viewerId, limit: MAX_FOLLOWED_CANDIDATES },
  );
  return rows.map((r) => r.owner_id as string);
}
