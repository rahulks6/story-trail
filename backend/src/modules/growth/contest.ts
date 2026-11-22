/**
 * The invite contest (migration 0083): whoever brings the most friends to Katkee with their invite
 * link (growth/invites.ts) between a contest's starts_at and ends_at wins its prize.
 *
 * A friend counts for their inviter once they have used Katkee on `qualify_days` different days
 * (analytics_active_days, recorded by the server for every signed-in request, so it doesn't depend
 * on analytics consent), up to counts_until. An account made just to pad the count, opened once,
 * never counts; neither does a deleted, suspended or restricted one, or a test account. Katkee's
 * own and staff accounts can't win. Ties go to whoever reached their count first. The winner is
 * still checked by a person before the prize is sent (Admin > Invite contest).
 *
 * The contest is shown to people using Katkee in English, Hindi or Marathi: the prize is an
 * Amazon.in voucher and the contest is open to people in India.
 */
import type { Router } from "../../http/router";
import { requireAuth } from "../../http/middleware/auth.middleware";
import { sendJson } from "../../http/respond";
import { query, queryOne } from "../../db/psql";
import { config } from "../../config/env";
import { requireAdmin } from "../admin/security";
import { TEST_ACCOUNT_SQL } from "../analytics/people";

export const CONTEST_RULES_URL = "https://katkee.com/contest";
/** The contest is for India: shown to people using Katkee in these languages. */
export const CONTEST_LOCALES = ["en", "hi", "mr"];
/** How long after counts_until the results stay up in the app. */
const RESULTS_SHOWN = "14 days";
const LEADERS_SHOWN = 10;
/** Pushes per round, so a big announcement goes out over a few rounds. */
const PUSHES_PER_ROUND = 2000;
/** Hour of the day in India (return-reasons.ts runs this module, so not imported from there). */
const hourInIndia = (now: Date): number => Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", hourCycle: "h23" }).format(now));

export interface Contest {
  id: string;
  slug: string;
  prizeMinor: number;
  startsAt: string;
  endsAt: string;
  countsUntil: string;
  qualifyDays: number;
  announceAt: string | null;
  winnerId: string | null;
}

function mapContest(row: Record<string, string | null>): Contest {
  return {
    id: row.id as string,
    slug: row.slug as string,
    prizeMinor: Number(row.prize_minor),
    startsAt: new Date(row.starts_at as string).toISOString(),
    endsAt: new Date(row.ends_at as string).toISOString(),
    countsUntil: new Date(row.counts_until as string).toISOString(),
    qualifyDays: Number(row.qualify_days),
    announceAt: row.announce_at ? new Date(row.announce_at).toISOString() : null,
    winnerId: row.winner_id ?? null,
  };
}

/** The contest running now, or whose results are still shown; the latest if there are several. */
export async function currentContest(): Promise<Contest | null> {
  const row = await queryOne(
    `SELECT * FROM invite_contests WHERE starts_at <= now() AND counts_until + interval '${RESULTS_SHOWN}' > now()
     ORDER BY starts_at DESC LIMIT 1`,
  );
  return row ? mapContest(row) : null;
}

const day = (column: string) => `(${column} AT TIME ZONE :'tz')::date`;
const tz = () => config.analytics.timeZone;

/**
 * Every invited friend in the contest: who invited them, when they joined, on how many different
 * days they have used Katkee (counting until counts_until) and the day they started to count.
 * Only real, usable accounts on both sides.
 */
const FRIENDS_SQL = `
  c AS (SELECT * FROM invite_contests WHERE id = :'contest'),
  friends AS (
    SELECT r.inviter_id, r.invitee_id, r.created_at AS joined_at,
           (SELECT count(DISTINCT a.day) FROM analytics_active_days a, c
             WHERE a.user_id = r.invitee_id AND a.day >= ${day("r.created_at")} AND a.day < ${day("c.counts_until")}) AS active_days,
           (SELECT d.day FROM (SELECT DISTINCT a.day FROM analytics_active_days a, c
                                WHERE a.user_id = r.invitee_id AND a.day >= ${day("r.created_at")} AND a.day < ${day("c.counts_until")}) d
             ORDER BY d.day OFFSET (SELECT qualify_days - 1 FROM c) LIMIT 1) AS counted_on
    FROM invite_redemptions r
    JOIN c ON r.created_at >= c.starts_at AND r.created_at < c.ends_at
    JOIN users i ON i.id = r.invitee_id
    JOIN users u ON u.id = r.inviter_id
    WHERE i.deleted_at IS NULL AND i.moderation_state = 'ACTIVE' AND NOT (${TEST_ACCOUNT_SQL.replace("email", "i.email")})
      AND u.deleted_at IS NULL AND u.is_active AND u.moderation_state = 'ACTIVE' AND NOT u.is_official
      AND NOT (${TEST_ACCOUNT_SQL.replace("email", "u.email")})
      AND NOT EXISTS (SELECT 1 FROM admin_grants g WHERE g.user_id = u.id)),
  standings AS (
    SELECT inviter_id, count(counted_on) AS counted, count(*) - count(counted_on) AS pending,
           max(counted_on) AS reached_on, max(joined_at) FILTER (WHERE counted_on IS NOT NULL) AS last_joined
    FROM friends GROUP BY inviter_id),
  ranked AS (
    SELECT s.*, CASE WHEN s.counted > 0 THEN rank() OVER (ORDER BY s.counted DESC, s.reached_on, s.last_joined) END AS place
    FROM standings s)`;

export interface Leader {
  rank: number;
  userId: string;
  username: string;
  displayName: string;
  avatarMediaId: string | null;
  counted: number;
}

export interface FriendProgress {
  username: string;
  displayName: string;
  activeDays: number;
  counted: boolean;
}

export interface ContestView {
  slug: string;
  prize: { amountMinor: number; currency: "INR"; kind: "amazon_voucher" };
  startsAt: string;
  endsAt: string;
  countsUntil: string;
  qualifyDays: number;
  state: "running" | "counting" | "final";
  rulesUrl: string;
  winner: { username: string; displayName: string } | null;
  me: { counted: number; pending: number; rank: number | null; toFirst: number | null; friends: FriendProgress[] };
  leaders: Leader[];
}

export async function contestLeaders(contest: Contest, limit = LEADERS_SHOWN): Promise<Leader[]> {
  const rows = await query(
    `WITH ${FRIENDS_SQL}
     SELECT r.place, u.id, u.username, u.display_name, u.avatar_media_id, r.counted
     FROM ranked r JOIN users u ON u.id = r.inviter_id
     WHERE r.place IS NOT NULL ORDER BY r.place, u.username LIMIT :'limit'`,
    { contest: contest.id, tz: tz(), limit },
  );
  return rows.map((row) => ({
    rank: Number(row.place),
    userId: row.id as string,
    username: row.username as string,
    displayName: row.display_name as string,
    avatarMediaId: row.avatar_media_id ?? null,
    counted: Number(row.counted),
  }));
}

export async function contestView(contest: Contest, userId: string): Promise<ContestView> {
  const [leaders, mine, friends, winner] = await Promise.all([
    contestLeaders(contest),
    queryOne(`WITH ${FRIENDS_SQL} SELECT counted, pending, place FROM ranked WHERE inviter_id = :'me'`, { contest: contest.id, tz: tz(), me: userId }),
    query(
      `WITH ${FRIENDS_SQL}
       SELECT u.username, u.display_name, f.active_days, f.counted_on IS NOT NULL AS counted
       FROM friends f JOIN users u ON u.id = f.invitee_id WHERE f.inviter_id = :'me' ORDER BY f.joined_at DESC LIMIT 50`,
      { contest: contest.id, tz: tz(), me: userId },
    ),
    contest.winnerId ? queryOne(`SELECT username, display_name FROM users WHERE id = :'id' AND deleted_at IS NULL`, { id: contest.winnerId }) : null,
  ]);
  const counted = Number(mine?.counted ?? 0);
  const rank = mine?.place ? Number(mine.place) : null;
  const first = leaders[0]?.counted ?? 0;
  const now = Date.now();
  return {
    slug: contest.slug,
    prize: { amountMinor: contest.prizeMinor, currency: "INR", kind: "amazon_voucher" },
    startsAt: contest.startsAt,
    endsAt: contest.endsAt,
    countsUntil: contest.countsUntil,
    qualifyDays: contest.qualifyDays,
    state: now < Date.parse(contest.endsAt) ? "running" : now < Date.parse(contest.countsUntil) ? "counting" : "final",
    rulesUrl: CONTEST_RULES_URL,
    winner: winner ? { username: winner.username as string, displayName: winner.display_name as string } : null,
    me: {
      counted,
      pending: Number(mine?.pending ?? 0),
      rank,
      // Friends still needed to be first on their own (0 when already first alone).
      toFirst: rank === 1 && leaders.filter((l) => l.rank === 1).length === 1 ? 0 : first - counted + 1,
      friends: friends.map((row) => ({
        username: row.username as string,
        displayName: row.display_name as string,
        activeDays: Math.min(Number(row.active_days), contest.qualifyDays),
        counted: row.counted === "t",
      })),
    },
    leaders,
  };
}

/** Everyone in the contest with each of their friends, for checking before the prize is sent. */
export async function contestReview(contest: Contest): Promise<Array<Record<string, unknown>>> {
  const rows = await query(
    `WITH ${FRIENDS_SQL}
     SELECT jsonb_build_object(
       'rank', r.place, 'username', u.username, 'displayName', u.display_name, 'joinedAt', u.created_at,
       'counted', r.counted, 'pending', r.pending,
       'friends', (SELECT coalesce(jsonb_agg(jsonb_build_object(
           'username', i.username, 'displayName', i.display_name, 'joinedAt', f.joined_at, 'activeDays', f.active_days,
           'counted', f.counted_on IS NOT NULL, 'hasAvatar', i.avatar_media_id IS NOT NULL,
           'following', (SELECT count(*) FROM follows x WHERE x.follower_id = i.id),
           'stories', (SELECT count(*) FROM stories s WHERE s.owner_id = i.id AND s.deleted_at IS NULL),
           'source', (SELECT e.properties->>'source' FROM analytics_events e WHERE e.user_id = i.id AND e.name = 'install_source' ORDER BY e.occurred_at LIMIT 1))
           ORDER BY f.joined_at), '[]'::jsonb)
         FROM friends f JOIN users i ON i.id = f.invitee_id WHERE f.inviter_id = r.inviter_id)) AS data
     FROM ranked r JOIN users u ON u.id = r.inviter_id
     ORDER BY r.place NULLS LAST, r.pending DESC, u.username LIMIT 200`,
    { contest: contest.id, tz: tz() },
  );
  return rows.map((row) => JSON.parse(row.data as string) as Record<string, unknown>);
}

/**
 * Contest pushes, for people with reminders on:
 * - the announcement, once, from announce_at until the contest ends (8am-10pm India time);
 * - "@friend now counts for you", to the inviter, once per friend, while friends can still count.
 */
export async function queueContestPushes(now = new Date()): Promise<number> {
  const contest = await currentContest();
  if (!contest || now.getTime() >= Date.parse(contest.countsUntil)) return 0;
  let queued = 0;
  const hour = hourInIndia(now);
  if (contest.announceAt && Date.parse(contest.announceAt) <= now.getTime() && now.getTime() < Date.parse(contest.endsAt) && hour >= 8 && hour < 22) {
    const rows = await query(
      `WITH targets AS (
         SELECT u.id FROM users u LEFT JOIN notification_preferences p ON p.user_id = u.id
         WHERE u.is_active AND u.deleted_at IS NULL AND u.moderation_state = 'ACTIVE' AND NOT u.is_official
           AND coalesce(u.locale, 'en') IN ('en', 'hi', 'mr')
           AND coalesce(p.push_enabled, true) AND coalesce(p.reminders_enabled, true)
           AND EXISTS (SELECT 1 FROM push_devices d WHERE d.user_id = u.id AND d.disabled_at IS NULL)
           AND NOT EXISTS (SELECT 1 FROM push_sent ps WHERE ps.user_id = u.id AND ps.kind = 'invite_contest' AND ps.ref_key = :'slug')
         LIMIT :'limit'),
       sent AS (
         INSERT INTO push_sent (user_id, kind, ref_key) SELECT id, 'invite_contest', :'slug' FROM targets
         ON CONFLICT DO NOTHING RETURNING user_id)
       INSERT INTO push_outbox (user_id, kind, body, link, params)
       SELECT user_id, 'invite_contest', :'body', 'katkee://contest', jsonb_build_object('prize', :'prize'::integer) FROM sent
       RETURNING id`,
      { slug: contest.slug, limit: PUSHES_PER_ROUND, prize: contest.prizeMinor / 100, body: `🏆 Invite your friends to Katkee and win a ₹${(contest.prizeMinor / 100).toLocaleString("en-IN")} Amazon voucher` },
    );
    queued += rows.length;
  }
  const counted = await query(
    `WITH ${FRIENDS_SQL},
     fresh AS (
       SELECT f.inviter_id, f.invitee_id, (SELECT counted FROM standings s WHERE s.inviter_id = f.inviter_id) AS total
       FROM friends f WHERE f.counted_on IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM push_sent ps WHERE ps.user_id = f.inviter_id AND ps.kind = 'contest_counted' AND ps.ref_key = f.invitee_id::text)
       LIMIT :'limit'),
     sent AS (
       INSERT INTO push_sent (user_id, kind, ref_key) SELECT inviter_id, 'contest_counted', invitee_id::text FROM fresh
       ON CONFLICT DO NOTHING RETURNING user_id, ref_key)
     INSERT INTO push_outbox (user_id, kind, actor_id, body, link, params)
     SELECT sent.user_id, 'contest_counted', sent.ref_key::uuid,
            '@' || i.username || ' now counts for you in the invite contest 🏆 ' || fresh.total || ' so far', 'katkee://contest',
            jsonb_build_object('count', fresh.total)
     FROM sent JOIN fresh ON fresh.invitee_id::text = sent.ref_key JOIN users i ON i.id = fresh.invitee_id
     RETURNING id`,
    { contest: contest.id, tz: tz(), limit: PUSHES_PER_ROUND },
  );
  return queued + counted.length;
}

export function registerContestRoutes(router: Router): void {
  // The contest now (or its results): the leaderboard, your place and your friends' progress.
  router.get("/api/v1/contest", async (req, res) => {
    requireAuth(req);
    const userId = req.userId as string;
    const [contest, me] = await Promise.all([currentContest(), queryOne(`SELECT locale FROM users WHERE id = :'id'`, { id: userId })]);
    res.setHeader("Cache-Control", "no-store");
    const shown = contest && CONTEST_LOCALES.includes(me?.locale ?? "en");
    sendJson(res, 200, { contest: shown ? await contestView(contest, userId) : null });
  });

  // Everyone taking part with each friend's details, to check the winner is real before paying.
  router.get("/api/v1/admin/contest", async (req, res) => {
    await requireAdmin(req, "users.view");
    const contest = await currentContest();
    res.setHeader("Cache-Control", "no-store");
    sendJson(res, 200, { contest, people: contest ? await contestReview(contest) : [] });
  });
}
