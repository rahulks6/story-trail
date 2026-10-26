-- Home ordered by each person's interests (recommendations/topic-affinity.ts).

-- A Story can carry one topic from the topic list (src/shared/topics.ts, checked when it is
-- published). Without one, its topics are its owner's profile interests.
ALTER TABLE stories ADD COLUMN topic text NULL CHECK (topic IS NULL OR length(topic) BETWEEN 1 AND 30);

-- Publishing after media processing (migration 0051's function) also keeps the topic.
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
 RETURN existing;
END $$;

-- "Show more like this" from a Story's More menu.
ALTER TABLE recommendation_events DROP CONSTRAINT recommendation_events_type_valid;
ALTER TABLE recommendation_events ADD CONSTRAINT recommendation_events_type_valid CHECK (event_type IN (
    'creator_impression', 'story_impression', 'qualified_view', 'watch_duration',
    'story_complete', 'story_next', 'story_previous',
    'creator_sequence_started', 'creator_sequence_continued', 'creator_sequence_completed',
    'creator_swipe_next', 'creator_swipe_previous', 'quick_creator_skip', 'story_replay',
    'comment_open', 'profile_visit', 'follow_after_story', 'repeat_creator_visit', 'not_interested',
    'more_like_this'
));

-- What each person seems to like, learned from what they do with Stories: one row per topic.
-- `score` was right at `updated_at` and halves every 14 days after it (decayed on read and on
-- each update). `day`/`day_change` cap how much one topic can move in a day. A topic the person
-- removed in Settings stays at 0 until `pinned_out_until`. Only its owner ever sees it (as
-- "high"/"medium", never the score); it goes with the account and is never used for ads.
CREATE TABLE viewer_topic_affinity (
    viewer_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    topic text NOT NULL CHECK (length(topic) BETWEEN 1 AND 30),
    score double precision NOT NULL DEFAULT 0,
    updated_at timestamptz NOT NULL DEFAULT now(),
    day date NOT NULL DEFAULT current_date,
    day_change double precision NOT NULL DEFAULT 0 CHECK (day_change >= 0),
    pinned_out_until timestamptz NULL,
    PRIMARY KEY (viewer_id, topic)
);
CREATE INDEX viewer_topic_affinity_updated_idx ON viewer_topic_affinity (updated_at);
