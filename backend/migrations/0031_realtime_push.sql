-- Phase 3 (5 October 2026): realtime delivery, push notifications and reliable direct messages.
--
-- Realtime events are published with pg_notify on the 'realtime' channel inside the
-- same statement that writes the data, so they are only sent if it commits; every API
-- instance LISTENs and forwards events to its own WebSocket connections. Payloads carry
-- ids only (never message text); clients fetch content through the authorized REST API.
-- Push notifications go through an outbox written in the same statement as the
-- notification or message, and are sent by the worker.

-- Idempotent DM sends: a retried send with the same client id returns the original message.
ALTER TABLE messages ADD COLUMN client_message_id text
    CHECK (client_message_id IS NULL OR client_message_id ~ '^[A-Za-z0-9_-]{16,64}$');
CREATE UNIQUE INDEX messages_client_id_unique ON messages (conversation_id, sender_id, client_message_id)
    WHERE client_message_id IS NOT NULL;
-- Stable keyset pagination (ties on created_at broken by id).
CREATE INDEX messages_conversation_keyset_idx ON messages (conversation_id, created_at DESC, id DESC);

-- Single-use, short-lived tickets for opening a realtime connection where a client
-- cannot send an Authorization header on the WebSocket handshake (browsers).
CREATE TABLE realtime_tickets (
    token_hash          text PRIMARY KEY,
    user_id             uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    session_id          uuid,
    -- The access token behind the ticket: the same revocation rules apply to the socket,
    -- and the connection is closed when that token would have expired.
    access_issued_at    timestamptz NOT NULL,
    access_expires_at   timestamptz NOT NULL,
    expires_at          timestamptz NOT NULL DEFAULT now() + interval '60 seconds'
);
CREATE INDEX realtime_tickets_expiry_idx ON realtime_tickets (expires_at);

-- Devices registered for push. A device belongs to the sign-in that registered it:
-- ending that session (sign-out, "sign out other devices", password reset) stops its pushes.
CREATE TABLE push_devices (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    session_id      uuid,
    provider        text NOT NULL CHECK (provider IN ('fcm', 'apns')),
    platform        text NOT NULL CHECK (platform IN ('ios', 'android')),
    token           text NOT NULL CHECK (char_length(token) BETWEEN 16 AND 4096),
    app_version     text CHECK (app_version IS NULL OR char_length(app_version) <= 40),
    locale          text CHECK (locale IS NULL OR char_length(locale) <= 35),
    created_at      timestamptz NOT NULL DEFAULT now(),
    last_seen_at    timestamptz NOT NULL DEFAULT now(),
    disabled_at     timestamptz,
    disabled_reason text
);
CREATE UNIQUE INDEX push_devices_token_unique ON push_devices (provider, token);
CREATE INDEX push_devices_user_active_idx ON push_devices (user_id) WHERE disabled_at IS NULL;
CREATE INDEX push_devices_session_idx ON push_devices (session_id) WHERE disabled_at IS NULL;

-- Push outbox. Text is rendered at send time from current data (renames, blocks and
-- deleted content are respected); DM text is never put into a push payload.
CREATE TABLE push_outbox (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    kind        text NOT NULL CHECK (kind IN ('like', 'comment', 'follow', 'follow_request', 'mention', 'message')),
    actor_id    uuid REFERENCES users (id) ON DELETE CASCADE,
    -- Story id (activity) or conversation id (message): deep link and collapse key.
    ref_id      uuid,
    status      text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sending', 'sent', 'failed', 'skipped')),
    attempts    integer NOT NULL DEFAULT 0,
    run_after   timestamptz NOT NULL DEFAULT now(),
    locked_until timestamptz,
    created_at  timestamptz NOT NULL DEFAULT now(),
    finished_at timestamptz,
    last_error  text
);
CREATE INDEX push_outbox_due_idx ON push_outbox (run_after, id) WHERE status = 'queued';
CREATE INDEX push_outbox_lease_idx ON push_outbox (locked_until) WHERE status = 'sending';
CREATE INDEX push_outbox_finished_idx ON push_outbox (finished_at) WHERE status IN ('sent', 'failed', 'skipped');

CREATE FUNCTION claim_push_batch(p_limit integer, p_lease_seconds integer)
RETURNS SETOF push_outbox LANGUAGE sql AS $$
    UPDATE push_outbox o
       SET status = 'sending', attempts = o.attempts + 1, locked_until = now() + make_interval(secs => p_lease_seconds)
     WHERE o.id IN (
        SELECT id FROM push_outbox
         WHERE (status = 'queued' AND run_after <= now()) OR (status = 'sending' AND locked_until < now())
         ORDER BY run_after, id
         FOR UPDATE SKIP LOCKED
         LIMIT p_limit)
    RETURNING o.*;
$$;

ALTER TABLE notification_preferences
    ADD COLUMN messages_enabled boolean NOT NULL DEFAULT true,
    -- Master switch for push on this account (in-app Activity is unaffected).
    ADD COLUMN push_enabled boolean NOT NULL DEFAULT true;

-- Wake the push worker as soon as something is queued.
CREATE FUNCTION push_outbox_queued() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    PERFORM pg_notify('push_outbox', '');
    RETURN NULL;
END $$;
CREATE TRIGGER push_outbox_notify AFTER INSERT ON push_outbox FOR EACH STATEMENT EXECUTE FUNCTION push_outbox_queued();

-- Ending a sign-in (sign-out, "sign out other devices", password reset) stops pushes to the
-- device it registered and makes open realtime connections re-check their session now,
-- whichever code path ended it.
CREATE FUNCTION session_ended_effects() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    UPDATE push_devices SET disabled_at = now(), disabled_reason = 'signed_out'
     WHERE session_id = NEW.session_id AND disabled_at IS NULL;
    PERFORM pg_notify('realtime', json_build_object('u', json_build_array(NEW.user_id), 'e', json_build_object('type', '_revalidate'))::text);
    RETURN NEW;
END $$;
CREATE TRIGGER revoked_sessions_effects AFTER INSERT ON revoked_sessions FOR EACH ROW EXECUTE FUNCTION session_ended_effects();

-- Suspension, deletion or "sign out everywhere": live connections re-check at once;
-- a deleted account's devices stop receiving pushes.
CREATE FUNCTION account_state_effects() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
        UPDATE push_devices SET disabled_at = now(), disabled_reason = 'account_deleted'
         WHERE user_id = NEW.id AND disabled_at IS NULL;
    END IF;
    PERFORM pg_notify('realtime', json_build_object('u', json_build_array(NEW.id), 'e', json_build_object('type', '_revalidate'))::text);
    RETURN NEW;
END $$;
CREATE TRIGGER users_account_state_effects AFTER UPDATE OF is_active, deleted_at, sessions_revoked_at ON users
    FOR EACH ROW
    WHEN (OLD.is_active IS DISTINCT FROM NEW.is_active OR OLD.deleted_at IS DISTINCT FROM NEW.deleted_at
          OR OLD.sessions_revoked_at IS DISTINCT FROM NEW.sessions_revoked_at)
    EXECUTE FUNCTION account_state_effects();
