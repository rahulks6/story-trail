import { config } from "../../config/env";
import { openDedicatedConnection, query, queryOne } from "../../db/psql";

/** Events can arrive up to 7 days late (queued offline), so the last 8 days are recomputed. */
const RECOMPUTE_DAYS = 7;
/** Missing days are filled in this far back (the raw data is kept at least 40 days). */
const BACKFILL_DAYS = 34;
/** Retention cohorts recomputed each run: the D30 window plus late events. */
const RETENTION_DAYS = 38;

/**
 * The worker's daily aggregation (spec section 15: server-side). Recomputes today and the
 * previous 7 days, fills in any missing day since tracking started, and refreshes retention.
 * Runs on its own connection with a long statement timeout: at scale one day is a large scan,
 * and the API's 10 s limit is for requests, not batch work. Returns the days recomputed.
 */
export async function rollupAnalytics(): Promise<number> {
  if (!config.analytics.enabled) return 0;
  const tz = config.analytics.timeZone;
  const client = await openDedicatedConnection();
  try {
    await client.query("SET statement_timeout = '15min'");
    const { rows } = await client.query<{ day: string }>(
      `WITH today AS (SELECT (now() AT TIME ZONE $1)::date AS d),
       started AS (SELECT coalesce((SELECT min(day) FROM analytics_active_days), (SELECT d FROM today)) AS d)
       SELECT g::date::text AS day
       FROM generate_series(((SELECT d FROM today) - $2::int)::timestamp, (SELECT d FROM today)::timestamp, interval '1 day') g
       WHERE g::date >= (SELECT d FROM started)
         AND (g::date >= (SELECT d FROM today) - $3::int OR NOT EXISTS (SELECT 1 FROM analytics_daily WHERE day = g::date))
       ORDER BY 1`,
      [tz, BACKFILL_DAYS, RECOMPUTE_DAYS],
    );
    for (const { day } of rows) await client.query("SELECT analytics_rollup_day($1::date, $2)", [day, tz]);
    // Cohorts from before tracking started would read as 0% retained, so they're skipped.
    await client.query(
      `WITH today AS (SELECT (now() AT TIME ZONE $1)::date AS d)
       SELECT analytics_rollup_retention(greatest((SELECT d FROM today) - $2::int, (SELECT min(day) FROM analytics_active_days)), (SELECT d FROM today), $1)
       WHERE EXISTS (SELECT 1 FROM analytics_active_days)`,
      [tz, RETENTION_DAYS],
    );
    return rows.length;
  } finally {
    await client.end();
  }
}

/** Deletes raw events and per-person activity days older than ANALYTICS_RAW_RETENTION_DAYS. */
export async function purgeRawAnalytics(batchSize: number, days: number = config.analytics.rawRetentionDays): Promise<number> {
  const batch = Math.max(100, batchSize * 25);
  let total = 0;
  for (let pass = 0; pass < 50; pass++) {
    const events = await queryOne(
      `WITH gone AS (DELETE FROM analytics_events WHERE id IN (
         SELECT id FROM analytics_events WHERE occurred_at < now() - make_interval(days => :'days') LIMIT :'batch')
       RETURNING 1) SELECT count(*) AS n FROM gone`,
      { days, batch },
    );
    const active = await queryOne(
      `WITH gone AS (DELETE FROM analytics_active_days WHERE (day, platform, user_id) IN (
         SELECT day, platform, user_id FROM analytics_active_days WHERE day < (now() AT TIME ZONE :'tz')::date - :'days'::int LIMIT :'batch')
       RETURNING 1) SELECT count(*) AS n FROM gone`,
      { days, batch, tz: config.analytics.timeZone },
    );
    const removed = Number(events?.n ?? 0) + Number(active?.n ?? 0);
    total += removed;
    if (Number(events?.n ?? 0) < batch && Number(active?.n ?? 0) < batch) break;
  }
  return total;
}

type Counts = Record<string, Record<string, unknown>>;

const num = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : Number(value) || 0);
/** A rate, or null when there is nothing to divide by (shown as "–", never as 0%). */
const ratio = (part: unknown, whole: unknown): number | null => (num(whole) > 0 ? Math.round((num(part) / num(whole)) * 10000) / 10000 : null);

/** Rates derived from one day's (or a period's) counts. */
export function deriveRates(m: Counts): Record<string, number | null> {
  const s = m.stories ?? {}, app = m.app ?? {}, ads = m.ads ?? {};
  return {
    storiesPerViewer: num(s.viewers) > 0 ? Math.round((num(s.views) / num(s.viewers)) * 100) / 100 : null,
    completionRate: ratio(s.completedViews, s.views),
    averageWatchSeconds: num(s.watchSamples) > 0 ? Math.round(num(s.watchMs) / num(s.watchSamples) / 100) / 10 : null,
    uploadSuccessRate: ratio(app.uploadsSucceeded, num(app.uploadsSucceeded) + num(app.uploadsFailed)),
    crashFreeSessions: num(app.sessions) > 0 ? Math.round((1 - num(app.crashedSessions) / num(app.sessions)) * 10000) / 10000 : null,
    adClickRate: ratio(ads.clicks, ads.impressions),
    adCompletionRate: ratio(ads.completions, ads.impressions),
    adHideRate: ratio(ads.hides, ads.impressions),
    adReportRate: ratio(ads.reports, ads.impressions),
  };
}

/** Distinct-per-day counts: summing them across days would mean nothing. */
const NOT_ADDITIVE = new Set(["activeCreators", "senders"]);

/**
 * Adds up the additive counts of several days. Distinct counts (DAU, active creators, DM
 * senders) are not additive; "viewers" is kept as viewer-days, so the period's Stories per
 * viewer reads as "per viewer per day".
 */
export function sumCounts(days: Counts[]): Counts {
  const total: Counts = {};
  for (const day of days) {
    for (const [area, values] of Object.entries(day)) {
      if (area === "users") {
        // Only signups add up across days; active-user counts are distinct per window.
        const users = (total.users ??= {});
        users.registrations = num(users.registrations) + num(values.registrations);
        continue;
      }
      const into = (total[area] ??= {});
      for (const [key, value] of Object.entries(values)) {
        if (typeof value === "number" && !NOT_ADDITIVE.has(key)) into[key] = num(into[key]) + value;
      }
    }
  }
  return total;
}

/**
 * The Admin analytics dashboard: daily totals for the last `days` days, retention by signup
 * day, live active-user counts and the moderation backlog. Aggregates only: no person, Story
 * or message is identifiable from anything returned here.
 */
export async function analyticsOverview(days: number): Promise<Record<string, unknown>> {
  const tz = config.analytics.timeZone;
  const row = await queryOne(
    `WITH today AS (SELECT (now() AT TIME ZONE :'tz')::date AS d)
     SELECT jsonb_build_object(
       'today', (SELECT d FROM today),
       'live', (SELECT jsonb_build_object(
           'dau', count(DISTINCT user_id) FILTER (WHERE day = (SELECT d FROM today)),
           'wau', count(DISTINCT user_id) FILTER (WHERE day > (SELECT d FROM today) - 7),
           'mau', count(DISTINCT user_id))
         FROM analytics_active_days WHERE day > (SELECT d FROM today) - 30 AND day <= (SELECT d FROM today)),
       'backlog', jsonb_build_object(
         'open', (SELECT count(*) FROM reports WHERE status = 'OPEN'),
         'underReview', (SELECT count(*) FROM reports WHERE status = 'UNDER_REVIEW'),
         'appealed', (SELECT count(*) FROM reports WHERE status = 'APPEALED'),
         'appealsOpen', (SELECT count(*) FROM moderation_appeals WHERE status = 'OPEN'),
         'oldestOpenAt', (SELECT min(created_at) FROM reports WHERE status IN ('OPEN', 'UNDER_REVIEW'))),
       'daily', (SELECT coalesce(jsonb_agg(jsonb_build_object('day', day, 'metrics', metrics, 'computedAt', computed_at) ORDER BY day), '[]'::jsonb)
                 FROM analytics_daily WHERE day > (SELECT d FROM today) - :'days'::int),
       'retention', (SELECT coalesce(jsonb_agg(jsonb_build_object('cohortDay', cohort_day, 'cohortSize', cohort_size, 'd1', d1, 'd7', d7, 'd30', d30) ORDER BY cohort_day), '[]'::jsonb)
                     FROM analytics_retention WHERE cohort_day > (SELECT d FROM today) - :'days'::int - 31 AND cohort_size > 0)
     ) AS data`,
    { tz, days },
  );
  const data = JSON.parse(String(row?.data ?? "{}")) as {
    today: string; live: Record<string, number>; backlog: Record<string, unknown>;
    daily: { day: string; metrics: Counts; computedAt: string }[];
    retention: { cohortDay: string; cohortSize: number; d1: number | null; d7: number | null; d30: number | null }[];
  };
  const daily = data.daily.map((d) => ({ ...d, rates: deriveRates(d.metrics) }));
  const period = sumCounts(daily.map((d) => d.metrics));
  const latest = daily.at(-1)?.metrics.users ?? {};
  return {
    timeZone: tz,
    today: data.today,
    days,
    live: data.live,
    backlog: data.backlog,
    period: { counts: period, rates: deriveRates(period), latestUsers: latest },
    daily,
    retention: data.retention.map((c) => ({
      ...c,
      d1Rate: c.d1 === null ? null : ratio(c.d1, c.cohortSize),
      d7Rate: c.d7 === null ? null : ratio(c.d7, c.cohortSize),
      d30Rate: c.d30 === null ? null : ratio(c.d30, c.cohortSize),
    })),
    computedAt: daily.at(-1)?.computedAt ?? null,
  };
}

/** Recomputes now (Admin "Refresh"), on the same code path as the worker. */
export async function refreshAnalytics(): Promise<{ days: number }> {
  return { days: await rollupAnalytics() };
}

/** Test helper: one day's stored totals. */
export async function storedDay(day: string): Promise<Counts | null> {
  const rows = await query(`SELECT metrics FROM analytics_daily WHERE day = :'day'::date`, { day });
  return rows[0] ? (JSON.parse(String(rows[0].metrics)) as Counts) : null;
}
