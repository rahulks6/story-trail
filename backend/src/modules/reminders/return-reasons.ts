import type { Client } from "pg";
import { openDedicatedConnection, query, queryOne } from "../../db/psql";
import type { Router } from "../../http/router";
import { requireAuth } from "../../http/middleware/auth.middleware";
import { sendJson } from "../../http/respond";
import { FESTIVAL_TIME_ZONE } from "../festivals/festivals";

/**
 * Reasons to open Katkee each day (migration 0051), each with a limit so nobody is spammed:
 * - someone you follow posted a Story: once a day per person, at most 5 a day in all;
 * - your Story reached 10, 25, 50, 100… views: once per milestone;
 * - a festival greeting on its first morning: once per festival;
 * - your posting streak in the evening, if you haven't posted yet today: once a day;
 * - a nudge after 3 quiet days: at most once a week.
 * Each can be switched off (notification preferences); push_sent records what went out.
 */
const DAY = `(now() AT TIME ZONE '${FESTIVAL_TIME_ZONE}')::date`;
export const NEW_STORY_DAILY_CAP = 5;
export const VIEW_MILESTONES = [10, 25, 50, 100, 250, 500, 1000];
const BATCH = 2000;

/** Queues "@owner posted a new Story" for the followers who can see it. Called after every publish. */
export async function queueNewStoryPushes(storyId: string): Promise<number> {
  const rows = await query(
    `WITH s AS (
       SELECT id, owner_id, audience FROM stories
       WHERE id = :'story' AND deleted_at IS NULL AND moderation_removed_at IS NULL AND expires_at > now()),
     recipients AS (
       SELECT f.follower_id AS uid
       FROM s JOIN follows f ON f.followee_id = s.owner_id
       JOIN users u ON u.id = f.follower_id AND u.is_active AND u.deleted_at IS NULL
       LEFT JOIN notification_preferences p ON p.user_id = f.follower_id
       WHERE coalesce(p.push_enabled, true) AND coalesce(p.stories_enabled, true)
         AND (s.audience <> 'close_friends' OR EXISTS (SELECT 1 FROM close_friends c WHERE c.owner_id = s.owner_id AND c.friend_id = f.follower_id))
         AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = f.follower_id AND b.blocked_id = s.owner_id) OR (b.blocker_id = s.owner_id AND b.blocked_id = f.follower_id))
         AND (SELECT count(*) FROM push_sent ps WHERE ps.user_id = f.follower_id AND ps.kind = 'new_story' AND ps.sent_at > now() - interval '1 day') < :'cap'
       LIMIT 5000),
     sent AS (
       INSERT INTO push_sent (user_id, kind, ref_key)
       SELECT r.uid, 'new_story', s.owner_id::text || ':' || to_char(${DAY}, 'YYYY-MM-DD') FROM recipients r, s
       ON CONFLICT DO NOTHING RETURNING user_id)
     INSERT INTO push_outbox (user_id, kind, actor_id, ref_id)
     SELECT sent.user_id, 'new_story', s.owner_id, s.id FROM sent, s
     RETURNING id`,
    { story: storyId, cap: NEW_STORY_DAILY_CAP },
  );
  return rows.length;
}

/** Milestone pushes for active Stories that passed a new view count since the last check. */
export async function queueViewMilestones(): Promise<number> {
  const rows = await query(
    `WITH counts AS (
       SELECT s.id, s.owner_id, count(*) AS views
       FROM stories s JOIN story_views v ON v.story_id = s.id
       WHERE s.expires_at > now() AND s.deleted_at IS NULL AND s.moderation_removed_at IS NULL
       GROUP BY s.id, s.owner_id),
     hit AS (
       SELECT c.id, c.owner_id, (SELECT max(n) FROM unnest(:'milestones'::int[]) n WHERE n <= c.views) AS n
       FROM counts c),
     sent AS (
       INSERT INTO push_sent (user_id, kind, ref_key)
       SELECT owner_id, 'story_milestone', id::text || ':' || n FROM hit WHERE n IS NOT NULL
       ON CONFLICT DO NOTHING RETURNING user_id, ref_key)
     INSERT INTO push_outbox (user_id, kind, ref_id, body, link)
     SELECT user_id, 'story_milestone', split_part(ref_key, ':', 1)::uuid,
            'Your Story reached ' || split_part(ref_key, ':', 2) || ' views 🎉', 'katkee://story/' || split_part(ref_key, ':', 1)
     FROM sent
     RETURNING id`,
    { milestones: `{${VIEW_MILESTONES.join(",")}}` },
  );
  return rows.length;
}

// Who a reminder may go to: active, reminders on, and a phone to send it to.
const REMINDABLE = `u.is_active AND u.deleted_at IS NULL
  AND coalesce(p.push_enabled, true) AND coalesce(p.reminders_enabled, true)
  AND EXISTS (SELECT 1 FROM push_devices d WHERE d.user_id = u.id AND d.disabled_at IS NULL)`;

/** On a festival's first day: one greeting per person, inviting their festival Story. */
export async function queueFestivalGreetings(): Promise<number> {
  const rows = await query(
    `WITH f AS (SELECT slug, name, emoji, greeting FROM festivals WHERE starts_on = ${DAY} ORDER BY ends_on - starts_on LIMIT 1),
     targets AS (
       SELECT u.id FROM users u LEFT JOIN notification_preferences p ON p.user_id = u.id, f
       WHERE ${REMINDABLE}
         AND NOT EXISTS (SELECT 1 FROM push_sent ps WHERE ps.user_id = u.id AND ps.kind = 'festival' AND ps.ref_key = f.slug)
       LIMIT :'batch'),
     sent AS (
       INSERT INTO push_sent (user_id, kind, ref_key) SELECT t.id, 'festival', f.slug FROM targets t, f
       ON CONFLICT DO NOTHING RETURNING user_id)
     INSERT INTO push_outbox (user_id, kind, body, link)
     SELECT sent.user_id, 'festival', f.emoji || ' ' || f.greeting || '! Share your ' || f.name || ' Story on Katkee', 'katkee://home'
     FROM sent, f
     RETURNING id`,
    { batch: BATCH },
  );
  return rows.length;
}

/** Evening: people on a streak of 2+ days who haven't posted yet today. */
export async function queueStreakReminders(): Promise<number> {
  const rows = await query(
    `WITH candidates AS (
       SELECT DISTINCT s.owner_id AS uid FROM stories s
       WHERE (s.created_at AT TIME ZONE '${FESTIVAL_TIME_ZONE}')::date = ${DAY} - 1
         AND NOT EXISTS (SELECT 1 FROM stories t WHERE t.owner_id = s.owner_id AND (t.created_at AT TIME ZONE '${FESTIVAL_TIME_ZONE}')::date = ${DAY})),
     targets AS (
       SELECT u.id, posting_streak(u.id) AS days
       FROM candidates c JOIN users u ON u.id = c.uid LEFT JOIN notification_preferences p ON p.user_id = u.id
       WHERE ${REMINDABLE}
         AND NOT EXISTS (SELECT 1 FROM push_sent ps WHERE ps.user_id = u.id AND ps.kind = 'streak' AND ps.ref_key = to_char(${DAY}, 'YYYY-MM-DD'))
       LIMIT :'batch'),
     sent AS (
       INSERT INTO push_sent (user_id, kind, ref_key)
       SELECT id, 'streak', to_char(${DAY}, 'YYYY-MM-DD') || ':' || days FROM targets WHERE days >= 2
       ON CONFLICT DO NOTHING RETURNING user_id, ref_key)
     INSERT INTO push_outbox (user_id, kind, body, link)
     SELECT user_id, 'streak', '🔥 Keep your ' || split_part(ref_key, ':', 2) || '-day streak going: post a Story today', 'katkee://home'
     FROM sent
     RETURNING id`,
    { batch: BATCH },
  );
  return rows.length;
}

/** Evening: a gentle nudge after 3 quiet days (or 2 days without a first Story), weekly at most. */
export async function queueNudges(): Promise<number> {
  const rows = await query(
    `WITH targets AS (
       SELECT u.id, (SELECT max(created_at) FROM stories s WHERE s.owner_id = u.id) AS last_story
       FROM users u LEFT JOIN notification_preferences p ON p.user_id = u.id
       WHERE ${REMINDABLE} AND u.created_at < now() - interval '2 days'
         AND NOT EXISTS (SELECT 1 FROM push_sent ps WHERE ps.user_id = u.id AND ps.kind IN ('nudge', 'streak') AND ps.sent_at > now() - interval '7 days')
         AND NOT EXISTS (SELECT 1 FROM stories s WHERE s.owner_id = u.id AND s.created_at > now() - interval '3 days')
       LIMIT :'batch'),
     sent AS (
       INSERT INTO push_sent (user_id, kind, ref_key)
       SELECT id, 'nudge', to_char(${DAY}, 'YYYY-MM-DD') || ':' || CASE WHEN last_story IS NULL THEN 'first' ELSE 'back' END FROM targets
       ON CONFLICT DO NOTHING RETURNING user_id, ref_key)
     INSERT INTO push_outbox (user_id, kind, body, link)
     SELECT user_id, 'nudge',
            CASE WHEN split_part(ref_key, ':', 2) = 'first' THEN 'Share your first Story: your friends on Katkee will see it 👋'
                 ELSE 'Your friends miss your Stories 👀 Share what you''re up to today' END,
            'katkee://home'
     FROM sent
     RETURNING id`,
    { batch: BATCH },
  );
  return rows.length;
}

/** Hour of the day in India (0-23). */
export function hourInIndia(now = new Date()): number {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone: FESTIVAL_TIME_ZONE, hour: "2-digit", hourCycle: "h23" }).format(now));
}

/** One pass: milestones always; festival greetings 8am-10pm; streaks and nudges 6-9pm (India). */
export async function runReturnReasons(now = new Date()): Promise<Record<string, number>> {
  const hour = hourInIndia(now);
  const result: Record<string, number> = { milestones: await queueViewMilestones() };
  if (hour >= 8 && hour < 22) result.festival = await queueFestivalGreetings();
  if (hour >= 18 && hour < 21) {
    result.streak = await queueStreakReminders();
    result.nudge = await queueNudges();
  }
  return result;
}

/** One worker at a time queues these; others skip the round. */
const LOCK = 7315220003;

/** Runs runReturnReasons every few minutes inside the worker service (ReachWorker's pattern). */
export class ReturnReasonsWorker {
  private running = false;
  private connection: Client | null = null;
  private loop: Promise<void> | null = null;
  private wake: (() => void) | null = null;

  constructor(private readonly options: { everyMs: number; log?: (event: Record<string, unknown>) => void }) {}

  /** One round if this worker holds the lock; null when another worker has it. */
  async runOnce(now = new Date()): Promise<Record<string, number> | null> {
    const connection = this.connection ?? (this.connection = await openDedicatedConnection());
    const lock = await connection.query<{ ok: boolean }>("SELECT pg_try_advisory_lock($1) AS ok", [LOCK]);
    if (!lock.rows[0]?.ok) return null;
    try {
      return await runReturnReasons(now);
    } finally {
      await connection.query("SELECT pg_advisory_unlock($1)", [LOCK]);
    }
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.loop = (async () => {
      while (this.running) {
        try {
          const queued = await this.runOnce();
          if (queued && Object.values(queued).some((n) => n > 0)) this.options.log?.({ event: "return_reasons_queued", ...queued });
        } catch (error) {
          this.options.log?.({ event: "return_reasons_error", error: (error as Error).message });
        }
        if (this.running) {
          await new Promise<void>((resolve) => {
            const timer = setTimeout(() => { this.wake = null; resolve(); }, this.options.everyMs);
            this.wake = () => { clearTimeout(timer); this.wake = null; resolve(); };
          });
        }
      }
    })();
  }

  async stop(): Promise<void> {
    this.running = false;
    this.wake?.();
    await this.loop;
    await this.connection?.end().catch(() => undefined);
    this.connection = null;
  }
}

/** Your posting streak, for Profile and Create. */
export async function postingStreak(userId: string): Promise<{ days: number; postedToday: boolean }> {
  const row = await queryOne(
    `SELECT posting_streak(:'user') AS days,
            EXISTS (SELECT 1 FROM stories WHERE owner_id = :'user' AND (created_at AT TIME ZONE '${FESTIVAL_TIME_ZONE}')::date = ${DAY}) AS today`,
    { user: userId },
  );
  return { days: Number(row?.days ?? 0), postedToday: row?.today === "t" };
}

export function registerStreakRoutes(router: Router): void {
  router.get("/api/v1/stories/streak", async (req, res) => {
    requireAuth(req);
    sendJson(res, 200, { streak: await postingStreak(req.userId as string) });
  });
}
