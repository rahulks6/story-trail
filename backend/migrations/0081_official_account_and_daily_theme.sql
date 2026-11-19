-- Katkee's own account and the daily theme.
--
-- 1. users.is_official: the one account run by the Katkee team (shown as Katkee, verified). It
--    follows new people so nobody starts with an empty Activity, and it's suggested first in
--    "People to follow". Nobody is ever made to follow it. At most one account is official.
ALTER TABLE users ADD COLUMN is_official boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX users_one_official ON users ((true)) WHERE is_official;

-- 2. The daily theme reminder (modules/themes): a push-only kind, keeping every kind earlier
--    migrations added (0078's pattern).
DO $$
DECLARE
  allowed text[];
BEGIN
  SELECT array_agg(DISTINCT m[1]) INTO allowed
    FROM pg_constraint c, regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''', 'g') AS m
   WHERE c.conname = 'push_outbox_kind_check' AND c.conrelid = 'push_outbox'::regclass;
  IF allowed IS NULL OR NOT ('message' = ANY (allowed)) THEN
    RAISE EXCEPTION 'push_outbox_kind_check not found or not understood';
  END IF;
  ALTER TABLE push_outbox DROP CONSTRAINT push_outbox_kind_check;
  EXECUTE format('ALTER TABLE push_outbox ADD CONSTRAINT push_outbox_kind_check CHECK (kind IN (%s))',
    (SELECT string_agg(quote_literal(k), ', ' ORDER BY k) FROM (SELECT DISTINCT unnest(allowed || ARRAY['daily_theme']) AS k) kinds));
END $$;
