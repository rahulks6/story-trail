import type { Router } from "../../http/router";
import { requireAuth } from "../../http/middleware/auth.middleware";
import { sendJson } from "../../http/respond";
import { query, queryOne } from "../../db/psql";
import { ValidationError } from "../auth/dto";
import { createNotification } from "../notifications/notifications.repository";

/**
 * Crossed paths (migration 0078). Off until you turn it on, and only ever between two people who
 * both did. While it's on, the app sends a neighbourhood-sized cell (5-character geohash, about
 * 5 x 5 km, from approximate location, never coordinates) when it's opened; nothing is read in
 * the background. Two people in the same cell within a few hours of each other are told later
 * ("You crossed paths with @riya"), never where or exactly when, and only about someone
 * whose account is public. Blocks and mutes are respected; nobody is shown the same person twice
 * in a week, or more than a few people a day.
 */
export const CROSSED_CELL_RE = /^[0-9b-hjkmnp-z]{5}$/;
/** Two visits to a cell this close in time count as crossing. */
export const CROSSING_WINDOW = "3 hours";
/** Nobody is told until at least this long after the crossing, so it can't be used to find someone. */
export const CROSSING_DELAY = "2 hours";
/** Visits older than this aren't matched any more (retention deletes them after two days). */
export const CROSSING_LOOKBACK = "30 hours";
export const CROSSINGS_PER_DAY = 3;

export async function getCrossedPaths(userId: string): Promise<{ enabled: boolean }> {
  const row = await queryOne(`SELECT crossed_paths_enabled FROM users WHERE id = :'user'`, { user: userId });
  return { enabled: row?.crossed_paths_enabled === "t" };
}

/** Turning it off forgets every visit at once. */
export async function setCrossedPaths(userId: string, enabled: boolean): Promise<{ enabled: boolean }> {
  await query(`UPDATE users SET crossed_paths_enabled = :'enabled'::boolean WHERE id = :'user'`, { user: userId, enabled });
  if (!enabled) await query(`DELETE FROM crossed_visits WHERE user_id = :'user'`, { user: userId });
  return { enabled };
}

/** Visits are kept per 3-hour slot; two visits to a cell in the same or neighbouring slots can cross. */
const SLOT = `to_timestamp(floor(extract(epoch FROM now()) / 10800) * 10800)`;
/**
 * Limits that stop a modified app from probing many areas to work out where someone is: at most
 * this many different cells a day, and a new cell no sooner than this after the last visit.
 */
export const CELLS_PER_DAY = 6;
export const NEW_CELL_AFTER = "10 minutes";

/**
 * A visit to a cell while the app is open; ignored unless Crossed paths is on, and when it would
 * break the limits above (a visit to a cell already visited this slot always counts).
 */
export async function recordVisit(userId: string, cell: string): Promise<boolean> {
  const rows = await query(
    `INSERT INTO crossed_visits (user_id, cell, slot)
     SELECT u.id, :'cell', ${SLOT} FROM users u
     WHERE u.id = :'user' AND u.crossed_paths_enabled
       AND (EXISTS (SELECT 1 FROM crossed_visits v WHERE v.user_id = u.id AND v.cell = :'cell' AND v.slot = ${SLOT})
            OR ((SELECT count(DISTINCT v.cell) FROM crossed_visits v WHERE v.user_id = u.id AND v.last_at > now() - interval '1 day') < :'cells'
                AND NOT EXISTS (SELECT 1 FROM crossed_visits v WHERE v.user_id = u.id AND v.cell <> :'cell' AND v.last_at > now() - interval '${NEW_CELL_AFTER}')))
     ON CONFLICT (user_id, cell, slot) DO UPDATE SET last_at = now()
     RETURNING user_id`,
    { user: userId, cell, cells: CELLS_PER_DAY },
  );
  return rows.length > 0;
}

/**
 * Finds new crossings and tells each person (Activity and a push), during the day where they are.
 * Nobody is told while either of them could still be there: only once both have been away from
 * that area for a while. The notification carries the other person's newest public Story, when
 * there is one, so a tap plays it.
 */
export async function runCrossedPaths(options: { anyHour?: boolean } = {}): Promise<number> {
  const rows = await query(
    `WITH pairs AS (
       SELECT DISTINCT a.user_id AS uid, b.user_id AS other
       FROM crossed_visits a
       JOIN crossed_visits b ON b.cell = a.cell AND b.user_id <> a.user_id AND abs(extract(epoch FROM a.slot - b.slot)) <= 10800
       JOIN users ua ON ua.id = a.user_id AND ua.crossed_paths_enabled AND ua.is_active AND ua.deleted_at IS NULL
       JOIN users ub ON ub.id = b.user_id AND ub.crossed_paths_enabled AND ub.is_active AND ub.deleted_at IS NULL
                     AND NOT ub.is_private AND ub.moderation_state = 'ACTIVE'
       LEFT JOIN user_areas za ON za.user_id = a.user_id
       WHERE a.last_at > now() - interval '${CROSSING_LOOKBACK}' AND b.last_at > now() - interval '${CROSSING_LOOKBACK}'
         AND a.first_at <= b.last_at + interval '${CROSSING_WINDOW}' AND b.first_at <= a.last_at + interval '${CROSSING_WINDOW}'
         -- Both have been away from this area for the delay, so it can't be used to find someone.
         AND NOT EXISTS (SELECT 1 FROM crossed_visits r WHERE r.cell = a.cell AND r.user_id IN (a.user_id, b.user_id) AND r.last_at > now() - interval '${CROSSING_DELAY}')
         -- Daytime where the person being told is.
         AND (:'any_hour'::boolean OR extract(hour FROM now() AT TIME ZONE coalesce(za.time_zone, 'Asia/Kolkata')) BETWEEN 9 AND 21)
         AND NOT EXISTS (SELECT 1 FROM blocks x WHERE (x.blocker_id = a.user_id AND x.blocked_id = b.user_id) OR (x.blocker_id = b.user_id AND x.blocked_id = a.user_id))
         AND NOT EXISTS (SELECT 1 FROM mutes m WHERE m.muter_id = a.user_id AND m.muted_id = b.user_id)
         AND NOT EXISTS (SELECT 1 FROM crossings c WHERE c.user_id = a.user_id AND c.other_id = b.user_id AND c.created_at > now() - interval '7 days')),
     ranked AS (
       SELECT p.uid, p.other, row_number() OVER (PARTITION BY p.uid ORDER BY random()) AS n,
              (SELECT count(*) FROM crossings c WHERE c.user_id = p.uid AND c.created_at > now() - interval '1 day') AS today
       FROM pairs p),
     chosen AS (
       INSERT INTO crossings (user_id, other_id)
       SELECT uid, other FROM ranked WHERE n + today <= :'cap'
       RETURNING user_id, other_id)
     SELECT c.user_id, c.other_id,
            (SELECT s.id FROM stories s WHERE s.owner_id = c.other_id AND s.audience = 'public' AND s.deleted_at IS NULL
               AND s.moderation_removed_at IS NULL AND s.expires_at > now() ORDER BY s.created_at DESC LIMIT 1) AS story_id
     FROM chosen c`,
    { cap: CROSSINGS_PER_DAY, any_hour: options.anyHour === true },
  );
  for (const row of rows) {
    await createNotification({ recipientId: row.user_id as string, actorId: row.other_id as string, type: "crossed_paths", ...(row.story_id ? { storyId: row.story_id as string } : {}) });
  }
  return rows.length;
}

function parseEnabled(body: unknown): boolean {
  const b = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  if (typeof b.enabled !== "boolean") throw new ValidationError({ enabled: "enabled must be true or false." });
  return b.enabled;
}

function parseCell(body: unknown): string {
  const b = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  if (typeof b.cell !== "string" || !CROSSED_CELL_RE.test(b.cell)) throw new ValidationError({ cell: "cell must be a 5-character geohash." });
  return b.cell;
}

export function registerCrossedPathsRoutes(router: Router): void {
  router.get("/api/v1/users/me/crossed-paths", async (req, res) => {
    requireAuth(req);
    res.setHeader("Cache-Control", "no-store");
    sendJson(res, 200, await getCrossedPaths(req.userId as string));
  });
  router.put("/api/v1/users/me/crossed-paths", async (req, res) => {
    requireAuth(req);
    sendJson(res, 200, await setCrossedPaths(req.userId as string, parseEnabled(req.body)));
  });
  router.post("/api/v1/users/me/crossed-paths/visits", async (req, res) => {
    requireAuth(req);
    const recorded = await recordVisit(req.userId as string, parseCell(req.body));
    sendJson(res, 200, { recorded });
  });
}
