-- Interactive Story stickers (src/modules/stories/stickers.*): polls, quizzes, questions,
-- countdowns and "Add Yours" chains. The sticker itself (its question, options, prompt, end
-- time) lives in stories.overlays like every other sticker; these tables hold what viewers do
-- with it. A sticker is addressed by its Story and its overlay id, and everything here goes
-- with the Story (deleted for good) or the account.

-- One answer per person per poll or quiz, never changed afterwards (a quiz you could re-take
-- would always be won). `option_index` is the option's place in the sticker's own list.
CREATE TABLE story_sticker_votes (
  story_id uuid NOT NULL REFERENCES stories (id) ON DELETE CASCADE,
  sticker_id text NOT NULL CHECK (char_length(sticker_id) BETWEEN 1 AND 100),
  voter_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  option_index smallint NOT NULL CHECK (option_index BETWEEN 0 AND 3),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (story_id, sticker_id, voter_id)
);
-- An account's own votes (account deletion, the retention scrub).
CREATE INDEX story_sticker_votes_voter_idx ON story_sticker_votes (voter_id);

-- "Ask me anything": answers go to the Story's owner only (their Insights), never to other
-- viewers. A person may answer more than once (rate limited), like Instagram.
CREATE TABLE story_question_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  story_id uuid NOT NULL REFERENCES stories (id) ON DELETE CASCADE,
  sticker_id text NOT NULL CHECK (char_length(sticker_id) BETWEEN 1 AND 100),
  responder_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 300),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX story_question_responses_story_idx ON story_question_responses (story_id, sticker_id, created_at DESC);
CREATE INDEX story_question_responses_responder_idx ON story_question_responses (responder_id);

-- "Remind me" on a countdown: the push itself is queued in push_outbox for the moment the
-- countdown ends (run_after); this row is what the person sees as on, and what Insights counts.
CREATE TABLE story_countdown_reminders (
  story_id uuid NOT NULL REFERENCES stories (id) ON DELETE CASCADE,
  sticker_id text NOT NULL CHECK (char_length(sticker_id) BETWEEN 1 AND 100),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (story_id, sticker_id, user_id)
);
CREATE INDEX story_countdown_reminders_user_idx ON story_countdown_reminders (user_id);

-- "Add Yours": a prompt that travels from Story to Story. The first Story starts the chain;
-- every Story posted from it joins the same chain (one chain per Story). The prompt is the
-- chain's, so a joiner can't change what everyone else's sticker says.
CREATE TABLE add_yours_chains (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prompt text NOT NULL CHECK (char_length(prompt) BETWEEN 1 AND 80),
  started_by uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE story_add_yours (
  story_id uuid PRIMARY KEY REFERENCES stories (id) ON DELETE CASCADE,
  chain_id uuid NOT NULL REFERENCES add_yours_chains (id) ON DELETE CASCADE,
  joined_at timestamptz NOT NULL DEFAULT now()
);
-- A chain's Stories, newest first (the chain sheet, the participant count).
CREATE INDEX story_add_yours_chain_idx ON story_add_yours (chain_id, joined_at DESC);

-- "⏰ <title> is starting": the countdown reminder push, sent when the countdown ends.
ALTER TABLE push_outbox DROP CONSTRAINT push_outbox_kind_check;
ALTER TABLE push_outbox ADD CONSTRAINT push_outbox_kind_check
  CHECK (kind IN ('like', 'comment', 'follow', 'follow_request', 'follow_accepted', 'mention', 'message', 'badge',
                  'new_story', 'story_milestone', 'festival', 'streak', 'nudge', 'message_reaction', 'verification',
                  'countdown'));
-- A reminder switched off before its countdown ends takes its queued push with it.
CREATE INDEX push_outbox_countdown_idx ON push_outbox (user_id, ref_id) WHERE kind = 'countdown' AND status = 'queued';
