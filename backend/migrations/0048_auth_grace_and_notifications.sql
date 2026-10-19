-- A refresh token that was just exchanged may be presented once more within a short grace window
-- and gets a fresh pair in the same sign-in. On a flaky connection the phone can lose the response
-- after the server has already rotated its token; without this, the next refresh signs it out.
ALTER TABLE refresh_tokens ADD COLUMN rotated_at timestamptz;
ALTER TABLE refresh_tokens ADD COLUMN grace_used_at timestamptz;

-- "@carol accepted your follow request": its own kind, not a misleading "started following you".
ALTER TABLE notifications DROP CONSTRAINT notifications_type_valid;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_valid
    CHECK (type IN ('like', 'comment', 'follow', 'follow_request', 'follow_accepted', 'mention'));
ALTER TABLE push_outbox DROP CONSTRAINT push_outbox_kind_check;
ALTER TABLE push_outbox ADD CONSTRAINT push_outbox_kind_check
    CHECK (kind IN ('like', 'comment', 'follow', 'follow_request', 'follow_accepted', 'mention', 'message', 'badge'));
