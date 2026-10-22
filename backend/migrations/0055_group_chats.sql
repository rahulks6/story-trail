-- Group chats (3 to 32 people) alongside 1:1 conversations. Every conversation now lists its
-- people in conversation_members, so one membership check decides who may read, write, get
-- the push and see "typing…", whatever the kind. 1:1 conversations keep their ordered pair
-- (find-or-create stays one indexed lookup); groups have no pair.
ALTER TABLE conversations ADD COLUMN kind text NOT NULL DEFAULT 'direct' CHECK (kind IN ('direct', 'group'));
ALTER TABLE conversations ADD COLUMN title text CHECK (title IS NULL OR char_length(title) BETWEEN 1 AND 60);
ALTER TABLE conversations ADD COLUMN created_by uuid REFERENCES users (id) ON DELETE SET NULL;
ALTER TABLE conversations ALTER COLUMN user_a_id DROP NOT NULL;
ALTER TABLE conversations ALTER COLUMN user_b_id DROP NOT NULL;
ALTER TABLE conversations ADD CONSTRAINT conversations_kind_shape CHECK (
  (kind = 'direct' AND user_a_id IS NOT NULL AND user_b_id IS NOT NULL AND title IS NULL)
  OR (kind = 'group' AND user_a_id IS NULL AND user_b_id IS NULL));

CREATE TABLE conversation_members (
  conversation_id uuid NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  -- Group admins can remove people; whoever made the group starts as one.
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  -- A member sees the group's messages from when they (last) joined, not what came before.
  joined_at timestamptz NOT NULL DEFAULT now(),
  -- Left or removed: no longer reads, writes or hears anything from the group.
  left_at timestamptz,
  added_by uuid REFERENCES users (id) ON DELETE SET NULL,
  PRIMARY KEY (conversation_id, user_id)
);
CREATE INDEX conversation_members_user_idx ON conversation_members (user_id, conversation_id) WHERE left_at IS NULL;

-- Both people in every existing 1:1 conversation, from its start (they see its whole history).
INSERT INTO conversation_members (conversation_id, user_id, joined_at)
SELECT id, user_a_id, created_at FROM conversations
UNION ALL
SELECT id, user_b_id, created_at FROM conversations;

-- A new 1:1 conversation lists its two people the moment it exists.
CREATE FUNCTION add_direct_members() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.kind = 'direct' THEN
    INSERT INTO conversation_members (conversation_id, user_id, joined_at)
    VALUES (NEW.id, NEW.user_a_id, NEW.created_at), (NEW.id, NEW.user_b_id, NEW.created_at)
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER conversations_direct_members AFTER INSERT ON conversations FOR EACH ROW EXECUTE FUNCTION add_direct_members();

-- What happened in a group, shown as a line in the thread ("@asha added @dev"): created,
-- added, removed, left, renamed. Such a message has no text, media or Story of its own.
ALTER TABLE messages ADD COLUMN event jsonb;
ALTER TABLE messages DROP CONSTRAINT messages_has_content;
ALTER TABLE messages ADD CONSTRAINT messages_has_content CHECK (body IS NOT NULL OR shared_story_id IS NOT NULL OR media_id IS NOT NULL OR event IS NOT NULL);
