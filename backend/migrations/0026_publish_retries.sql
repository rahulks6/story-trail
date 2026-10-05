ALTER TABLE stories ADD COLUMN publish_request_id text;
ALTER TABLE stories ADD COLUMN publish_request_hash text;
CREATE UNIQUE INDEX stories_publish_request_unique ON stories(owner_id,publish_request_id) WHERE publish_request_id IS NOT NULL;

-- One transaction serializes retries and validates the current account/media state.
CREATE FUNCTION publish_story_once(p_owner uuid,p_request text,p_hash text,p_payload jsonb,p_expires timestamptz)
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
 INSERT INTO stories(owner_id,media_id,caption,audience,allow_comments,allow_sharing,expires_at,overlays,drawing,filter,audio_muted,crop,publish_request_id,publish_request_hash)
 VALUES(p_owner,media_row.id,p_payload->>'caption',p_payload->>'audience',p_payload->>'allowComments',(p_payload->>'allowSharing')::boolean,p_expires,p_payload->'overlays',p_payload->'drawing',p_payload->>'filter',(p_payload->>'audioMuted')::boolean,p_payload->'crop',p_request,p_hash)
 RETURNING * INTO existing;
 RETURN existing;
END $$;
