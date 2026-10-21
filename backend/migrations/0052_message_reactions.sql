-- Reactions on direct messages (long-press a message, like Instagram): one per person per
-- message, changeable, gone with the message or the account.
CREATE TABLE message_reactions (
  message_id uuid NOT NULL REFERENCES messages (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  emoji text NOT NULL CHECK (emoji IN ('❤️', '😂', '😮', '😢', '😡', '👍')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id)
);

-- "@x reacted ❤️ to your message": a push like a new message (the New messages switch).
ALTER TABLE push_outbox DROP CONSTRAINT push_outbox_kind_check;
ALTER TABLE push_outbox ADD CONSTRAINT push_outbox_kind_check
  CHECK (kind IN ('like', 'comment', 'follow', 'follow_request', 'follow_accepted', 'mention', 'message', 'badge',
                  'new_story', 'story_milestone', 'festival', 'streak', 'nudge', 'message_reaction'));
