-- Phase 2 (5 October 2026): production media pipeline.
--
-- Media now moves through uploading -> processing -> ready | failed. Clients send
-- the bytes straight to object storage (S3 in production) using short-lived,
-- per-part presigned URLs; a worker then validates the file, strips metadata
-- (EXIF/GPS, container tags) and writes the delivery variants: display image,
-- thumbnail, video poster and H.264 renditions. Rows hold metadata only.
--
-- Publishing a Story whose media is still processing records a publish request;
-- the worker publishes it in the same transaction that marks the media ready, so
-- people can leave the app once their upload has finished.
--
-- Additive: existing rows stay 'ready' and keep serving their original until a
-- backfill job (queued below) has written their variants.

ALTER TABLE media DROP CONSTRAINT media_status_valid;
ALTER TABLE media ADD CONSTRAINT media_status_valid
    CHECK (status IN ('uploading', 'processing', 'ready', 'failed'));
-- The checksum is computed by the worker from the stored bytes, after upload.
ALTER TABLE media ALTER COLUMN checksum_sha256 DROP NOT NULL;
ALTER TABLE media
    ADD COLUMN variants jsonb NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN processing_error text,
    ADD COLUMN processing_error_retryable boolean NOT NULL DEFAULT false,
    ADD COLUMN processed_at timestamptz,
    ADD COLUMN original_purged_at timestamptz,
    ADD COLUMN purged_at timestamptz,
    ADD CONSTRAINT media_variants_object CHECK (jsonb_typeof(variants) = 'object');

CREATE INDEX media_pending_idx ON media (status, created_at) WHERE status IN ('uploading', 'processing', 'failed');
CREATE INDEX media_unpurged_created_idx ON media (created_at) WHERE purged_at IS NULL;

-- One resumable multipart upload per media row while status = 'uploading'.
CREATE TABLE media_upload_sessions (
    media_id            uuid PRIMARY KEY REFERENCES media (id) ON DELETE CASCADE,
    owner_id            uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    -- The device's outbox id, so a retried "create" returns the same session.
    client_upload_id    text NOT NULL CHECK (client_upload_id ~ '^[A-Za-z0-9_-]{16,100}$'),
    multipart_upload_id text NOT NULL,
    part_size           integer NOT NULL CHECK (part_size > 0),
    part_count          integer NOT NULL CHECK (part_count BETWEEN 1 AND 10000),
    created_at          timestamptz NOT NULL DEFAULT now(),
    expires_at          timestamptz NOT NULL,
    completed_at        timestamptz
);
CREATE UNIQUE INDEX media_upload_sessions_client_idx ON media_upload_sessions (owner_id, client_upload_id);
CREATE INDEX media_upload_sessions_open_idx ON media_upload_sessions (expires_at) WHERE completed_at IS NULL;

-- Durable processing queue. Workers claim with FOR UPDATE SKIP LOCKED and hold a
-- lease; a lease that expires (worker crashed) makes the job claimable again.
CREATE TABLE media_jobs (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    media_id        uuid NOT NULL REFERENCES media (id) ON DELETE CASCADE,
    status          text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'failed')),
    attempts        integer NOT NULL DEFAULT 0,
    max_attempts    integer NOT NULL DEFAULT 3 CHECK (max_attempts BETWEEN 1 AND 10),
    run_after       timestamptz NOT NULL DEFAULT now(),
    locked_by       text,
    locked_until    timestamptz,
    last_error      text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    finished_at     timestamptz
);
CREATE UNIQUE INDEX media_jobs_open_idx ON media_jobs (media_id) WHERE status IN ('queued', 'running');
CREATE INDEX media_jobs_due_idx ON media_jobs (run_after, id) WHERE status = 'queued';
CREATE INDEX media_jobs_lease_idx ON media_jobs (locked_until) WHERE status = 'running';
CREATE INDEX media_jobs_finished_idx ON media_jobs (finished_at) WHERE status IN ('done', 'failed');

CREATE FUNCTION claim_media_job(p_worker text, p_lease_seconds integer, p_media uuid DEFAULT NULL)
RETURNS SETOF media_jobs LANGUAGE sql AS $$
    UPDATE media_jobs j
       SET status = 'running', attempts = j.attempts + 1, locked_by = p_worker,
           locked_until = now() + make_interval(secs => p_lease_seconds)
     WHERE j.id = (
        SELECT id FROM media_jobs
         WHERE ((status = 'queued' AND run_after <= now()) OR (status = 'running' AND locked_until < now()))
           AND (p_media IS NULL OR media_id = p_media)
         ORDER BY run_after, id
         FOR UPDATE SKIP LOCKED
         LIMIT 1)
    RETURNING j.*;
$$;

-- Publish requests for media that is still processing.
CREATE TABLE story_publish_requests (
    owner_id        uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    request_id      text NOT NULL CHECK (request_id ~ '^[A-Za-z0-9_-]{16,100}$'),
    request_hash    text NOT NULL,
    media_id        uuid NOT NULL REFERENCES media (id) ON DELETE CASCADE,
    payload         jsonb NOT NULL,
    ttl_seconds     integer NOT NULL CHECK (ttl_seconds > 0),
    state           text NOT NULL DEFAULT 'waiting' CHECK (state IN ('waiting', 'published', 'failed')),
    story_id        uuid REFERENCES stories (id) ON DELETE SET NULL,
    error           text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    resolved_at     timestamptz,
    PRIMARY KEY (owner_id, request_id)
);
CREATE UNIQUE INDEX story_publish_requests_waiting_idx ON story_publish_requests (media_id) WHERE state = 'waiting';
CREATE INDEX story_publish_requests_resolved_idx ON story_publish_requests (resolved_at) WHERE state <> 'waiting';

-- Publishes now when the media is ready, or records a request the worker completes.
-- Lock order (media row, then the request's advisory lock) matches
-- finish_media_processing, so the two can never deadlock.
CREATE FUNCTION request_story_publish(p_owner uuid, p_request text, p_hash text, p_payload jsonb, p_ttl_seconds integer)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE media_row media; published stories; req story_publish_requests;
BEGIN
    IF length(p_request) NOT BETWEEN 16 AND 100 OR p_request !~ '^[A-Za-z0-9_-]+$' THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
    SELECT * INTO media_row FROM media WHERE id = (p_payload->>'mediaId')::uuid AND owner_id = p_owner FOR UPDATE;
    PERFORM pg_advisory_xact_lock(hashtextextended('publish:' || p_owner::text || ':' || p_request, 0));

    SELECT * INTO published FROM stories WHERE owner_id = p_owner AND publish_request_id = p_request;
    IF published.id IS NOT NULL THEN
        IF published.publish_request_hash IS DISTINCT FROM p_hash THEN RAISE EXCEPTION 'REQUEST_CONFLICT'; END IF;
        IF published.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'STORY_UNAVAILABLE'; END IF;
        RETURN jsonb_build_object('state', 'published', 'storyId', published.id);
    END IF;

    SELECT * INTO req FROM story_publish_requests WHERE owner_id = p_owner AND request_id = p_request FOR UPDATE;
    IF req.request_id IS NOT NULL AND req.request_hash IS DISTINCT FROM p_hash THEN RAISE EXCEPTION 'REQUEST_CONFLICT'; END IF;
    IF media_row.id IS NULL THEN RAISE EXCEPTION 'MEDIA_NOT_FOUND'; END IF;

    IF media_row.status = 'ready' THEN
        published := publish_story_once(p_owner, p_request, p_hash, p_payload, now() + make_interval(secs => p_ttl_seconds));
        IF req.request_id IS NOT NULL THEN
            UPDATE story_publish_requests SET state = 'published', story_id = published.id, error = NULL, resolved_at = now()
             WHERE owner_id = p_owner AND request_id = p_request;
        END IF;
        RETURN jsonb_build_object('state', 'published', 'storyId', published.id);
    END IF;
    IF media_row.status = 'uploading' THEN RAISE EXCEPTION 'MEDIA_NOT_UPLOADED'; END IF;
    IF media_row.status = 'failed' THEN
        RETURN jsonb_build_object('state', 'failed', 'error', coalesce(media_row.processing_error, 'This media could not be processed.'),
                                  'retryable', media_row.processing_error_retryable);
    END IF;

    -- Still processing: validate what can be validated now, then wait for the worker.
    PERFORM 1 FROM users WHERE id = p_owner AND deleted_at IS NULL AND is_active AND moderation_state = 'ACTIVE';
    IF NOT FOUND THEN RAISE EXCEPTION 'ACCOUNT_RESTRICTED'; END IF;
    IF EXISTS (SELECT 1 FROM story_publish_requests
                WHERE media_id = media_row.id AND state = 'waiting' AND NOT (owner_id = p_owner AND request_id = p_request)) THEN
        RAISE EXCEPTION 'MEDIA_PUBLISHED';
    END IF;
    IF req.request_id IS NULL THEN
        INSERT INTO story_publish_requests (owner_id, request_id, request_hash, media_id, payload, ttl_seconds)
        VALUES (p_owner, p_request, p_hash, media_row.id, p_payload, p_ttl_seconds);
    ELSE
        UPDATE story_publish_requests SET state = 'waiting', error = NULL, resolved_at = NULL, ttl_seconds = p_ttl_seconds
         WHERE owner_id = p_owner AND request_id = p_request;
    END IF;
    RETURN jsonb_build_object('state', 'waiting');
END $$;

-- Records a successful processing run and publishes every Story waiting on it.
-- Media that was already ready (legacy upload, backfill) simply gains variants.
CREATE FUNCTION finish_media_processing(p_job bigint, p_media uuid, p_result jsonb)
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE current_status text; req story_publish_requests; story stories; published integer := 0;
BEGIN
    SELECT status INTO current_status FROM media WHERE id = p_media FOR UPDATE;
    UPDATE media_jobs SET status = 'done', finished_at = now(), locked_until = NULL, last_error = NULL WHERE id = p_job;
    IF current_status IS NULL OR current_status = 'uploading' THEN RETURN 0; END IF;
    UPDATE media
       SET status = 'ready',
           width = coalesce((p_result->>'width')::integer, width),
           height = coalesce((p_result->>'height')::integer, height),
           duration_ms = coalesce((p_result->>'durationMs')::integer, duration_ms),
           checksum_sha256 = coalesce(p_result->>'checksumSha256', checksum_sha256),
           variants = coalesce(p_result->'variants', '{}'::jsonb),
           processed_at = now(), processing_error = NULL, processing_error_retryable = false
     WHERE id = p_media;
    FOR req IN SELECT * FROM story_publish_requests WHERE media_id = p_media AND state = 'waiting' ORDER BY created_at FOR UPDATE LOOP
        BEGIN
            story := publish_story_once(req.owner_id, req.request_id, req.request_hash, req.payload,
                                        now() + make_interval(secs => req.ttl_seconds));
            UPDATE story_publish_requests SET state = 'published', story_id = story.id, error = NULL, resolved_at = now()
             WHERE owner_id = req.owner_id AND request_id = req.request_id;
            published := published + 1;
        EXCEPTION WHEN raise_exception OR unique_violation OR check_violation OR not_null_violation
                       OR foreign_key_violation OR invalid_text_representation THEN
            UPDATE story_publish_requests SET state = 'failed', error = SQLERRM, resolved_at = now()
             WHERE owner_id = req.owner_id AND request_id = req.request_id;
        END;
    END LOOP;
    RETURN published;
END $$;

-- Records a failed run: requeues it with a delay while attempts remain and the
-- failure is transient; otherwise fails the media and any Story waiting on it.
CREATE FUNCTION fail_media_processing(p_job bigint, p_media uuid, p_user_message text, p_detail text,
                                      p_retryable boolean, p_retry_after_seconds integer)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE job media_jobs;
BEGIN
    PERFORM 1 FROM media WHERE id = p_media FOR UPDATE;
    SELECT * INTO job FROM media_jobs WHERE id = p_job FOR UPDATE;
    IF p_retryable AND job.attempts < job.max_attempts THEN
        UPDATE media_jobs SET status = 'queued', run_after = now() + make_interval(secs => p_retry_after_seconds),
                              locked_by = NULL, locked_until = NULL, last_error = left(p_detail, 2000)
         WHERE id = p_job;
        RETURN 'retrying';
    END IF;
    UPDATE media_jobs SET status = 'failed', finished_at = now(), locked_until = NULL, last_error = left(p_detail, 2000) WHERE id = p_job;
    -- Already-ready media keeps serving what it had; only new uploads fail.
    UPDATE media SET status = CASE WHEN status = 'processing' THEN 'failed' ELSE status END,
                     processing_error = p_user_message, processing_error_retryable = p_retryable
     WHERE id = p_media;
    UPDATE story_publish_requests SET state = 'failed', error = p_user_message, resolved_at = now()
     WHERE media_id = p_media AND state = 'waiting';
    RETURN 'failed';
END $$;

-- Retention: claims media nobody uses (no Story, avatar, ad or waiting publish) for
-- deletion. The row lock serializes with publish_story_once (which locks the media
-- row before inserting a Story), and each check below runs with a fresh snapshot, so
-- media is never purged out from under a publish that committed first; marking it
-- failed first makes any later publish attempt fail cleanly.
CREATE FUNCTION claim_unused_media_for_purge(p_media uuid, p_min_age_hours integer)
RETURNS SETOF media LANGUAGE plpgsql AS $$
DECLARE m media;
BEGIN
    SELECT * INTO m FROM media WHERE id = p_media FOR UPDATE;
    IF m.id IS NULL OR m.status = 'uploading' OR m.created_at >= now() - make_interval(hours => p_min_age_hours) THEN RETURN; END IF;
    IF EXISTS (SELECT 1 FROM stories WHERE media_id = p_media)
       OR EXISTS (SELECT 1 FROM users WHERE avatar_media_id = p_media)
       OR EXISTS (SELECT 1 FROM ad_creatives WHERE media_id = p_media)
       OR EXISTS (SELECT 1 FROM story_publish_requests WHERE media_id = p_media AND state = 'waiting') THEN
        RETURN;
    END IF;
    UPDATE media SET status = 'failed', processing_error = 'This upload expired before it was used.',
                     processing_error_retryable = false, purged_at = coalesce(purged_at, now())
     WHERE id = p_media RETURNING * INTO m;
    RETURN NEXT m;
END $$;

-- Deleted accounts: when their media was purged and their profile scrubbed.
ALTER TABLE users ADD COLUMN data_purged_at timestamptz;

-- Indexes for the retention sweeps.
CREATE INDEX media_originals_due_idx ON media (processed_at) WHERE original_purged_at IS NULL AND purged_at IS NULL;
CREATE INDEX stories_deleted_at_idx ON stories (deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX stories_moderation_removed_idx ON stories (moderation_removed_at) WHERE moderation_removed_at IS NOT NULL;
CREATE INDEX users_deleted_pending_purge_idx ON users (deleted_at) WHERE deleted_at IS NOT NULL AND data_purged_at IS NULL;

-- Evidence that scheduled retention ran, and what it removed.
CREATE TABLE retention_runs (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    task        text NOT NULL,
    started_at  timestamptz NOT NULL DEFAULT now(),
    finished_at timestamptz,
    items       integer NOT NULL DEFAULT 0,
    error       text
);
CREATE INDEX retention_runs_task_idx ON retention_runs (task, started_at DESC);

-- Backfill: give media uploaded before this migration its variants. These rows
-- stay 'ready' throughout; a failed backfill leaves them exactly as they were.
INSERT INTO media_jobs (media_id) SELECT id FROM media WHERE status = 'ready' AND processed_at IS NULL;
