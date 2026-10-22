-- Per-person chat settings. Muted: no pushes for that conversation (it still shows as unread).
-- Delete chat: it leaves your inbox, and what came before is no longer shown to you; a new
-- message brings it back. Neither changes anything for the other people in it.
ALTER TABLE conversation_members ADD COLUMN muted boolean NOT NULL DEFAULT false;
ALTER TABLE conversation_members ADD COLUMN hidden_before timestamptz;
