-- What goes wrong in the app, on Katkee's own server (no third-party crash SDK): the
-- JavaScript error and where it happened, never message text or media. Kept 90 days.
CREATE TABLE crash_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  -- The device's id for the report: a resend after a lost response is not a second report.
  client_report_id text NOT NULL CHECK (client_report_id ~ '^[A-Za-z0-9_-]{16,64}$'),
  -- The same crash on every phone groups under one fingerprint (error name + first frames).
  fingerprint text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('fatal', 'render', 'handled')),
  name text NOT NULL CHECK (length(name) <= 120),
  message text NOT NULL CHECK (length(message) <= 500),
  stack text NOT NULL DEFAULT '' CHECK (length(stack) <= 8000),
  component_stack text NOT NULL DEFAULT '' CHECK (length(component_stack) <= 4000),
  screen text NOT NULL DEFAULT '' CHECK (length(screen) <= 80),
  platform text NOT NULL CHECK (platform IN ('android', 'ios')),
  os_version text NOT NULL DEFAULT '' CHECK (length(os_version) <= 40),
  app_version text NOT NULL DEFAULT '' CHECK (length(app_version) <= 40),
  device_model text NOT NULL DEFAULT '' CHECK (length(device_model) <= 80),
  occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, client_report_id)
);
CREATE INDEX crash_reports_fingerprint_idx ON crash_reports (fingerprint, created_at DESC);
CREATE INDEX crash_reports_created_idx ON crash_reports (created_at);

-- Settings > Help > Send feedback: what a tester tells you, with a screenshot if they add one.
CREATE TABLE app_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  body text NOT NULL CHECK (length(body) BETWEEN 1 AND 2000),
  screenshot_media_id uuid REFERENCES media (id) ON DELETE SET NULL,
  platform text NOT NULL CHECK (platform IN ('android', 'ios')),
  os_version text NOT NULL DEFAULT '' CHECK (length(os_version) <= 40),
  app_version text NOT NULL DEFAULT '' CHECK (length(app_version) <= 40),
  device_model text NOT NULL DEFAULT '' CHECK (length(device_model) <= 80),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  resolved_at timestamptz,
  resolved_by uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX app_feedback_status_idx ON app_feedback (status, created_at DESC);
CREATE INDEX app_feedback_screenshot_idx ON app_feedback (screenshot_media_id) WHERE screenshot_media_id IS NOT NULL;

-- A feedback screenshot is in use: unused-media cleanup leaves it alone (0045 + app_feedback).
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
       OR EXISTS (SELECT 1 FROM story_publish_requests WHERE media_id = p_media AND state = 'waiting') THEN
        RETURN;
    END IF;
    UPDATE media SET status = 'failed', processing_error = 'This upload expired before it was used.',
                     processing_error_retryable = false, purged_at = coalesce(purged_at, now())
     WHERE id = p_media RETURNING * INTO m;
    RETURN NEXT m;
END $$;
