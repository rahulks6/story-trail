-- Replies to a message in a direct message thread (swipe a message, like Instagram): the reply
-- quotes it. The quote goes when the original message does; the reply itself stays.
ALTER TABLE messages ADD COLUMN reply_to_message_id uuid REFERENCES messages (id) ON DELETE SET NULL;

-- Deleting a message (or an account's messages) finds the replies to it without a scan.
CREATE INDEX messages_reply_to_idx ON messages (reply_to_message_id) WHERE reply_to_message_id IS NOT NULL;
