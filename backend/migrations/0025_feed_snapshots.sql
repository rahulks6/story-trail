-- Shared, short-lived ranking order only. Content access is checked on every page.
CREATE TABLE home_feed_snapshots (
 id uuid PRIMARY KEY,
 viewer_id uuid NOT NULL REFERENCES users(id),
 items jsonb NOT NULL CHECK(jsonb_typeof(items)='array' AND jsonb_array_length(items)<=251),
 created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL DEFAULT now()+interval '3 minutes'
);
CREATE INDEX home_feed_snapshots_viewer_idx ON home_feed_snapshots(viewer_id,created_at DESC);
CREATE INDEX home_feed_snapshots_expiry_idx ON home_feed_snapshots(expires_at);
