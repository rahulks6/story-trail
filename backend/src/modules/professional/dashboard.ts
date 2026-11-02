/**
 * The professional dashboard: how your Stories did over the last 7 or 30 days, in your own days
 * (the phone's time zone). Owner-only: it is only ever served for the signed-in account
 * (/api/v1/me/professional/dashboard), and only once that account is professional.
 *
 * Every number is counted from rows the features already write, never estimated:
 * - accounts reached and Story views: story_views (one row per person per Story, self-views
 *   never recorded; "already following" is the snapshot taken at that first view);
 * - likes, comments, replies (DM replies and quick reactions to a Story) and shares, by anyone
 *   but you;
 * - followers gained and lost per day: follower_changes (migration 0066). It started counting
 *   when that migration ran, so earlier days come back as null ("not counted yet"), never 0;
 * - top Stories: the ones you posted in the period, by views;
 * - when your followers are most active: activity_half_hours over the last 7 days.
 *
 * Privacy: you can already see who viewed each Story, so totals of views and reach reveal
 * nothing new. When your followers use the app is new, so it is held back until at least
 * MIN_ACTIVE_FOLLOWERS followers were active, and shown as each hour's share of the busiest hour,
 * never as counts: with a handful of followers an hourly count would say when one of them is
 * online.
 */
import { config } from "../../config/env";
import { query, queryOne, type Row } from "../../db/psql";
import { deliveryFor, type MediaDelivery } from "../media/delivery";
import * as mediaRepo from "../media/media.repository";
import { followCounts } from "../social/social.repository";

export const DASHBOARD_RANGES = [7, 30] as const;
export type DashboardRange = (typeof DASHBOARD_RANGES)[number];
/** Fewer followers active than this, and the active-hours chart isn't shown. */
export const MIN_ACTIVE_FOLLOWERS = 10;
/** Active hours are worked out from this many of your newest followers at most. */
export const AUDIENCE_SAMPLE_LIMIT = 10_000;
/** How long worked-out active hours are reused before they are counted again. */
export const AUDIENCE_REFRESH_HOURS = 12;
const TOP_STORIES = 5;

export interface DashboardDay {
  /** YYYY-MM-DD in the owner's time zone. */
  day: string;
  views: number;
  /** null for days before follower changes were counted. */
  followersGained: number | null;
  followersLost: number | null;
}

export interface TopStory {
  id: string;
  mediaId: string;
  createdAt: string;
  expiresAt: string;
  views: number;
  likes: number;
  replies: number;
  shares: number;
  media: MediaDelivery | null;
}

export type AudienceHours =
  | { status: "ready"; hours: number[]; peakHour: number; basedOnFollowers: number; sampled: boolean; computedAt: string }
  | { status: "not_enough"; minimumFollowers: number };

export interface Dashboard {
  days: DashboardRange;
  timeZone: string;
  /** The first day counted (YYYY-MM-DD) and today, in `timeZone`. */
  from: string;
  to: string;
  summary: {
    accountsReached: number;
    /** Of those, how many already followed you when they first watched. */
    reachedFollowers: number;
    storyViews: number;
    storiesPosted: number;
    likes: number;
    comments: number;
    replies: number;
    shares: number;
    followers: number;
    /** null when follower changes weren't counted for the whole period. */
    followersNet: number | null;
  };
  /** The same totals for the period before, for "+12% vs the previous 7 days". */
  previous: { accountsReached: number; storyViews: number };
  daily: DashboardDay[];
  /** The first day follower changes were counted, in `timeZone`. */
  followerHistorySince: string;
  topStories: TopStory[];
  audience: AudienceHours;
}

const num = (value: string | null | undefined): number => Number(value ?? 0) || 0;

// The period: today and the days before it in the owner's time zone, and the same length before
// that. Your Stories that could have been watched then: views only happen while a Story is up.
const PERIOD = `
  b AS (SELECT (now() AT TIME ZONE :'tz')::date AS today),
  w AS (SELECT b.today,
               (b.today - (:'days'::int - 1)) AS first_day,
               ((b.today - (:'days'::int - 1))::timestamp AT TIME ZONE :'tz') AS lo,
               ((b.today - (2 * :'days'::int - 1))::timestamp AT TIME ZONE :'tz') AS prev_lo
        FROM b),
  mine AS (
    SELECT s.id, s.created_at FROM stories s, w
    WHERE s.owner_id = :'me' AND s.deleted_at IS NULL AND s.moderation_removed_at IS NULL
      AND s.created_at >= w.prev_lo - make_interval(secs => :'ttl'::int))`;

export async function getDashboard(ownerId: string, days: DashboardRange, timeZone: string): Promise<Dashboard> {
  const params = { me: ownerId, days, tz: timeZone, ttl: config.stories.ttlSeconds };
  const [summary, daily, top, counts, audience] = await Promise.all([
    queryOne(
      `WITH ${PERIOD},
       v AS (
         SELECT sv.viewer_id, sv.viewed_at, sv.was_following FROM story_views sv, w
         WHERE sv.story_id IN (SELECT id FROM mine) AND sv.viewed_at >= w.prev_lo)
       SELECT to_char(w.first_day, 'YYYY-MM-DD') AS first_day, to_char(w.today, 'YYYY-MM-DD') AS today,
         (SELECT count(DISTINCT viewer_id) FROM v WHERE v.viewed_at >= w.lo) AS reached,
         (SELECT count(DISTINCT viewer_id) FROM v WHERE v.viewed_at >= w.lo AND v.was_following) AS reached_followers,
         (SELECT count(*) FROM v WHERE v.viewed_at >= w.lo) AS views,
         (SELECT count(DISTINCT viewer_id) FROM v WHERE v.viewed_at < w.lo) AS prev_reached,
         (SELECT count(*) FROM v WHERE v.viewed_at < w.lo) AS prev_views,
         (SELECT count(*) FROM mine WHERE mine.created_at >= w.lo) AS stories_posted,
         (SELECT count(*) FROM story_likes l WHERE l.story_id IN (SELECT id FROM mine) AND l.created_at >= w.lo AND l.user_id <> :'me') AS likes,
         (SELECT count(*) FROM story_comments c WHERE c.story_id IN (SELECT id FROM mine) AND c.created_at >= w.lo
            AND c.deleted_at IS NULL AND c.user_id <> :'me') AS comments,
         (SELECT count(*) FROM messages m WHERE m.reply_story_id IN (SELECT id FROM mine) AND m.created_at >= w.lo AND m.sender_id <> :'me') AS replies,
         (SELECT count(*) FROM story_shares sh WHERE sh.story_id IN (SELECT id FROM mine) AND sh.created_at >= w.lo AND sh.user_id <> :'me') AS shares,
         (SELECT to_char((started_at AT TIME ZONE :'tz')::date, 'YYYY-MM-DD') FROM follower_history_start LIMIT 1) AS history_since
       FROM w`,
      params,
    ),
    query(
      `WITH ${PERIOD},
       days AS (SELECT g::date AS day FROM w, generate_series(w.first_day::timestamp, w.today::timestamp, interval '1 day') g),
       views AS (
         SELECT (sv.viewed_at AT TIME ZONE :'tz')::date AS day, count(*) AS n FROM story_views sv, w
         WHERE sv.story_id IN (SELECT id FROM mine) AND sv.viewed_at >= w.lo GROUP BY 1),
       changes AS (
         SELECT (fc.changed_at AT TIME ZONE :'tz')::date AS day,
                count(*) FILTER (WHERE fc.change > 0) AS gained, count(*) FILTER (WHERE fc.change < 0) AS lost
         FROM follower_changes fc, w WHERE fc.followee_id = :'me' AND fc.changed_at >= w.lo GROUP BY 1),
       counted AS (SELECT (started_at AT TIME ZONE :'tz')::date AS since FROM follower_history_start LIMIT 1)
       SELECT to_char(d.day, 'YYYY-MM-DD') AS day, coalesce(v.n, 0) AS views,
              CASE WHEN d.day >= (SELECT since FROM counted) THEN coalesce(c.gained, 0) END AS gained,
              CASE WHEN d.day >= (SELECT since FROM counted) THEN coalesce(c.lost, 0) END AS lost
       FROM days d LEFT JOIN views v ON v.day = d.day LEFT JOIN changes c ON c.day = d.day
       ORDER BY d.day`,
      params,
    ),
    query(
      `WITH ${PERIOD}
       SELECT s.id, s.media_id, to_json(s.created_at) #>> '{}' AS created_at, to_json(s.expires_at) #>> '{}' AS expires_at,
         (SELECT count(*) FROM story_views sv WHERE sv.story_id = s.id) AS views,
         (SELECT count(*) FROM story_likes l WHERE l.story_id = s.id AND l.user_id <> :'me') AS likes,
         (SELECT count(*) FROM messages m WHERE m.reply_story_id = s.id AND m.sender_id <> :'me') AS replies,
         (SELECT count(*) FROM story_shares sh WHERE sh.story_id = s.id AND sh.user_id <> :'me') AS shares
       FROM stories s, w
       WHERE s.id IN (SELECT id FROM mine WHERE mine.created_at >= w.lo)
       ORDER BY views DESC, s.created_at DESC
       LIMIT :'limit'`,
      { ...params, limit: TOP_STORIES },
    ),
    followCounts(ownerId),
    audienceHours(ownerId, timeZone),
  ]);

  const media = await mediaRepo.findMediaByIds(top.map((r) => r.media_id as string));
  const dailyRows: DashboardDay[] = daily.map((r) => ({
    day: r.day as string,
    views: num(r.views),
    followersGained: r.gained === null ? null : num(r.gained),
    followersLost: r.lost === null ? null : num(r.lost),
  }));
  const wholePeriodCounted = dailyRows.every((d) => d.followersGained !== null);
  return {
    days,
    timeZone,
    from: summary?.first_day as string,
    to: summary?.today as string,
    summary: {
      accountsReached: num(summary?.reached),
      reachedFollowers: num(summary?.reached_followers),
      storyViews: num(summary?.views),
      storiesPosted: num(summary?.stories_posted),
      likes: num(summary?.likes),
      comments: num(summary?.comments),
      replies: num(summary?.replies),
      shares: num(summary?.shares),
      followers: counts.followers,
      followersNet: wholePeriodCounted ? dailyRows.reduce((n, d) => n + (d.followersGained ?? 0) - (d.followersLost ?? 0), 0) : null,
    },
    previous: { accountsReached: num(summary?.prev_reached), storyViews: num(summary?.prev_views) },
    daily: dailyRows,
    followerHistorySince: summary?.history_since as string,
    topStories: top.map((r: Row) => {
      const m = media.get(r.media_id as string);
      return {
        id: r.id as string,
        mediaId: r.media_id as string,
        createdAt: r.created_at as string,
        expiresAt: r.expires_at as string,
        views: num(r.views),
        likes: num(r.likes),
        replies: num(r.replies),
        shares: num(r.shares),
        media: m ? deliveryFor(m, true) : null,
      };
    }),
    audience,
  };
}

/**
 * When your followers had the app open over the last 7 days, by hour of your day: for each hour,
 * how many follower-days were active in it, as a share (0-100) of the busiest hour. Reused for
 * AUDIENCE_REFRESH_HOURS, and counted again sooner if your time zone changed.
 */
export async function audienceHours(ownerId: string, timeZone: string, now = new Date()): Promise<AudienceHours> {
  let cached = await queryOne(
    `SELECT hours, active_followers, sampled_followers, to_json(computed_at) #>> '{}' AS computed_at,
            computed_at > :'now'::timestamptz - make_interval(hours => :'hours'::int) AND time_zone = :'tz' AS fresh
     FROM professional_audience_hours WHERE user_id = :'me'`,
    { me: ownerId, tz: timeZone, hours: AUDIENCE_REFRESH_HOURS, now: now.toISOString() },
  );
  if (cached?.fresh !== "t") cached = await countAudienceHours(ownerId, timeZone);
  const active = num(cached?.active_followers);
  if (!cached || active < MIN_ACTIVE_FOLLOWERS) return { status: "not_enough", minimumFollowers: MIN_ACTIVE_FOLLOWERS };
  const hours = (JSON.parse(String(cached.hours)) as number[]).map((n) => Math.max(0, Math.min(100, Math.round(Number(n) || 0))));
  return {
    status: "ready",
    hours,
    peakHour: hours.indexOf(Math.max(...hours)),
    basedOnFollowers: active,
    sampled: num(cached.sampled_followers) >= AUDIENCE_SAMPLE_LIMIT,
    computedAt: cached.computed_at as string,
  };
}

/** Counts active hours afresh and keeps them; only the shares are stored, never the counts. */
async function countAudienceHours(ownerId: string, timeZone: string): Promise<Row | null> {
  const row = await queryOne(
    `WITH f AS (
       SELECT follower_id FROM follows WHERE followee_id = :'me' ORDER BY created_at DESC LIMIT :'sample'),
     a AS (
       SELECT h.user_id, (h.slot AT TIME ZONE :'tz')::date AS day, extract(hour FROM h.slot AT TIME ZONE :'tz')::int AS hour
       FROM f JOIN activity_half_hours h ON h.user_id = f.follower_id AND h.slot >= now() - interval '7 days'),
     per AS (SELECT hour, count(DISTINCT (user_id, day)) AS n FROM a GROUP BY hour)
     SELECT (SELECT count(*) FROM f) AS sampled, (SELECT count(DISTINCT user_id) FROM a) AS active,
            coalesce((SELECT jsonb_object_agg(hour, n) FROM per), '{}'::jsonb) AS per`,
    { me: ownerId, tz: timeZone, sample: AUDIENCE_SAMPLE_LIMIT },
  );
  const per = JSON.parse(String(row?.per ?? "{}")) as Record<string, number>;
  const counts = Array.from({ length: 24 }, (_, h) => Number(per[String(h)] ?? 0));
  const peak = Math.max(...counts);
  const shares = counts.map((n) => (peak > 0 ? Math.round((n / peak) * 100) : 0));
  return queryOne(
    `INSERT INTO professional_audience_hours (user_id, time_zone, hours, active_followers, sampled_followers, computed_at)
     VALUES (:'me', :'tz', :'hours'::jsonb, :'active'::int, :'sampled'::int, now())
     ON CONFLICT (user_id) DO UPDATE SET time_zone = EXCLUDED.time_zone, hours = EXCLUDED.hours,
       active_followers = EXCLUDED.active_followers, sampled_followers = EXCLUDED.sampled_followers, computed_at = EXCLUDED.computed_at
     RETURNING hours, active_followers, sampled_followers, to_json(computed_at) #>> '{}' AS computed_at`,
    { me: ownerId, tz: timeZone, hours: JSON.stringify(shares), active: num(row?.active), sampled: num(row?.sampled) },
  );
}
