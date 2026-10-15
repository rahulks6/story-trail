-- Story replies and quick reactions: a viewer answers a Story in the owner's DMs, like Instagram.
-- The message keeps which Story it answers; if that Story is later deleted the link is cleared but
-- the message stays a reply ("replied to a Story that's no longer available").
ALTER TABLE messages ADD COLUMN reply_story_id uuid REFERENCES stories (id) ON DELETE SET NULL;
ALTER TABLE messages ADD COLUMN reply_kind text;
ALTER TABLE messages ADD CONSTRAINT messages_reply_kind CHECK (reply_kind IS NULL OR reply_kind IN ('reply', 'reaction'));
ALTER TABLE messages ADD CONSTRAINT messages_reply_story_has_kind CHECK (reply_story_id IS NULL OR reply_kind IS NOT NULL);
CREATE INDEX messages_reply_story_idx ON messages (reply_story_id) WHERE reply_story_id IS NOT NULL;
