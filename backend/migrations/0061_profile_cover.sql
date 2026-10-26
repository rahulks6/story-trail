-- A profile cover photo: the wide banner at the top of a profile (src/modules/users). Shown to
-- whoever can see the profile header, exactly like the profile photo, through its own
-- access-checked file route.
ALTER TABLE users ADD COLUMN cover_media_id uuid NULL REFERENCES media (id) ON DELETE SET NULL;
CREATE INDEX users_cover_media_idx ON users (cover_media_id) WHERE cover_media_id IS NOT NULL;

-- A cover in use is never purged as unused (every clause from 0057, plus the cover).
CREATE OR REPLACE FUNCTION claim_unused_media_for_purge(p_media uuid, p_min_age_hours integer)
RETURNS SETOF media LANGUAGE plpgsql AS $$
DECLARE m media;
BEGIN
    SELECT * INTO m FROM media WHERE id = p_media FOR UPDATE;
    IF m.id IS NULL OR m.status = 'uploading' OR m.created_at >= now() - make_interval(hours => p_min_age_hours) THEN RETURN; END IF;
    IF EXISTS (SELECT 1 FROM stories WHERE media_id = p_media)
       OR EXISTS (SELECT 1 FROM users WHERE avatar_media_id = p_media)
       OR EXISTS (SELECT 1 FROM users WHERE cover_media_id = p_media)
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

-- An upload used as a cover is in use: it can't also become an ID photo (0057).
CREATE OR REPLACE FUNCTION media_in_use(p_media uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM stories WHERE media_id = p_media)
      OR EXISTS (SELECT 1 FROM users WHERE avatar_media_id = p_media)
      OR EXISTS (SELECT 1 FROM users WHERE cover_media_id = p_media)
      OR EXISTS (SELECT 1 FROM ad_creatives WHERE media_id = p_media)
      OR EXISTS (SELECT 1 FROM messages WHERE media_id = p_media)
      OR EXISTS (SELECT 1 FROM app_feedback WHERE screenshot_media_id = p_media)
      OR EXISTS (SELECT 1 FROM story_publish_requests WHERE media_id = p_media)
      OR EXISTS (SELECT 1 FROM verification_requests WHERE id_media_id = p_media)
$$;
