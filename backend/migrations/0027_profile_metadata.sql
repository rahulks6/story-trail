-- Profile metadata from the approved profile specification. Additive on
-- existing installations and safe to apply after the media migration.
ALTER TABLE users ADD COLUMN IF NOT EXISTS interests_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_interests_json_valid;
ALTER TABLE users ADD CONSTRAINT users_interests_json_valid CHECK (jsonb_typeof(interests_json::jsonb) = 'array');
