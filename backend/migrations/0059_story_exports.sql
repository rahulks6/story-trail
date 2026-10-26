-- Sharing your own Story to other apps (src/modules/media/exports.ts). A photo Story is drawn on
-- the phone; a video Story is put together here: the processed video, the Story's text, stickers
-- and drawing (a transparent PNG the app draws, "the overlay"), its music and a Katkee mark.

-- The overlay is a PNG with transparency, kept as it was drawn (photos are re-encoded to JPEG).
-- Like an ID photo it is never served by the media routes, and it can't become a Story, an avatar,
-- an ad or a message. The export job deletes it when done; the unused-media task is the backstop.
ALTER TABLE media ADD COLUMN export_overlay boolean NOT NULL DEFAULT false;
ALTER TABLE media ADD CONSTRAINT media_export_overlay_png CHECK (NOT export_overlay OR (kind = 'photo' AND mime_type = 'image/png'));

-- One requested export: queued for the media worker, then a short-lived MP4 for the owner only,
-- deleted by retention after expires_at.
CREATE TABLE story_exports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  story_id uuid NOT NULL REFERENCES stories (id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  overlay_media_id uuid REFERENCES media (id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'ready', 'failed')),
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 2,
  locked_by text,
  locked_until timestamptz,
  storage_key text,
  byte_size bigint,
  -- What the owner is told; last_error is the detail for operators.
  error text,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  expires_at timestamptz NOT NULL DEFAULT now() + interval '24 hours',
  CHECK ((status = 'ready') = (storage_key IS NOT NULL))
);
CREATE INDEX story_exports_due_idx ON story_exports (created_at) WHERE status IN ('queued', 'running');
CREATE INDEX story_exports_expiry_idx ON story_exports (expires_at);
CREATE INDEX story_exports_owner_idx ON story_exports (owner_id, story_id);

-- The app reports a share to another app (photo or video; nothing about the Story).
ALTER TABLE analytics_events DROP CONSTRAINT IF EXISTS analytics_events_name_check;
ALTER TABLE analytics_events ADD CONSTRAINT analytics_events_name_check CHECK (name IN (
  'app_session_started', 'app_crash', 'story_created', 'highlight_viewed',
  'profile_viewed', 'search_performed', 'upload_succeeded', 'upload_failed', 'story_shared_external'));
