-- Katkee's festivals (the Indian festival calendar) and reasons to come back each day.
--
-- festivals: one row per celebration with the days it's celebrated (Diwali runs Dhanteras to Bhai
-- Dooj). Lunar festivals can move by a day, so dates live here, not in the app; ops can correct a
-- row without an app release. A Story can be tagged with a current festival (stories.festival);
-- public festival Stories make the festival ring on Home.
CREATE TABLE festivals (
  slug text PRIMARY KEY CHECK (slug ~ '^[a-z0-9-]{3,60}$'),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 40),
  emoji text NOT NULL CHECK (char_length(emoji) BETWEEN 1 AND 8),
  greeting text NOT NULL CHECK (char_length(greeting) BETWEEN 1 AND 40),
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  CHECK (ends_on >= starts_on AND ends_on - starts_on <= 14)
);
CREATE INDEX festivals_dates_idx ON festivals (starts_on, ends_on);

INSERT INTO festivals (slug, name, emoji, greeting, starts_on, ends_on) VALUES
  ('dussehra-2026', 'Dussehra', '🏹', 'Happy Dussehra', '2026-10-20', '2026-10-21'),
  ('karwa-chauth-2026', 'Karwa Chauth', '🌙', 'Happy Karwa Chauth', '2026-10-29', '2026-10-29'),
  ('diwali-2026', 'Diwali', '🪔', 'Happy Diwali', '2026-11-06', '2026-11-11'),
  ('chhath-2026', 'Chhath Puja', '🌅', 'Happy Chhath Puja', '2026-11-14', '2026-11-15'),
  ('guru-nanak-jayanti-2026', 'Guru Nanak Jayanti', '🙏', 'Happy Gurpurab', '2026-11-24', '2026-11-24'),
  ('christmas-2026', 'Christmas', '🎄', 'Merry Christmas', '2026-12-24', '2026-12-25'),
  ('new-year-2027', 'New Year', '🎉', 'Happy New Year', '2026-12-31', '2027-01-01'),
  ('lohri-2027', 'Lohri', '🔥', 'Happy Lohri', '2027-01-13', '2027-01-13'),
  ('sankranti-2027', 'Makar Sankranti & Pongal', '🪁', 'Happy Sankranti', '2027-01-14', '2027-01-16'),
  ('republic-day-2027', 'Republic Day', '🇮🇳', 'Happy Republic Day', '2027-01-26', '2027-01-26'),
  ('shivratri-2027', 'Maha Shivratri', '🔱', 'Happy Maha Shivratri', '2027-03-06', '2027-03-06'),
  ('eid-ul-fitr-2027', 'Eid al-Fitr', '🌙', 'Eid Mubarak', '2027-03-10', '2027-03-11'),
  ('holi-2027', 'Holi', '🎨', 'Happy Holi', '2027-03-21', '2027-03-22'),
  ('ram-navami-2027', 'Ram Navami', '🏹', 'Happy Ram Navami', '2027-04-15', '2027-04-15'),
  ('baisakhi-2027', 'Baisakhi', '🌾', 'Happy Baisakhi', '2027-04-14', '2027-04-14'),
  ('eid-al-adha-2027', 'Eid al-Adha', '🌙', 'Eid Mubarak', '2027-05-17', '2027-05-18'),
  ('independence-day-2027', 'Independence Day', '🇮🇳', 'Happy Independence Day', '2027-08-15', '2027-08-15'),
  ('raksha-bandhan-2027', 'Raksha Bandhan', '🎀', 'Happy Raksha Bandhan', '2027-08-17', '2027-08-17'),
  ('janmashtami-2027', 'Janmashtami', '🦚', 'Happy Janmashtami', '2027-08-25', '2027-08-25'),
  ('ganesh-chaturthi-2027', 'Ganesh Chaturthi', '🐘', 'Ganpati Bappa Morya', '2027-09-04', '2027-09-14'),
  ('onam-2027', 'Onam', '🌼', 'Happy Onam', '2027-09-12', '2027-09-12'),
  ('navratri-2027', 'Navratri', '💃', 'Happy Navratri', '2027-09-30', '2027-10-08'),
  ('durga-puja-2027', 'Durga Puja', '🔱', 'Shubho Durga Puja', '2027-10-05', '2027-10-09'),
  ('dussehra-2027', 'Dussehra', '🏹', 'Happy Dussehra', '2027-10-09', '2027-10-10'),
  ('diwali-2027', 'Diwali', '🪔', 'Happy Diwali', '2027-10-27', '2027-11-01');

ALTER TABLE stories ADD COLUMN festival text REFERENCES festivals (slug) ON UPDATE CASCADE ON DELETE SET NULL;
CREATE INDEX stories_festival_idx ON stories (festival, created_at DESC) WHERE festival IS NOT NULL AND deleted_at IS NULL;

-- New switches (all on unless turned off): Stories from people you follow, view milestones on
-- your Stories, and reminders (festival greetings, your posting streak, a nudge after a few days).
ALTER TABLE notification_preferences
  ADD COLUMN stories_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN milestones_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN reminders_enabled boolean NOT NULL DEFAULT true;

-- Push-only kinds (no Activity row): the text and link are written when queued.
ALTER TABLE push_outbox
  ADD COLUMN body text CHECK (body IS NULL OR char_length(body) <= 200),
  ADD COLUMN link text CHECK (link IS NULL OR link ~ '^katkee://');
ALTER TABLE push_outbox DROP CONSTRAINT push_outbox_kind_check;
ALTER TABLE push_outbox ADD CONSTRAINT push_outbox_kind_check
  CHECK (kind IN ('like', 'comment', 'follow', 'follow_request', 'follow_accepted', 'mention', 'message', 'badge',
                  'new_story', 'story_milestone', 'festival', 'streak', 'nudge'));

-- What was sent to whom, so each reason fires at most as often as it should (one new-Story push
-- per person you follow per day, each milestone once, each festival once, nudges weekly).
CREATE TABLE push_sent (
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind text NOT NULL,
  ref_key text NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, kind, ref_key)
);
CREATE INDEX push_sent_recent_idx ON push_sent (user_id, kind, sent_at DESC);

-- Publishing after media processing (migration 0046's function) also keeps the festival tag.
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
 INSERT INTO stories(owner_id,media_id,caption,audience,allow_comments,allow_sharing,expires_at,overlays,drawing,filter,audio_muted,crop,publish_request_id,publish_request_hash,music,festival)
 VALUES(p_owner,media_row.id,p_payload->>'caption',p_payload->>'audience',p_payload->>'allowComments',(p_payload->>'allowSharing')::boolean,p_expires,p_payload->'overlays',p_payload->'drawing',p_payload->>'filter',(p_payload->>'audioMuted')::boolean,p_payload->'crop',p_request,p_hash,
        CASE WHEN jsonb_typeof(p_payload->'music')='object' THEN p_payload->'music' END,
        (SELECT f.slug FROM festivals f WHERE f.slug = p_payload->>'festival'))
 RETURNING * INTO existing;
 RETURN existing;
END $$;

-- Consecutive days (India time) with at least one Story, ending today, or yesterday when nothing
-- is posted yet today (so a streak isn't lost until the day is over).
CREATE FUNCTION posting_streak(p_user uuid) RETURNS integer LANGUAGE sql STABLE AS $$
  WITH days AS (
         SELECT DISTINCT (created_at AT TIME ZONE 'Asia/Kolkata')::date AS d
         FROM stories WHERE owner_id = p_user AND created_at > now() - interval '400 days' AND moderation_removed_at IS NULL),
       today AS (SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date AS t),
       anchor AS (SELECT CASE WHEN EXISTS (SELECT 1 FROM days, today WHERE d = t) THEN t ELSE t - 1 END AS a FROM today),
       ranked AS (SELECT (SELECT a FROM anchor) - d AS gap, row_number() OVER (ORDER BY d DESC) - 1 AS rn
                  FROM days WHERE d <= (SELECT a FROM anchor))
  SELECT count(*)::integer FROM ranked WHERE gap = rn;
$$;
