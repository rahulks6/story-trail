-- Music on Stories, from Katkee's own catalogue of openly licensed tracks (no famous songs: those
-- need a label licence). The catalogue is synced from music/catalogue.json at migrate time; the
-- audio files live in the media bucket at m/<track id>/audio.mp3. A Story keeps which track, and which part of
-- it, plays: { trackId, startMs, durationMs }.
CREATE TABLE music_tracks (
    id            uuid PRIMARY KEY,
    title         text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
    artist        text NOT NULL CHECK (char_length(artist) BETWEEN 1 AND 120),
    mood          text NOT NULL DEFAULT '',
    duration_ms   integer NOT NULL CHECK (duration_ms > 0),
    storage_key   text NOT NULL UNIQUE,
    mime_type     text NOT NULL DEFAULT 'audio/mpeg',
    byte_size     bigint NOT NULL CHECK (byte_size > 0),
    license       text NOT NULL,
    license_url   text NOT NULL,
    -- What viewers see with the Story, as the licence asks (e.g. "Song by Artist (CC BY 4.0)").
    attribution   text NOT NULL,
    source_url    text NOT NULL DEFAULT '',
    active        boolean NOT NULL DEFAULT true,
    created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX music_tracks_active_idx ON music_tracks (active, title);

ALTER TABLE stories ADD COLUMN music jsonb;
ALTER TABLE stories ADD CONSTRAINT stories_music_shape CHECK (music IS NULL OR (jsonb_typeof(music) = 'object' AND music ? 'trackId'));

-- The deferred publish (media still processing) carries the music too.
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
 INSERT INTO stories(owner_id,media_id,caption,audience,allow_comments,allow_sharing,expires_at,overlays,drawing,filter,audio_muted,crop,publish_request_id,publish_request_hash,music)
 VALUES(p_owner,media_row.id,p_payload->>'caption',p_payload->>'audience',p_payload->>'allowComments',(p_payload->>'allowSharing')::boolean,p_expires,p_payload->'overlays',p_payload->'drawing',p_payload->>'filter',(p_payload->>'audioMuted')::boolean,p_payload->'crop',p_request,p_hash,
        CASE WHEN jsonb_typeof(p_payload->'music')='object' THEN p_payload->'music' END)
 RETURNING * INTO existing;
 RETURN existing;
END $$;
