-- Scheduled Stories (src/modules/stories/scheduled.ts): the photo or video uploads when it is
-- shared, and the Story is kept here, unpublished, until `publish_at`. Only then does the worker
-- add it to `stories` (with publish_story_once, the same insert as every other publish), so a
-- scheduled Story can't appear anywhere before its time: every feed, profile, search, push and
-- count reads `stories`, and nothing reads this table except its owner's Scheduled list. Its
-- 24 hours start when it is published.

CREATE TABLE scheduled_stories (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  -- The device's outbox id: a retried share finds the same row, and it becomes the Story's
  -- publish_request_id, so publishing is idempotent too.
  request_id   text NOT NULL CHECK (request_id ~ '^[A-Za-z0-9_-]{16,100}$'),
  request_hash text NOT NULL,
  media_id     uuid NOT NULL REFERENCES media (id) ON DELETE CASCADE,
  payload      jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  publish_at   timestamptz NOT NULL,
  state        text NOT NULL DEFAULT 'scheduled' CHECK (state IN ('scheduled', 'published', 'canceled', 'failed')),
  story_id     uuid REFERENCES stories (id) ON DELETE SET NULL,
  error        text CHECK (error IS NULL OR char_length(error) <= 300),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  resolved_at  timestamptz,
  UNIQUE (owner_id, request_id)
);
-- One pending schedule per upload; the worker's due list; the owner's list; retention.
CREATE UNIQUE INDEX scheduled_stories_media_idx ON scheduled_stories (media_id) WHERE state = 'scheduled';
CREATE INDEX scheduled_stories_due_idx ON scheduled_stories (publish_at) WHERE state = 'scheduled';
CREATE INDEX scheduled_stories_owner_idx ON scheduled_stories (owner_id, publish_at);
CREATE INDEX scheduled_stories_resolved_idx ON scheduled_stories (resolved_at) WHERE state <> 'scheduled';

-- Records a schedule, or finds the one this request already made. Checks what can be checked
-- now (the media is the owner's, uploaded, not posted or scheduled already; at most p_max
-- pending), under a per-owner lock so two shares can't both take the last place.
CREATE FUNCTION schedule_story(p_owner uuid, p_request text, p_hash text, p_payload jsonb, p_publish_at timestamptz, p_max integer)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE existing scheduled_stories; media_row media; created uuid;
BEGIN
  IF length(p_request) NOT BETWEEN 16 AND 100 OR p_request !~ '^[A-Za-z0-9_-]+$' THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('schedule:' || p_owner::text, 0));
  PERFORM 1 FROM users WHERE id = p_owner AND deleted_at IS NULL AND is_active AND moderation_state = 'ACTIVE';
  IF NOT FOUND THEN RAISE EXCEPTION 'ACCOUNT_RESTRICTED'; END IF;

  SELECT * INTO existing FROM scheduled_stories WHERE owner_id = p_owner AND request_id = p_request;
  IF FOUND THEN
    -- The time can have changed since (Reschedule), so it isn't part of the comparison.
    IF existing.request_hash IS DISTINCT FROM p_hash THEN RAISE EXCEPTION 'REQUEST_CONFLICT'; END IF;
    RETURN existing.id;
  END IF;
  IF EXISTS (SELECT 1 FROM stories WHERE owner_id = p_owner AND publish_request_id = p_request) THEN RAISE EXCEPTION 'REQUEST_PUBLISHED'; END IF;

  SELECT * INTO media_row FROM media WHERE id = (p_payload->>'mediaId')::uuid AND owner_id = p_owner FOR UPDATE;
  IF NOT FOUND OR media_row.verification_document OR media_row.export_overlay THEN RAISE EXCEPTION 'MEDIA_NOT_FOUND'; END IF;
  IF media_row.kind = 'audio' THEN RAISE EXCEPTION 'MEDIA_AUDIO'; END IF;
  IF media_row.status = 'uploading' THEN RAISE EXCEPTION 'MEDIA_NOT_UPLOADED'; END IF;
  IF media_row.status = 'failed' THEN RAISE EXCEPTION 'MEDIA_FAILED'; END IF;
  IF EXISTS (SELECT 1 FROM stories WHERE media_id = media_row.id)
     OR EXISTS (SELECT 1 FROM story_publish_requests WHERE media_id = media_row.id AND state = 'waiting')
     OR EXISTS (SELECT 1 FROM scheduled_stories WHERE media_id = media_row.id AND state = 'scheduled') THEN
    RAISE EXCEPTION 'MEDIA_PUBLISHED';
  END IF;
  IF (SELECT count(*) FROM scheduled_stories WHERE owner_id = p_owner AND state = 'scheduled') >= p_max THEN
    RAISE EXCEPTION 'TOO_MANY_SCHEDULED';
  END IF;

  INSERT INTO scheduled_stories (owner_id, request_id, request_hash, media_id, payload, publish_at)
  VALUES (p_owner, p_request, p_hash, media_row.id, p_payload, p_publish_at)
  RETURNING id INTO created;
  RETURN created;
END $$;

-- The worker's step: publishes every scheduled Story that is due and whose media has finished
-- processing (one still processing waits for the next round), oldest first, each on its own so
-- one failure never holds up the rest. A festival tag stays only while the festival is on.
-- The owner gets a push either way. SKIP LOCKED lets several workers share the work, and a
-- Cancel that races a publish waits for it and then finds the Story already posted.
CREATE FUNCTION publish_due_scheduled_stories(p_limit integer, p_ttl_seconds integer)
RETURNS TABLE (out_scheduled uuid, out_owner uuid, out_story uuid, out_outcome text) LANGUAGE plpgsql AS $$
DECLARE s scheduled_stories; payload jsonb; published stories; reason text;
BEGIN
  FOR s IN
    SELECT ss.* FROM scheduled_stories ss
     WHERE ss.state = 'scheduled' AND ss.publish_at <= now()
       AND NOT EXISTS (SELECT 1 FROM media m WHERE m.id = ss.media_id AND m.status IN ('uploading', 'processing'))
     ORDER BY ss.publish_at
     LIMIT p_limit
     FOR UPDATE OF ss SKIP LOCKED
  LOOP
    payload := s.payload;
    IF payload ? 'festival' AND NOT EXISTS (
         SELECT 1 FROM festivals f WHERE f.slug = payload->>'festival'
            AND (now() AT TIME ZONE 'Asia/Kolkata')::date BETWEEN f.starts_on - 1 AND f.ends_on + 1) THEN
      payload := payload - 'festival';
    END IF;
    BEGIN
      published := publish_story_once(s.owner_id, s.request_id, s.request_hash, payload, now() + make_interval(secs => p_ttl_seconds));
      UPDATE scheduled_stories SET state = 'published', story_id = published.id, error = NULL, resolved_at = now(), updated_at = now()
       WHERE id = s.id;
      INSERT INTO push_outbox (user_id, kind, ref_id, body, link)
      VALUES (s.owner_id, 'scheduled_story_live', published.id, 'Your scheduled Story is live', 'katkee://story/' || published.id);
      out_scheduled := s.id; out_owner := s.owner_id; out_story := published.id; out_outcome := 'published';
      RETURN NEXT;
    EXCEPTION WHEN raise_exception OR unique_violation OR check_violation OR not_null_violation
                   OR foreign_key_violation OR invalid_text_representation THEN
      reason := CASE
        WHEN SQLERRM = 'ACCOUNT_RESTRICTED' THEN 'Your account can''t post Stories right now.'
        WHEN SQLERRM IN ('MEDIA_NOT_READY', 'MEDIA_NOT_FOUND') THEN
          coalesce((SELECT m.processing_error FROM media m WHERE m.id = s.media_id), 'This photo or video couldn''t be processed.')
        WHEN SQLERRM = 'MEDIA_PUBLISHED' THEN 'This photo or video has already been posted.'
        ELSE 'This Story couldn''t be posted.' END;
      UPDATE scheduled_stories SET state = 'failed', error = left(reason, 300), resolved_at = now(), updated_at = now() WHERE id = s.id;
      INSERT INTO push_outbox (user_id, kind, body, link)
      VALUES (s.owner_id, 'scheduled_story_failed', 'Your scheduled Story couldn''t be posted. Open Katkee to see why.', 'katkee://scheduled');
      out_scheduled := s.id; out_owner := s.owner_id; out_story := NULL; out_outcome := 'failed';
      RETURN NEXT;
    END;
  END LOOP;
END $$;

-- Two push-only kinds, added to whatever kinds the list already has.
DO $$
DECLARE def text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO def FROM pg_constraint
   WHERE conname = 'push_outbox_kind_check' AND conrelid = 'push_outbox'::regclass;
  IF def IS NULL OR position('ARRAY[' in def) = 0 THEN
    RAISE EXCEPTION 'push_outbox_kind_check has an unexpected shape: %', def;
  END IF;
  ALTER TABLE push_outbox DROP CONSTRAINT push_outbox_kind_check;
  EXECUTE 'ALTER TABLE push_outbox ADD CONSTRAINT push_outbox_kind_check '
    || replace(def, 'ARRAY[', 'ARRAY[''scheduled_story_live''::text, ''scheduled_story_failed''::text, ');
END $$;

-- A scheduled Story's media is in use: retention never purges it as unused, and it can't also
-- be sent as an ID photo. The clause is added to these functions as they stand (rather than
-- restating them), so whatever other migrations added to them is kept; if their text has moved
-- on so far that the place to add it can't be found, this migration fails instead of guessing.
DO $$
DECLARE src text;
  purge_anchor text := 'OR EXISTS (SELECT 1 FROM story_publish_requests WHERE media_id = p_media AND state = ''waiting'')';
  use_anchor text := 'OR EXISTS (SELECT 1 FROM story_publish_requests WHERE media_id = p_media)';
BEGIN
  src := pg_get_functiondef('claim_unused_media_for_purge(uuid, integer)'::regprocedure);
  IF position(purge_anchor in src) = 0 THEN RAISE EXCEPTION 'claim_unused_media_for_purge: anchor not found'; END IF;
  EXECUTE replace(src, purge_anchor,
    'OR EXISTS (SELECT 1 FROM scheduled_stories WHERE media_id = p_media AND state = ''scheduled'')' || E'\n       ' || purge_anchor);

  src := pg_get_functiondef('media_in_use(uuid)'::regprocedure);
  IF position(use_anchor in src) = 0 THEN RAISE EXCEPTION 'media_in_use: anchor not found'; END IF;
  EXECUTE replace(src, use_anchor,
    'OR EXISTS (SELECT 1 FROM scheduled_stories WHERE media_id = p_media AND state = ''scheduled'')' || E'\n      ' || use_anchor);
END $$;
