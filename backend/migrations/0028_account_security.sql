-- Account security: password reset, per-session revocation, shared rate limits,
-- and a security event log. Additive: existing sessions, users and tokens stay valid.

-- A credential change (password reset/change, "log out everywhere") stamps this column.
-- Access tokens issued before it are rejected on the next request, not 15 minutes later.
ALTER TABLE users ADD COLUMN IF NOT EXISTS sessions_revoked_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ;

-- A "session" is one sign-in on one device. Refresh rotation creates a new row per use,
-- so rows of one sign-in share a session_id. Existing rows become their own session.
ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS session_id UUID;
UPDATE refresh_tokens SET session_id = id WHERE session_id IS NULL;
ALTER TABLE refresh_tokens ALTER COLUMN session_id SET NOT NULL;
ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS refresh_tokens_active_session_idx
    ON refresh_tokens (session_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS refresh_tokens_user_session_idx
    ON refresh_tokens (user_id, session_id, created_at DESC);

-- Explicitly ended sign-ins (logout, "sign out of this device", "other devices").
-- Checked on every authenticated request, so the session's access token stops working
-- immediately. Rows older than the refresh-token lifetime are removed by retention jobs.
CREATE TABLE revoked_sessions (
    session_id  UUID PRIMARY KEY,
    user_id     UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    revoked_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX revoked_sessions_revoked_at_idx ON revoked_sessions (revoked_at);

-- Password reset by emailed one-time code. Only the newest unconsumed request per
-- account is usable; the code is stored as an HMAC keyed by a server secret (a
-- leaked table cannot be brute-forced offline) and allows 5 attempts.
CREATE TABLE password_reset_requests (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    code_hash       TEXT NOT NULL,
    attempts        INTEGER NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at      TIMESTAMPTZ NOT NULL DEFAULT now() + interval '15 minutes',
    consumed_at     TIMESTAMPTZ
);
CREATE INDEX password_reset_requests_user_idx ON password_reset_requests (user_id, created_at DESC) WHERE consumed_at IS NULL;
CREATE INDEX password_reset_requests_expiry_idx ON password_reset_requests (expires_at);

-- Fixed-window counters shared by every API instance (the in-memory limiter is per
-- process). Used for login, password reset and admin login budgets.
CREATE TABLE rate_limit_buckets (
    key                 TEXT PRIMARY KEY,
    window_started_at   TIMESTAMPTZ NOT NULL,
    hits                INTEGER NOT NULL
);
CREATE INDEX rate_limit_buckets_window_idx ON rate_limit_buckets (window_started_at);

-- Returns 0 when the hit is allowed, otherwise the seconds until the window resets.
-- A single upsert, so concurrent requests on different instances count correctly.
CREATE FUNCTION consume_rate_limit(p_key TEXT, p_max INTEGER, p_window_seconds INTEGER)
RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE bucket rate_limit_buckets%ROWTYPE;
BEGIN
    INSERT INTO rate_limit_buckets (key, window_started_at, hits)
    VALUES (p_key, now(), 1)
    ON CONFLICT (key) DO UPDATE SET
        hits = CASE WHEN rate_limit_buckets.window_started_at <= now() - make_interval(secs => p_window_seconds)
                    THEN 1 ELSE rate_limit_buckets.hits + 1 END,
        window_started_at = CASE WHEN rate_limit_buckets.window_started_at <= now() - make_interval(secs => p_window_seconds)
                    THEN now() ELSE rate_limit_buckets.window_started_at END
    RETURNING * INTO bucket;
    IF bucket.hits <= p_max THEN RETURN 0; END IF;
    RETURN GREATEST(1, ceil(extract(epoch FROM bucket.window_started_at + make_interval(secs => p_window_seconds) - now()))::INTEGER);
END $$;

-- Who signed in where, and every credential change. Shown to the account owner
-- (Account security → Recent activity); IPs are stored only as keyed hashes.
CREATE TABLE auth_security_events (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    kind        TEXT NOT NULL,
    device_hash TEXT,
    user_agent  TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT auth_security_events_kind_valid CHECK (kind IN (
        'login_succeeded', 'login_failed', 'login_new_device', 'login_locked',
        'password_reset_requested', 'password_reset_completed', 'password_changed',
        'session_revoked', 'sessions_revoked'
    ))
);
CREATE INDEX auth_security_events_user_idx ON auth_security_events (user_id, created_at DESC);
CREATE INDEX auth_security_events_device_idx ON auth_security_events (user_id, device_hash) WHERE kind = 'login_succeeded';
