-- The Admin dashboard counted every account that ever existed, including the automated test
-- runs and store-screenshot accounts that sign up, run for a few minutes and delete themselves
-- (260 of them by 22 Nov 2026): its active users, registrations and Stories were inflated, and
-- its chart's tallest days were test runs. People, registrations, Stories and their views now
-- count only accounts that still exist and aren't test accounts (analytics/people.ts's rule).
CREATE OR REPLACE FUNCTION analytics_rollup_day(p_day date, p_tz text) RETURNS jsonb LANGUAGE plpgsql SET jit = off AS $$
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
        'registrations', (SELECT count(*) FROM users r WHERE r.created_at >= lo AND r.created_at < hi AND r.deleted_at IS NULL AND coalesce(r.email, '') !~* '^support\+e2e-'),
        'platforms', jsonb_build_object(
          'android', count(DISTINCT a.user_id) FILTER (WHERE a.day = p_day AND a.platform = 'android'),
          'ios', count(DISTINCT a.user_id) FILTER (WHERE a.day = p_day AND a.platform = 'ios'),
          'web', count(DISTINCT a.user_id) FILTER (WHERE a.day = p_day AND a.platform = 'web'),
          'unknown', count(DISTINCT a.user_id) FILTER (WHERE a.day = p_day AND a.platform = 'unknown')))
      FROM analytics_active_days a JOIN users u ON u.id = a.user_id
      WHERE a.day > p_day - 30 AND a.day <= p_day AND u.deleted_at IS NULL AND coalesce(u.email, '') !~* '^support\+e2e-'),
    'stories', (
      SELECT jsonb_build_object(
        'published', (SELECT count(*) FROM stories s JOIN users o ON o.id = s.owner_id
                      WHERE s.created_at >= lo AND s.created_at < hi AND o.deleted_at IS NULL AND coalesce(o.email, '') !~* '^support\+e2e-'),
        'activeCreators', (SELECT count(DISTINCT s.owner_id) FROM stories s JOIN users o ON o.id = s.owner_id
                           WHERE s.created_at >= lo AND s.created_at < hi AND o.deleted_at IS NULL AND coalesce(o.email, '') !~* '^support\+e2e-'),
        'views', v.views, 'viewers', v.viewers,
        'completions', r.completions, 'completedViews', r.completed_views, 'replays', r.replays,
        'watchMs', r.watch_ms, 'watchSamples', r.watch_samples,
        'highlightsCreated', (SELECT count(*) FROM highlights WHERE created_at >= lo AND created_at < hi))
      FROM (SELECT count(*) AS views, count(DISTINCT sv.viewer_id) AS viewers
            FROM story_views sv JOIN users w ON w.id = sv.viewer_id
            WHERE sv.viewed_at >= lo AND sv.viewed_at < hi AND w.deleted_at IS NULL AND coalesce(w.email, '') !~* '^support\+e2e-') v,
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
    'interactive', jsonb_build_object(
      -- A vote's sticker type is the overlay's own (polls and quizzes share story_sticker_votes).
      'pollVotes', (SELECT count(*) FROM story_sticker_votes v JOIN stories s ON s.id = v.story_id
                    WHERE v.created_at >= lo AND v.created_at < hi
                      AND EXISTS (SELECT 1 FROM jsonb_array_elements(s.overlays) o WHERE o->>'id' = v.sticker_id AND o->>'type' = 'poll')),
      'quizAnswers', (SELECT count(*) FROM story_sticker_votes v JOIN stories s ON s.id = v.story_id
                      WHERE v.created_at >= lo AND v.created_at < hi
                        AND EXISTS (SELECT 1 FROM jsonb_array_elements(s.overlays) o WHERE o->>'id' = v.sticker_id AND o->>'type' = 'quiz')),
      'questionResponses', (SELECT count(*) FROM story_question_responses WHERE created_at >= lo AND created_at < hi),
      'countdownReminders', (SELECT count(*) FROM story_countdown_reminders WHERE created_at >= lo AND created_at < hi),
      'addYoursChains', (SELECT count(*) FROM add_yours_chains WHERE created_at >= lo AND created_at < hi),
      'addYoursStories', (SELECT count(*) FROM story_add_yours WHERE joined_at >= lo AND joined_at < hi),
      'collabInvites', (SELECT count(*) FROM story_collaborators WHERE invited_at >= lo AND invited_at < hi),
      'collabsAccepted', (SELECT count(*) FROM story_collaborators WHERE status = 'accepted' AND responded_at >= lo AND responded_at < hi),
      'linkOpens', (SELECT count(*) FROM analytics_events WHERE name = 'story_link_opened' AND occurred_at >= lo AND occurred_at < hi),
      'addYoursTaps', (SELECT count(*) FROM analytics_events WHERE name = 'add_yours_tapped' AND occurred_at >= lo AND occurred_at < hi)),
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

-- Recomputed by the worker: it fills in any missing day of the last 34 (rollup.ts).
DELETE FROM analytics_daily WHERE day > CURRENT_DATE - 35;
