/**
 * How many real people use Katkee, for the Admin Analytics page: accounts, how many are new,
 * verified and have a profile photo, and sign-ups per day. Counts only, never who.
 *
 * Test accounts are left out: the release pipeline's emulator runs and store screenshots sign
 * up as support+e2e-…@katkee.com (auth/ci-verify.ts), so they never inflate the numbers.
 */
import { config } from "../../config/env";
import { queryOne } from "../../db/psql";

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
       )
     ) AS data`,
    { tz },
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
  };
}
