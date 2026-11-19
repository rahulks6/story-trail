import type { Router } from "../../http/router";
import { requireAuth } from "../../http/middleware/auth.middleware";
import { sendJson } from "../../http/respond";
import { query, queryOne } from "../../db/psql";
import { createNotification } from "../notifications/notifications.repository";
import { FOUNDING_MEMBERS } from "../analytics/people";

/**
 * Katkee's own account (users.is_official, migration 0081), run by the Katkee team and shown as
 * Katkee with the verified badge. It follows people who joined in the last WELCOME_WINDOW, so a
 * new person's Activity says hello, and it's suggested first in "People to follow". It's a follow
 * anyone can see and undo (remove follower, block); nobody is ever made to follow it. With no
 * official account set, nothing happens.
 */
export const WELCOME_WINDOW = "30 days";
/** Per round, so a backlog is worked through gently. */
export const WELCOMES_PER_ROUND = 100;

/** The official account follows recent sign-ups it doesn't follow yet: public, real, unblocked. */
export async function welcomeNewPeople(): Promise<number> {
  const rows = await query(
    `WITH official AS (SELECT id FROM users WHERE is_official AND is_active AND deleted_at IS NULL LIMIT 1),
     targets AS (
       SELECT u.id FROM users u, official o
       WHERE u.id <> o.id AND u.is_active AND u.deleted_at IS NULL AND NOT u.is_private
         AND u.moderation_state = 'ACTIVE'
         AND u.created_at > now() - interval '${WELCOME_WINDOW}'
         AND coalesce(u.email, '') NOT ILIKE 'support+e2e-%@katkee.com'
         AND NOT EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = o.id AND f.followee_id = u.id)
         AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = u.id AND b.blocked_id = o.id) OR (b.blocker_id = o.id AND b.blocked_id = u.id))
         -- Once is enough: someone who removed the follow isn't followed again.
         AND NOT EXISTS (SELECT 1 FROM push_sent ps WHERE ps.user_id = u.id AND ps.kind = 'official_welcome')
       ORDER BY u.created_at
       LIMIT :'limit'),
     marked AS (
       INSERT INTO push_sent (user_id, kind, ref_key) SELECT id, 'official_welcome', 'v1' FROM targets
       ON CONFLICT DO NOTHING RETURNING user_id)
     INSERT INTO follows (follower_id, followee_id)
     SELECT o.id, m.user_id FROM marked m, official o
     ON CONFLICT DO NOTHING
     RETURNING follower_id, followee_id`,
    { limit: WELCOMES_PER_ROUND },
  );
  for (const row of rows) {
    await createNotification({ recipientId: row.followee_id as string, actorId: row.follower_id as string, type: "follow" });
  }
  return rows.length;
}

/** Founding member spots: how many of the first FOUNDING_MEMBERS accounts are taken. */
export async function foundingSpots(): Promise<{ total: number; taken: number; left: number }> {
  const row = await queryOne(`SELECT count(*) AS taken FROM users WHERE founding_number IS NOT NULL`);
  const taken = Math.min(Number(row?.taken ?? 0), FOUNDING_MEMBERS);
  return { total: FOUNDING_MEMBERS, taken, left: FOUNDING_MEMBERS - taken };
}

export function registerOfficialRoutes(router: Router): void {
  router.get("/api/v1/founding", async (req, res) => {
    requireAuth(req);
    res.setHeader("Cache-Control", "private, max-age=300");
    sendJson(res, 200, await foundingSpots());
  });
}
