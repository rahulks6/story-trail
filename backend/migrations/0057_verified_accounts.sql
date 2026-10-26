-- The verified badge: an admin approves each account by hand (src/modules/verification).
-- The badge shows while verified_at is set and the account isn't on hold after a rename.
ALTER TABLE users
  ADD COLUMN verified_at timestamptz,
  ADD COLUMN verified_category text CHECK (verified_category IN ('creator', 'public_figure', 'brand', 'news_media', 'organization')),
  ADD COLUMN verification_hold_at timestamptz,
  -- The username and display name the badge was approved for, so the admin sees what changed.
  ADD COLUMN verification_hold_previous jsonb;

-- A photo of a government ID, attached to a request. From then on it is never served by the
-- normal media routes (not even to its owner), only to admins with verification.review.
ALTER TABLE media ADD COLUMN verification_document boolean NOT NULL DEFAULT false;

CREATE TABLE verification_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'denied', 'withdrawn')),
  category text NOT NULL CHECK (category IN ('creator', 'public_figure', 'brand', 'news_media', 'organization')),
  full_name text NOT NULL CHECK (char_length(full_name) BETWEEN 1 AND 80),
  links jsonb NOT NULL CHECK (jsonb_typeof(links) = 'array' AND jsonb_array_length(links) BETWEEN 1 AND 5),
  -- Null once the retention job deleted the photo (id_deleted_at says when).
  id_media_id uuid REFERENCES media (id) ON DELETE SET NULL,
  id_deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  decided_by uuid REFERENCES users (id) ON DELETE SET NULL,
  denial_reason text CHECK (denial_reason IS NULL OR char_length(denial_reason) BETWEEN 1 AND 500),
  CHECK ((status = 'pending') = (decided_at IS NULL))
);
-- One open request per account, and one request per ID photo.
CREATE UNIQUE INDEX verification_requests_one_pending ON verification_requests (user_id) WHERE status = 'pending';
CREATE UNIQUE INDEX verification_requests_id_media ON verification_requests (id_media_id) WHERE id_media_id IS NOT NULL;
CREATE INDEX verification_requests_user_idx ON verification_requests (user_id, created_at DESC);
CREATE INDEX verification_requests_queue_idx ON verification_requests (created_at) WHERE status = 'pending';
-- The retention job: decided requests whose photo is still stored.
CREATE INDEX verification_requests_retention_idx ON verification_requests (decided_at) WHERE id_media_id IS NOT NULL AND status <> 'pending';
CREATE INDEX users_verification_hold_idx ON users (verification_hold_at) WHERE verification_hold_at IS NOT NULL AND verified_at IS NOT NULL;

-- Every path that renames an account or restricts, suspends or deletes it goes through UPDATE users
-- (profile edits, onboarding, moderation functions), so the badge rules live in one trigger:
--  - a new username or display name while verified puts the badge on hold until an admin
--    restores or removes it;
--  - a restricted, suspended or deleted account loses the badge.
CREATE FUNCTION users_verification_rules() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.verified_at IS NULL THEN RETURN NEW; END IF;
  IF NEW.moderation_state <> 'ACTIVE' OR NOT NEW.is_active OR NEW.deleted_at IS NOT NULL THEN
    NEW.verified_at := NULL;
    NEW.verified_category := NULL;
    NEW.verification_hold_at := NULL;
    NEW.verification_hold_previous := NULL;
  ELSIF NEW.verification_hold_at IS NULL
        AND (NEW.username IS DISTINCT FROM OLD.username OR NEW.display_name IS DISTINCT FROM OLD.display_name) THEN
    NEW.verification_hold_at := now();
    NEW.verification_hold_previous := jsonb_build_object('username', OLD.username, 'displayName', OLD.display_name);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER users_verification_rules BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION users_verification_rules();

-- "You're verified", "wasn't approved", "was removed": an Activity row with no actor.
ALTER TABLE notifications
  ADD COLUMN verification_status text CHECK (verification_status IN ('approved', 'denied', 'removed', 'restored')),
  ADD COLUMN verification_reason text CHECK (verification_reason IS NULL OR char_length(verification_reason) <= 500);
ALTER TABLE notifications DROP CONSTRAINT notifications_type_valid;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_valid
    CHECK (type IN ('like', 'comment', 'follow', 'follow_request', 'follow_accepted', 'mention', 'verification'));
ALTER TABLE push_outbox DROP CONSTRAINT push_outbox_kind_check;
ALTER TABLE push_outbox ADD CONSTRAINT push_outbox_kind_check
  CHECK (kind IN ('like', 'comment', 'follow', 'follow_request', 'follow_accepted', 'mention', 'message', 'badge',
                  'new_story', 'story_milestone', 'festival', 'streak', 'nudge', 'message_reaction', 'verification'));

-- Whether an upload is already used somewhere: an ID photo must be a fresh upload of its own.
CREATE FUNCTION media_in_use(p_media uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM stories WHERE media_id = p_media)
      OR EXISTS (SELECT 1 FROM users WHERE avatar_media_id = p_media)
      OR EXISTS (SELECT 1 FROM ad_creatives WHERE media_id = p_media)
      OR EXISTS (SELECT 1 FROM messages WHERE media_id = p_media)
      OR EXISTS (SELECT 1 FROM app_feedback WHERE screenshot_media_id = p_media)
      OR EXISTS (SELECT 1 FROM story_publish_requests WHERE media_id = p_media)
      OR EXISTS (SELECT 1 FROM verification_requests WHERE id_media_id = p_media)
$$;

-- An ID photo is in use until the retention job deletes it (0054 + verification_requests).
CREATE OR REPLACE FUNCTION claim_unused_media_for_purge(p_media uuid, p_min_age_hours integer)
RETURNS SETOF media LANGUAGE plpgsql AS $$
DECLARE m media;
BEGIN
    SELECT * INTO m FROM media WHERE id = p_media FOR UPDATE;
    IF m.id IS NULL OR m.status = 'uploading' OR m.created_at >= now() - make_interval(hours => p_min_age_hours) THEN RETURN; END IF;
    IF EXISTS (SELECT 1 FROM stories WHERE media_id = p_media)
       OR EXISTS (SELECT 1 FROM users WHERE avatar_media_id = p_media)
       OR EXISTS (SELECT 1 FROM ad_creatives WHERE media_id = p_media)
       OR EXISTS (SELECT 1 FROM messages WHERE media_id = p_media)
       OR EXISTS (SELECT 1 FROM app_feedback WHERE screenshot_media_id = p_media)
       OR EXISTS (SELECT 1 FROM verification_requests WHERE id_media_id = p_media)
       OR EXISTS (SELECT 1 FROM story_publish_requests WHERE media_id = p_media AND state = 'waiting') THEN
        RETURN;
    END IF;
    UPDATE media SET status = 'failed', processing_error = 'This upload expired before it was used.',
                     processing_error_retryable = false, purged_at = coalesce(purged_at, now())
     WHERE id = p_media RETURNING * INTO m;
    RETURN NEXT m;
END $$;
