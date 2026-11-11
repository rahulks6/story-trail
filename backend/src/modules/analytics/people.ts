/**
 * How many real people use Katkee, for the Admin Analytics page: accounts, how many are new,
 * verified and have a profile photo, sign-ups per day and the weekly growth report. Counts only,
 * never who; the invite leaderboard (who brought people in) is separate, behind users.view.
 *
 * Test accounts are left out: the release pipeline's emulator runs and store screenshots sign
 * up as support+e2e-…@katkee.com (auth/ci-verify.ts), so they never inflate the numbers.
 */
import { config } from "../../config/env";
import { query, queryOne } from "../../db/psql";

/** The address every automated test account uses (auth/ci-verify.ts CI_EMAIL, as SQL). */
export const TEST_ACCOUNT_SQL = `coalesce(email, '') ~* '^support\\+e2e-[a-z0-9-]{1,40}@katkee\\.com$'`;

export interface PeopleSummary {
  timeZone: string;
  /** Accounts that can be used now (not deleted, not suspended). */
  accounts: number;
  newToday: number;
  newLast7Days: number;
  newLast30Days: number;
  verifiedEmail: number;
  withProfilePhoto: number;
  deleted: number;
  suspended: number;
  /** Test accounts alive right now, left out of every number above. */
  testAccounts: number;
  /** Real sign-ups per day (in the analytics time zone), the last 30 days, oldest first. */
  signupsByDay: { day: string; count: number }[];
  /** Founding member numbers given out so far (of FOUNDING_MEMBERS). */
  foundingMembers: number;
  /** The weekly growth report: the last WEEKS weeks (Monday to Sunday), oldest first. */
  weeks: GrowthWeek[];
}

export const FOUNDING_MEMBERS = 1000;
export const WEEKS = 6;

/**
 * One week of new people: how many signed up, how many of them posted a Story in their first 7
 * days, and how many came back in their second week (opened the app 7 to 13 days after signing
 * up). "Came back" is only counted for people who signed up at least 14 days ago (`cameBackOf`):
 * for the others it's too early to tell. Invited is how many were credited to someone's link.
 */
export interface GrowthWeek {
  weekStart: string;
  signups: number;
  invited: number;
  postedFirstWeek: number;
  cameBack: number;
  cameBackOf: number;
}

export async function peopleSummary(): Promise<PeopleSummary> {
  const tz = config.analytics.timeZone;
  const row = await queryOne(
    `WITH real AS (SELECT * FROM users WHERE NOT (${TEST_ACCOUNT_SQL})),
          live AS (SELECT * FROM real WHERE deleted_at IS NULL AND is_active),
          today AS (SELECT (now() AT TIME ZONE :'tz')::date AS d)
     SELECT jsonb_build_object(
       'accounts', (SELECT count(*) FROM live),
       'newToday', (SELECT count(*) FROM live WHERE (created_at AT TIME ZONE :'tz')::date = (SELECT d FROM today)),
       'newLast7Days', (SELECT count(*) FROM live WHERE created_at >= now() - interval '7 days'),
       'newLast30Days', (SELECT count(*) FROM live WHERE created_at >= now() - interval '30 days'),
       'verifiedEmail', (SELECT count(*) FROM live WHERE email_verified_at IS NOT NULL),
       'withProfilePhoto', (SELECT count(*) FROM live WHERE avatar_media_id IS NOT NULL),
       'deleted', (SELECT count(*) FROM real WHERE deleted_at IS NOT NULL),
       'suspended', (SELECT count(*) FROM real WHERE deleted_at IS NULL AND NOT is_active),
       'testAccounts', (SELECT count(*) FROM users WHERE ${TEST_ACCOUNT_SQL} AND deleted_at IS NULL),
       'signupsByDay', (
         SELECT coalesce(jsonb_agg(jsonb_build_object('day', day, 'count', n) ORDER BY day), '[]'::jsonb)
         FROM (
           SELECT g.day::date AS day, count(r.id) AS n
           FROM generate_series((SELECT d FROM today) - 29, (SELECT d FROM today), interval '1 day') AS g(day)
           LEFT JOIN real r ON (r.created_at AT TIME ZONE :'tz')::date = g.day::date
           GROUP BY g.day
         ) days
       ),
       'foundingMembers', (SELECT count(*) FROM users WHERE founding_number IS NOT NULL),
       'weeks', (
         SELECT coalesce(jsonb_agg(to_jsonb(wk) ORDER BY wk."weekStart"), '[]'::jsonb)
         FROM (
           SELECT w.week AS "weekStart", count(r.id) AS signups,
                  count(r.id) FILTER (WHERE EXISTS (SELECT 1 FROM invite_redemptions i WHERE i.invitee_id = r.id)) AS invited,
                  count(r.id) FILTER (WHERE EXISTS (
                    SELECT 1 FROM stories s WHERE s.owner_id = r.id AND s.created_at < r.created_at + interval '7 days')) AS "postedFirstWeek",
                  count(r.id) FILTER (WHERE r.created_at <= now() - interval '14 days' AND EXISTS (
                    SELECT 1 FROM analytics_active_days a WHERE a.user_id = r.id
                      AND a.day BETWEEN (r.created_at AT TIME ZONE :'tz')::date + 7 AND (r.created_at AT TIME ZONE :'tz')::date + 13)) AS "cameBack",
                  count(r.id) FILTER (WHERE r.created_at <= now() - interval '14 days') AS "cameBackOf"
           FROM (
             SELECT g::date AS week
             FROM generate_series(date_trunc('week', (SELECT d FROM today)) - make_interval(weeks => :'weeks'::int - 1), date_trunc('week', (SELECT d FROM today)), interval '1 week') g
           ) w
           LEFT JOIN real r ON date_trunc('week', r.created_at AT TIME ZONE :'tz')::date = w.week
           GROUP BY w.week
         ) wk
       )
     ) AS data`,
    { tz, weeks: WEEKS },
  );
  // JSON comes back as text (db/psql), as in rollup.ts.
  const data = JSON.parse(String(row?.data ?? "{}")) as Omit<PeopleSummary, "timeZone">;
  return {
    timeZone: tz,
    accounts: Number(data.accounts ?? 0),
    newToday: Number(data.newToday ?? 0),
    newLast7Days: Number(data.newLast7Days ?? 0),
    newLast30Days: Number(data.newLast30Days ?? 0),
    verifiedEmail: Number(data.verifiedEmail ?? 0),
    withProfilePhoto: Number(data.withProfilePhoto ?? 0),
    deleted: Number(data.deleted ?? 0),
    suspended: Number(data.suspended ?? 0),
    testAccounts: Number(data.testAccounts ?? 0),
    signupsByDay: (data.signupsByDay ?? []).map((d) => ({ day: String(d.day), count: Number(d.count) })),
    foundingMembers: Number(data.foundingMembers ?? 0),
    weeks: (data.weeks ?? []).map((w) => ({
      weekStart: String(w.weekStart),
      signups: Number(w.signups),
      invited: Number(w.invited),
      postedFirstWeek: Number(w.postedFirstWeek),
      cameBack: Number(w.cameBack),
      cameBackOf: Number(w.cameBackOf),
    })),
  };
}

/** Someone whose invite link brought people in, for the ambassadors' leaderboard. */
export interface InviteLeader {
  username: string;
  displayName: string;
  /** People credited to their link who still have an account. */
  joined: number;
  /** Of those, how many have posted a Story. */
  posted: number;
  joinedLast7Days: number;
}

/**
 * Who brought the most people in through their invite link (growth/invites.ts), most first:
 * the numbers an ambassador competition is judged on. Test accounts are left out on both sides.
 */
export async function inviteLeaders(limit = 50): Promise<InviteLeader[]> {
  const rows = await query(
    `SELECT u.username, u.display_name,
            count(*) AS joined,
            count(*) FILTER (WHERE EXISTS (SELECT 1 FROM stories s WHERE s.owner_id = i.id)) AS posted,
            count(*) FILTER (WHERE r.created_at > now() - interval '7 days') AS joined_last_7
     FROM invite_redemptions r
     JOIN users u ON u.id = r.inviter_id AND u.deleted_at IS NULL
     JOIN users i ON i.id = r.invitee_id AND i.deleted_at IS NULL
     WHERE NOT (${TEST_ACCOUNT_SQL.replace("email", "u.email")}) AND NOT (${TEST_ACCOUNT_SQL.replace("email", "i.email")})
     GROUP BY u.id, u.username, u.display_name
     ORDER BY count(*) DESC, max(r.created_at) DESC
     LIMIT :'limit'`,
    { limit },
  );
  return rows.map((row) => ({
    username: row.username as string,
    displayName: row.display_name as string,
    joined: Number(row.joined),
    posted: Number(row.posted),
    joinedLast7Days: Number(row.joined_last_7),
  }));
}
