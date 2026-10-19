-- Photos and videos in direct messages, like Instagram. The media row is the sender's upload;
-- the other participant can see it because it is attached to a message in their conversation
-- (conversations.repository canAccessMediaViaMessage).
ALTER TABLE messages ADD COLUMN media_id uuid REFERENCES media (id) ON DELETE SET NULL;
ALTER TABLE messages DROP CONSTRAINT messages_body_or_story;
ALTER TABLE messages ADD CONSTRAINT messages_has_content CHECK (body IS NOT NULL OR shared_story_id IS NOT NULL OR media_id IS NOT NULL);
CREATE INDEX messages_media_idx ON messages (media_id) WHERE media_id IS NOT NULL;

-- Media sent in a message is in use: the unused-media cleanup must keep it.
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
       OR EXISTS (SELECT 1 FROM story_publish_requests WHERE media_id = p_media AND state = 'waiting') THEN
        RETURN;
    END IF;
    UPDATE media SET status = 'failed', processing_error = 'This upload expired before it was used.',
                     processing_error_retryable = false, purged_at = coalesce(purged_at, now())
     WHERE id = p_media RETURNING * INTO m;
    RETURN NEXT m;
END $$;
