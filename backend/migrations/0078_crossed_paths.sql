-- Crossed paths (modules/crossed-paths): off until someone turns it on. While on, the app sends a
-- neighbourhood-sized area cell (a 5-character geohash, about 5 x 5 km, worked out on the phone
-- from approximate location; never coordinates) when it's opened. Two people who both turned it
-- on and were in the same cell within a few hours of each other are told, hours later, that they
-- crossed paths: never where or when. Visits are kept two days, crossings thirty.
ALTER TABLE users ADD COLUMN crossed_paths_enabled boolean NOT NULL DEFAULT false;

CREATE TABLE crossed_visits (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  cell text NOT NULL CHECK (cell ~ '^[0-9b-hjkmnp-z]{5}$'),
  day date NOT NULL DEFAULT (now() AT TIME ZONE 'UTC')::date,
  first_at timestamptz NOT NULL DEFAULT now(),
  last_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, cell, day)
);
CREATE INDEX crossed_visits_cell ON crossed_visits (cell, last_at);

-- Who was told about whom: one person is never shown the same person twice in a week, and
-- nobody gets more than a few a day.
CREATE TABLE crossings (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  other_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX crossings_user ON crossings (user_id, created_at);

-- The notification and push kinds, keeping every kind earlier migrations added (0068's pattern).
DO $$
DECLARE
  allowed text[];
BEGIN
  SELECT array_agg(DISTINCT m[1]) INTO allowed
    FROM pg_constraint c, regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''', 'g') AS m
   WHERE c.conname = 'notifications_type_valid' AND c.conrelid = 'notifications'::regclass;
  IF allowed IS NULL OR NOT ('like' = ANY (allowed)) THEN
    RAISE EXCEPTION 'notifications_type_valid not found or not understood';
  END IF;
  ALTER TABLE notifications DROP CONSTRAINT notifications_type_valid;
  EXECUTE format('ALTER TABLE notifications ADD CONSTRAINT notifications_type_valid CHECK (type IN (%s))',
    (SELECT string_agg(quote_literal(k), ', ' ORDER BY k) FROM (SELECT DISTINCT unnest(allowed || ARRAY['crossed_paths']) AS k) kinds));

  SELECT array_agg(DISTINCT m[1]) INTO allowed
    FROM pg_constraint c, regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''', 'g') AS m
   WHERE c.conname = 'push_outbox_kind_check' AND c.conrelid = 'push_outbox'::regclass;
  IF allowed IS NULL OR NOT ('message' = ANY (allowed)) THEN
    RAISE EXCEPTION 'push_outbox_kind_check not found or not understood';
  END IF;
  ALTER TABLE push_outbox DROP CONSTRAINT push_outbox_kind_check;
  EXECUTE format('ALTER TABLE push_outbox ADD CONSTRAINT push_outbox_kind_check CHECK (kind IN (%s))',
    (SELECT string_agg(quote_literal(k), ', ' ORDER BY k) FROM (SELECT DISTINCT unnest(allowed || ARRAY['crossed_paths']) AS k) kinds));
END $$;
