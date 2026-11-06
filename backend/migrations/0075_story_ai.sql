-- What Katkee's AI understood about each Story (src/modules/stories/story-ai.ts), so nobody has
-- to tag their Stories. Once a Story's media is ready, the worker sends its picture (a video's
-- cover frame) with its caption, the words on it, its song and festival, and gets back a topic
-- from the fixed list, a picture description for screen readers, and a safety reading.
--
--   ai_topic          the AI's topic (NULL: none fits). stories.topic takes it unless the person
--                     chose one themselves (older apps still offer the choice).
--   ai_safety         'ok', or the kind of content that needs a person to look at it.
--   ai_checked_at     when it was understood; NULL until then. A refusal or a Story with nothing
--                     to look at is still marked, with NULL topic and safety.
--   ai_lease_until    a worker holds the Story until then; an expired lease (a worker stopped
--                     mid-call) lets another pick it up.
--   ai_attempts       calls made; after 3 failures the Story is left alone.
ALTER TABLE stories
  ADD COLUMN ai_topic text CHECK (ai_topic IS NULL OR length(ai_topic) BETWEEN 1 AND 30),
  ADD COLUMN ai_safety text CHECK (ai_safety IS NULL OR ai_safety IN ('ok', 'sexual', 'violence', 'self_harm', 'hate', 'other')),
  ADD COLUMN ai_checked_at timestamptz,
  ADD COLUMN ai_lease_until timestamptz,
  ADD COLUMN ai_attempts smallint NOT NULL DEFAULT 0;

-- The worker's queue: live Stories not yet understood, oldest first.
CREATE INDEX stories_ai_pending_idx ON stories (created_at) WHERE ai_checked_at IS NULL AND deleted_at IS NULL;
