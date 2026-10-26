-- Forward: a message sent on to other chats is a new message that says "Forwarded". It names
-- nobody: the people it reaches don't learn who wrote the original or where it was sent.
ALTER TABLE messages ADD COLUMN forwarded boolean NOT NULL DEFAULT false;

-- Pinned messages: up to three per conversation, shared by everyone in it. A pin goes with its
-- message (unsent, or deleted with an account), and with the account that pinned it.
CREATE TABLE conversation_pins (
  conversation_id uuid NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  message_id uuid NOT NULL REFERENCES messages (id) ON DELETE CASCADE,
  pinned_by uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  pinned_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, message_id)
);
-- Deleting a message finds its pin without a scan.
CREATE INDEX conversation_pins_message_idx ON conversation_pins (message_id);

-- The limit and the "same conversation" rule hold however a pin is written. Pins in one
-- conversation are written one at a time (the conversation row's lock), and each statement in
-- here sees what was committed before it, so two people pinning at once can't make it four.
CREATE FUNCTION conversation_pins_rules() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM conversations WHERE id = NEW.conversation_id FOR NO KEY UPDATE;
  IF NOT EXISTS (SELECT 1 FROM messages WHERE id = NEW.message_id AND conversation_id = NEW.conversation_id AND event IS NULL) THEN
    RAISE EXCEPTION 'PIN_NOT_IN_CONVERSATION';
  END IF;
  -- Pinning a message that's already pinned changes nothing (ON CONFLICT), so it doesn't count.
  IF (SELECT count(*) FROM conversation_pins WHERE conversation_id = NEW.conversation_id AND message_id <> NEW.message_id) >= 3 THEN
    RAISE EXCEPTION 'TOO_MANY_PINS';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER conversation_pins_rules BEFORE INSERT ON conversation_pins FOR EACH ROW EXECUTE FUNCTION conversation_pins_rules();
