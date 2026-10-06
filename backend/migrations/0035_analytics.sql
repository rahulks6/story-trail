-- Phase 4d: privacy-safe product analytics (spec section 15).
--
-- The Admin Console sees daily totals only. Nothing here is ever shared with advertisers,
-- and no free text is stored: no message content, captions, comments, search queries or
-- links. Events carry a name, a platform, a session id and a few allowlisted numeric or
-- enum properties. Most metrics (Stories, views, likes, comments, shares, follows, DMs,
-- Highlights, reports, ad events) are aggregated from the rows those features already
-- write, so nothing is counted twice.

-- 1. Who was active on which day, per platform: the source of DAU/WAU/MAU, the platform
--    split, returning users and retention. The API writes one row per user, day and
--    platform from authenticated requests, after the response and without delaying it.
--    Kept for ANALYTICS_RAW_RETENTION_DAYS, then deleted; the daily totals stay.
CREATE TABLE analytics_active_days (
  day      date NOT NULL,
  platform text NOT NULL CHECK (platform IN ('android', 'ios', 'web', 'unknown')),
  user_id  uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  PRIMARY KEY (day, platform, user_id)
);
CREATE INDEX analytics_active_days_user_idx ON analytics_active_days (user_id, day);

-- 2. Events only the app can observe: app sessions, JavaScript crashes, upload outcomes,
--    Highlight and profile views, searches and Stories started in the editor. `id` is the
--    app's stable event id, so a retried batch never counts twice.
CREATE TABLE analytics_events (
  id          uuid PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name        text NOT NULL CHECK (name IN (
                'app_session_started', 'app_crash', 'story_created', 'highlight_viewed',
                'profile_viewed', 'search_performed', 'upload_succeeded', 'upload_failed')),
  platform    text NOT NULL CHECK (platform IN ('android', 'ios', 'web', 'unknown')),
  session_id  uuid,
  app_version text CHECK (app_version ~ '^[0-9A-Za-z.+-]{1,32}$'),
  properties  jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(properties) = 'object'),
  occurred_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX analytics_events_occurred_idx ON analytics_events (occurred_at);
CREATE INDEX analytics_events_user_idx ON analytics_events (user_id);

-- 3. Daily totals (counts only; rates are derived when read). The worker recomputes today
--    and yesterday on every run and fills in any missing day.
CREATE TABLE analytics_daily (
  day         date PRIMARY KEY,
  metrics     jsonb NOT NULL CHECK (jsonb_typeof(metrics) = 'object'),
  computed_at timestamptz NOT NULL DEFAULT now()
);

-- 4. Retention by signup day: how many of the people who joined that day were active
--    exactly 1, 7 and 30 days later. NULL until that later day has finished.
CREATE TABLE analytics_retention (
  cohort_day  date PRIMARY KEY,
  cohort_size integer NOT NULL CHECK (cohort_size >= 0),
  d1          integer CHECK (d1 >= 0),
  d7          integer CHECK (d7 >= 0),
  d30         integer CHECK (d30 >= 0),
  computed_at timestamptz NOT NULL DEFAULT now()
);

-- 5. The daily rollup reads one day of each feature table. These rows are written in time
--    order, so small BRIN indexes make those range scans cheap without slowing writes.
CREATE INDEX users_created_brin ON users USING brin (created_at);
CREATE INDEX stories_created_brin ON stories USING brin (created_at);
CREATE INDEX story_views_viewed_brin ON story_views USING brin (viewed_at);
CREATE INDEX story_likes_created_brin ON story_likes USING brin (created_at);
CREATE INDEX story_comments_created_brin ON story_comments USING brin (created_at);
CREATE INDEX story_shares_created_brin ON story_shares USING brin (created_at);
CREATE INDEX follows_created_brin ON follows USING brin (created_at);
CREATE INDEX messages_created_brin ON messages USING brin (created_at);
CREATE INDEX highlights_created_brin ON highlights USING brin (created_at);
CREATE INDEX reports_created_brin ON reports USING brin (created_at);
CREATE INDEX media_created_brin ON media USING brin (created_at);
CREATE INDEX ad_events_created_brin ON ad_events USING brin (created_at);
CREATE INDEX recommendation_events_created_brin ON recommendation_events USING brin (created_at);

-- 6. One day's totals, in the analytics time zone. Idempotent: running it again replaces
--    the day's row with fresh numbers. JIT is off for both rollups: these are index-driven
--    scans, and compiling them cost ~0.5 s per call against ~1 ms of actual work.
CREATE FUNCTION analytics_rollup_day(p_day date, p_tz text) RETURNS jsonb LANGUAGE plpgsql SET jit = off AS $$
DECLARE
  lo timestamptz := p_day::timestamp AT TIME ZONE p_tz;
  hi timestamptz := (p_day + 1)::timestamp AT TIME ZONE p_tz;
  m  jsonb;
BEGIN
  SELECT jsonb_build_object(
    'users', (
      SELECT jsonb_build_object(
        'dau', count(DISTINCT a.user_id) FILTER (WHERE a.day = p_day),
        'wau', count(DISTINCT a.user_id) FILTER (WHERE a.day > p_day - 7),
        'mau', count(DISTINCT a.user_id),
        'returning', count(DISTINCT a.user_id) FILTER (WHERE a.day = p_day AND u.created_at < lo),
        'registrations', (SELECT count(*) FROM users WHERE created_at >= lo AND created_at < hi),
        'platforms', jsonb_build_object(
          'android', count(DISTINCT a.user_id) FILTER (WHERE a.day = p_day AND a.platform = 'android'),
          'ios', count(DISTINCT a.user_id) FILTER (WHERE a.day = p_day AND a.platform = 'ios'),
          'web', count(DISTINCT a.user_id) FILTER (WHERE a.day = p_day AND a.platform = 'web'),
          'unknown', count(DISTINCT a.user_id) FILTER (WHERE a.day = p_day AND a.platform = 'unknown')))
      FROM analytics_active_days a JOIN users u ON u.id = a.user_id
      WHERE a.day > p_day - 30 AND a.day <= p_day),
    'stories', (
      SELECT jsonb_build_object(
        'published', (SELECT count(*) FROM stories WHERE created_at >= lo AND created_at < hi),
        'activeCreators', (SELECT count(DISTINCT owner_id) FROM stories WHERE created_at >= lo AND created_at < hi),
        'views', v.views, 'viewers', v.viewers,
        'completions', r.completions, 'completedViews', r.completed_views, 'replays', r.replays,
        'watchMs', r.watch_ms, 'watchSamples', r.watch_samples,
        'highlightsCreated', (SELECT count(*) FROM highlights WHERE created_at >= lo AND created_at < hi))
      FROM (SELECT count(*) AS views, count(DISTINCT viewer_id) AS viewers
            FROM story_views WHERE viewed_at >= lo AND viewed_at < hi) v,
           (SELECT count(*) FILTER (WHERE event_type = 'story_complete') AS completions,
                   count(DISTINCT (viewer_id, story_id)) FILTER (WHERE event_type = 'story_complete') AS completed_views,
                   count(*) FILTER (WHERE event_type = 'story_replay') AS replays,
                   coalesce(sum(value_ms) FILTER (WHERE event_type = 'watch_duration'), 0) AS watch_ms,
                   count(*) FILTER (WHERE event_type = 'watch_duration') AS watch_samples
            FROM recommendation_events WHERE created_at >= lo AND created_at < hi) r),
    'engagement', jsonb_build_object(
      'likes', (SELECT count(*) FROM story_likes WHERE created_at >= lo AND created_at < hi),
      'comments', (SELECT count(*) FROM story_comments WHERE created_at >= lo AND created_at < hi),
      'shares', (SELECT count(*) FROM story_shares WHERE created_at >= lo AND created_at < hi),
      'follows', (SELECT count(*) FROM follows WHERE created_at >= lo AND created_at < hi)),
    'dms', (
      -- 1:1 conversations: the recipient is the other participant; "received" means their
      -- app confirmed delivery.
      SELECT jsonb_build_object('sent', count(*), 'senders', count(DISTINCT m.sender_id),
        'received', count(*) FILTER (WHERE r.last_delivered_at >= m.created_at))
      FROM messages m
      JOIN conversations c ON c.id = m.conversation_id
      LEFT JOIN conversation_reads r ON r.conversation_id = m.conversation_id
        AND r.user_id = CASE WHEN m.sender_id = c.user_a_id THEN c.user_b_id ELSE c.user_a_id END
      WHERE m.created_at >= lo AND m.created_at < hi),
    'app', (
      SELECT jsonb_build_object(
        'sessions', count(DISTINCT session_id) FILTER (WHERE name = 'app_session_started'),
        'crashedSessions', count(DISTINCT session_id) FILTER (WHERE name = 'app_crash'),
        'crashes', count(*) FILTER (WHERE name = 'app_crash'),
        'storiesStarted', count(*) FILTER (WHERE name = 'story_created'),
        'highlightViews', count(*) FILTER (WHERE name = 'highlight_viewed'),
        'profileViews', count(*) FILTER (WHERE name = 'profile_viewed'),
        'searches', count(*) FILTER (WHERE name = 'search_performed'),
        'uploadsSucceeded', count(*) FILTER (WHERE name = 'upload_succeeded'),
        'uploadsFailed', count(*) FILTER (WHERE name = 'upload_failed'),
        'processingFailures', (SELECT count(*) FROM media WHERE created_at >= lo AND created_at < hi AND status = 'failed'))
      FROM analytics_events WHERE occurred_at >= lo AND occurred_at < hi),
    'moderation', jsonb_build_object(
      'reports', (SELECT count(*) FROM reports WHERE created_at >= lo AND created_at < hi),
      'resolved', (SELECT count(*) FROM reports WHERE reviewed_at >= lo AND reviewed_at < hi
                     AND status IN ('ACTIONED', 'DISMISSED', 'CLOSED'))),
    'ads', (
      SELECT jsonb_build_object(
        'requested', count(*) FILTER (WHERE event_type = 'ad_requested'),
        'rendered', count(*) FILTER (WHERE event_type = 'ad_rendered'),
        'impressions', count(*) FILTER (WHERE event_type = 'ad_impression'),
        'qualifiedViews', count(*) FILTER (WHERE event_type = 'ad_qualified_view'),
        'completions', count(*) FILTER (WHERE event_type = 'ad_complete'),
        'clicks', count(*) FILTER (WHERE event_type = 'ad_click'),
        'hides', count(*) FILTER (WHERE event_type = 'ad_hide'),
        'reports', count(*) FILTER (WHERE event_type = 'ad_report'))
      FROM ad_events WHERE created_at >= lo AND created_at < hi)
  ) INTO m;

  INSERT INTO analytics_daily (day, metrics, computed_at) VALUES (p_day, m, now())
  ON CONFLICT (day) DO UPDATE SET metrics = EXCLUDED.metrics, computed_at = EXCLUDED.computed_at;
  RETURN m;
END $$;

-- 7. Retention for the signup days p_from..p_to. A day-N value stays NULL until day N
--    after signup has finished in the analytics time zone.
CREATE FUNCTION analytics_rollup_retention(p_from date, p_to date, p_tz text) RETURNS integer LANGUAGE sql SET jit = off AS $$
  WITH today AS (SELECT (now() AT TIME ZONE p_tz)::date AS d),
  days AS (SELECT g::date AS cohort_day FROM generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') g),
  members AS (
    SELECT days.cohort_day, u.id AS user_id
    FROM days JOIN users u
      ON u.created_at >= days.cohort_day::timestamp AT TIME ZONE p_tz
     AND u.created_at < (days.cohort_day + 1)::timestamp AT TIME ZONE p_tz),
  flags AS (
    SELECT m.cohort_day, m.user_id,
      EXISTS (SELECT 1 FROM analytics_active_days a WHERE a.user_id = m.user_id AND a.day = m.cohort_day + 1) AS r1,
      EXISTS (SELECT 1 FROM analytics_active_days a WHERE a.user_id = m.user_id AND a.day = m.cohort_day + 7) AS r7,
      EXISTS (SELECT 1 FROM analytics_active_days a WHERE a.user_id = m.user_id AND a.day = m.cohort_day + 30) AS r30
    FROM members m),
  totals AS (
    SELECT d.cohort_day, count(f.user_id)::int AS size,
      CASE WHEN d.cohort_day + 1 < (SELECT d FROM today) THEN (count(*) FILTER (WHERE f.r1))::int END AS d1,
      CASE WHEN d.cohort_day + 7 < (SELECT d FROM today) THEN (count(*) FILTER (WHERE f.r7))::int END AS d7,
      CASE WHEN d.cohort_day + 30 < (SELECT d FROM today) THEN (count(*) FILTER (WHERE f.r30))::int END AS d30
    FROM days d LEFT JOIN flags f ON f.cohort_day = d.cohort_day
    GROUP BY d.cohort_day),
  saved AS (
    INSERT INTO analytics_retention (cohort_day, cohort_size, d1, d7, d30, computed_at)
    SELECT cohort_day, size, d1, d7, d30, now() FROM totals
    ON CONFLICT (cohort_day) DO UPDATE SET cohort_size = EXCLUDED.cohort_size, d1 = EXCLUDED.d1,
      d7 = EXCLUDED.d7, d30 = EXCLUDED.d30, computed_at = EXCLUDED.computed_at
    RETURNING 1)
  SELECT count(*)::int FROM saved
$$;
