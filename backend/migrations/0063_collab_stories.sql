-- Collab Stories (src/modules/stories/collab.*): the owner invites one person when posting;
-- once they accept, the Story is shown in both people's Story rings, to both sets of
-- followers, with both names on it. The Story stays the owner's (their media, their
-- audience, their Insights, their delete); the collaborator can leave it at any time.
CREATE TABLE story_collaborators (
  story_id uuid PRIMARY KEY REFERENCES stories (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined')),
  invited_at timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz,
  CHECK ((status = 'pending') = (responded_at IS NULL))
);
-- The collaborator's ring: their accepted collabs, and their pending invitations.
CREATE INDEX story_collaborators_user_idx ON story_collaborators (user_id, status);

-- The collaborations that are live right now: accepted, the collaborator's account still
-- active, and no block between the two creators since (a block ends a collab without
-- anyone having to undo it). Every visibility query reads collabs through this.
CREATE VIEW story_collabs_live AS
  SELECT sc.story_id, sc.user_id
  FROM story_collaborators sc
  JOIN stories s ON s.id = sc.story_id
  JOIN users u ON u.id = sc.user_id
  WHERE sc.status = 'accepted' AND u.is_active AND u.deleted_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = s.owner_id AND b.blocked_id = sc.user_id)
                                            OR (b.blocker_id = sc.user_id AND b.blocked_id = s.owner_id));

-- "@x invited you to a collab Story" (with Accept/Decline) and "@x accepted your collab".
ALTER TABLE notifications DROP CONSTRAINT notifications_type_valid;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_valid
    CHECK (type IN ('like', 'comment', 'follow', 'follow_request', 'follow_accepted', 'mention', 'verification', 'invite_joined',
                    'collab_invite', 'collab_accepted'));
ALTER TABLE push_outbox DROP CONSTRAINT push_outbox_kind_check;
ALTER TABLE push_outbox ADD CONSTRAINT push_outbox_kind_check
  CHECK (kind IN ('like', 'comment', 'follow', 'follow_request', 'follow_accepted', 'mention', 'message', 'badge',
                  'new_story', 'story_milestone', 'festival', 'streak', 'nudge', 'message_reaction', 'verification', 'invite_joined',
                  'countdown', 'collab_invite', 'collab_accepted'));

-- A Story published by the media worker (once its media is ready) brings its invitation with
-- it, in the same transaction as the Story. Everything from 0060, plus the invitation. Who may
-- be invited is checked when the publish is requested (stories.service.ts) and again before
-- anyone is notified (collab.service.ts), since a block can happen while media processes.
CREATE OR REPLACE FUNCTION publish_story_once(p_owner uuid,p_request text,p_hash text,p_payload jsonb,p_expires timestamptz)
RETURNS stories LANGUAGE plpgsql AS $$
DECLARE existing stories; media_row media;
BEGIN
 IF length(p_request) NOT BETWEEN 16 AND 100 OR p_request !~ '^[A-Za-z0-9_-]+$' THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('publish:'||p_owner::text||':'||p_request,0));
 SELECT * INTO existing FROM stories WHERE owner_id=p_owner AND publish_request_id=p_request;
 IF FOUND THEN
  IF existing.publish_request_hash IS DISTINCT FROM p_hash THEN RAISE EXCEPTION 'REQUEST_CONFLICT'; END IF;
  IF existing.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'STORY_UNAVAILABLE'; END IF;
  RETURN existing;
 END IF;
 PERFORM id FROM users WHERE id=p_owner AND deleted_at IS NULL AND is_active AND moderation_state='ACTIVE' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'ACCOUNT_RESTRICTED'; END IF;
 SELECT * INTO media_row FROM media WHERE id=(p_payload->>'mediaId')::uuid AND owner_id=p_owner FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'MEDIA_NOT_FOUND'; END IF;
 IF media_row.status<>'ready' THEN RAISE EXCEPTION 'MEDIA_NOT_READY'; END IF;
 IF EXISTS(SELECT 1 FROM stories WHERE media_id=media_row.id) THEN RAISE EXCEPTION 'MEDIA_PUBLISHED'; END IF;
 INSERT INTO stories(owner_id,media_id,caption,audience,allow_comments,allow_sharing,expires_at,overlays,drawing,filter,audio_muted,crop,publish_request_id,publish_request_hash,music,festival,topic)
 VALUES(p_owner,media_row.id,p_payload->>'caption',p_payload->>'audience',p_payload->>'allowComments',(p_payload->>'allowSharing')::boolean,p_expires,p_payload->'overlays',p_payload->'drawing',p_payload->>'filter',(p_payload->>'audioMuted')::boolean,p_payload->'crop',p_request,p_hash,
        CASE WHEN jsonb_typeof(p_payload->'music')='object' THEN p_payload->'music' END,
        (SELECT f.slug FROM festivals f WHERE f.slug = p_payload->>'festival'),
        NULLIF(p_payload->>'topic',''))
 RETURNING * INTO existing;
 IF coalesce(p_payload->>'collaboratorId','') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' AND existing.audience <> 'close_friends' THEN
  INSERT INTO story_collaborators(story_id,user_id)
  SELECT existing.id,u.id FROM users u WHERE u.id=(p_payload->>'collaboratorId')::uuid AND u.id<>p_owner AND u.deleted_at IS NULL AND u.is_active
  ON CONFLICT DO NOTHING;
 END IF;
 RETURN existing;
END $$;

-- Admin analytics: everything from 0035, plus how the interactive stickers and Collab Stories
-- are used. Counted from the rows those features write (never sent twice by the app), except
-- link opens and "Add yours" taps, which only the app sees (analytics/events.ts).
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
