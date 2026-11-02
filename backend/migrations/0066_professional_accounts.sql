-- Professional accounts (src/modules/professional): a free switch in Settings that gives a
-- creator, artist, business or public figure a dashboard of how their Stories do. It changes
-- nothing about who can see them, and gives no ranking boost anywhere.

-- 1. The account type. NULL is a personal account. The category is shown quietly under the name
--    on the profile unless the owner hides it. A private account can't be professional: the
--    dashboard is about reaching people, and Settings explains why (see the constraint below,
--    which also stops a professional account turning private without switching back first).
--    `professional_time_zone` is the phone's time zone, for the dashboard's days and hours.
ALTER TABLE users
  ADD COLUMN professional_category text NULL
    CHECK (professional_category IS NULL OR professional_category IN ('creator', 'artist', 'public_figure', 'brand', 'news_media', 'organization')),
  ADD COLUMN professional_category_shown boolean NOT NULL DEFAULT true,
  ADD COLUMN professional_since timestamptz NULL,
  ADD COLUMN professional_time_zone text NULL CHECK (professional_time_zone IS NULL OR length(professional_time_zone) BETWEEN 1 AND 64),
  ADD CONSTRAINT users_professional_is_public CHECK (professional_category IS NULL OR NOT is_private);

-- 2. Followers gained and lost. `follows` only holds who follows now, so an unfollow left no
--    trace. One row per follow or unfollow, with no follower id: the owner sees totals per day,
--    never who left. Written by a trigger so every path counts (follow, unfollow, accepted
--    request, a block, a deleted account). Kept 40 days (retention.ts).
CREATE TABLE follower_changes (
  followee_id uuid NOT NULL,
  change smallint NOT NULL CHECK (change IN (1, -1)),
  changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX follower_changes_followee_idx ON follower_changes (followee_id, changed_at);
CREATE INDEX follower_changes_changed_brin ON follower_changes USING brin (changed_at);

CREATE FUNCTION record_follower_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO follower_changes (followee_id, change) VALUES (NEW.followee_id, 1);
  ELSE
    INSERT INTO follower_changes (followee_id, change) VALUES (OLD.followee_id, -1);
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER follows_record_change AFTER INSERT OR DELETE ON follows
  FOR EACH ROW EXECUTE FUNCTION record_follower_change();

-- When counting started, so days before it read as "not counted yet", never as zero.
CREATE TABLE follower_history_start (started_at timestamptz NOT NULL);
INSERT INTO follower_history_start (started_at) VALUES (now());

-- 3. Which half hours each person had the app open, for "when your followers are most active".
--    Half hours, so the hours still line up in India (UTC+5:30). The API writes one row per
--    person and half hour, like analytics_active_days; kept 8 days, and only ever read as
--    totals across at least 10 followers (professional/dashboard.ts).
CREATE TABLE activity_half_hours (
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  slot timestamptz NOT NULL,
  PRIMARY KEY (user_id, slot)
);
CREATE INDEX activity_half_hours_slot_brin ON activity_half_hours USING brin (slot);

-- 4. Followers' active hours per professional account, worked out at most twice a day: reading
--    every follower's activity on each dashboard visit would be slow for a large account.
--    `hours` holds 24 shares of the busiest hour (0-100) in `time_zone`, never raw counts.
CREATE TABLE professional_audience_hours (
  user_id uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  time_zone text NOT NULL,
  hours jsonb NOT NULL CHECK (jsonb_typeof(hours) = 'array'),
  active_followers integer NOT NULL CHECK (active_followers >= 0),
  sampled_followers integer NOT NULL CHECK (sampled_followers >= 0),
  computed_at timestamptz NOT NULL DEFAULT now()
);

-- 5. The app reports opening the dashboard (and for 7 or 30 days); nothing else about it.
--    Added to whatever events the list already has, so other changes to it are kept.
DO $$
DECLARE def text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO def FROM pg_constraint
   WHERE conname = 'analytics_events_name_check' AND conrelid = 'analytics_events'::regclass;
  IF def IS NULL OR position('ARRAY[' in def) = 0 THEN
    RAISE EXCEPTION 'analytics_events_name_check has an unexpected shape: %', def;
  END IF;
  ALTER TABLE analytics_events DROP CONSTRAINT analytics_events_name_check;
  EXECUTE 'ALTER TABLE analytics_events ADD CONSTRAINT analytics_events_name_check '
    || replace(def, 'ARRAY[', 'ARRAY[''professional_dashboard_viewed''::text, ');
END $$;
