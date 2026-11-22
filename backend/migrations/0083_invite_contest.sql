-- Invite contest (modules/growth/contest.ts): whoever brings the most friends to Katkee with
-- their invite link in the contest's dates wins the prize. A friend counts once they have used
-- Katkee on qualify_days different days, so an empty account made to pad the count doesn't.
CREATE TABLE invite_contests (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug           text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9-]{3,40}$'),
  prize_minor    integer NOT NULL CHECK (prize_minor > 0),
  -- Friends who join from an invite link from starts_at until ends_at take part...
  starts_at      timestamptz NOT NULL,
  ends_at        timestamptz NOT NULL CHECK (ends_at > starts_at),
  -- ...and their days on Katkee count until counts_until, when the results are final.
  counts_until   timestamptz NOT NULL CHECK (counts_until >= ends_at),
  qualify_days   integer NOT NULL DEFAULT 3 CHECK (qualify_days BETWEEN 1 AND 14),
  -- When everyone is told about it by push; empty until the app that shows it is out.
  announce_at    timestamptz,
  winner_id      uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- The first one: ₹1,000 Amazon voucher, 23 Nov to 21 Dec 2026 (India time), results on 24 Dec.
INSERT INTO invite_contests (slug, prize_minor, starts_at, ends_at, counts_until)
VALUES ('december-2026', 100000, '2026-11-23 00:00:00+05:30', '2026-12-22 00:00:00+05:30', '2026-12-25 00:00:00+05:30');

-- Two push-only kinds: the announcement, and "a friend now counts for you" (0078's pattern).
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
    (SELECT string_agg(quote_literal(k), ', ' ORDER BY k) FROM (SELECT DISTINCT unnest(allowed || ARRAY['invite_contest', 'contest_counted']) AS k) kinds));
END $$;
