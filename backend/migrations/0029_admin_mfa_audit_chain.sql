-- Admin MFA (TOTP + backup codes), stricter admin sessions, security alerts and a
-- tamper-evident hash chain over the append-only admin audit log. Additive.

-- TOTP secret, AES-256-GCM encrypted by the API (ADMIN_MFA_ENCRYPTION_KEY); the
-- database never holds a usable secret. last_used_step blocks code replay.
CREATE TABLE admin_mfa (
    user_id             UUID PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
    secret_ciphertext   TEXT NOT NULL,
    confirmed_at        TIMESTAMPTZ,
    last_used_step      BIGINT NOT NULL DEFAULT 0,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One-time recovery codes, stored as SHA-256 hashes of high-entropy codes.
CREATE TABLE admin_backup_codes (
    user_id     UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    code_hash   TEXT NOT NULL,
    used_at     TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, code_hash)
);

-- Password-verified, not yet MFA-verified sign-in attempts. No admin session exists
-- until the second factor succeeds.
CREATE TABLE admin_login_challenges (
    token_hash  TEXT PRIMARY KEY,
    user_id     UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    purpose     TEXT NOT NULL CHECK (purpose IN ('verify', 'enroll')),
    attempts    INTEGER NOT NULL DEFAULT 0,
    device_hash TEXT NOT NULL,
    user_agent  TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at  TIMESTAMPTZ NOT NULL DEFAULT now() + interval '5 minutes',
    consumed_at TIMESTAMPTZ
);
CREATE INDEX admin_login_challenges_expiry_idx ON admin_login_challenges (expires_at);

-- Idle timeout (sliding last_seen_at) plus an absolute lifetime, and what device it is.
ALTER TABLE admin_sessions ADD COLUMN last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE admin_sessions ADD COLUMN absolute_expires_at TIMESTAMPTZ;
UPDATE admin_sessions SET absolute_expires_at = expires_at WHERE absolute_expires_at IS NULL;
ALTER TABLE admin_sessions ALTER COLUMN absolute_expires_at SET NOT NULL;
ALTER TABLE admin_sessions ADD COLUMN device_hash TEXT;
ALTER TABLE admin_sessions ADD COLUMN user_agent TEXT;
ALTER TABLE admin_sessions ADD COLUMN mfa_verified BOOLEAN NOT NULL DEFAULT false;

-- Operational alerts for Super Admins (new-device admin sign-in, repeated failures).
CREATE TABLE security_alerts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kind            TEXT NOT NULL,
    user_id         UUID REFERENCES users (id) ON DELETE SET NULL,
    metadata        JSONB NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    acknowledged_by UUID REFERENCES users (id) ON DELETE SET NULL,
    acknowledged_at TIMESTAMPTZ
);
CREATE INDEX security_alerts_open_idx ON security_alerts (created_at DESC) WHERE acknowledged_at IS NULL;

-- Audit filtering by action and target.
CREATE INDEX IF NOT EXISTS admin_audit_action_time_idx ON admin_audit (action, created_at DESC);
CREATE INDEX IF NOT EXISTS admin_audit_target_time_idx ON admin_audit (target_id, created_at DESC);

-- Hash chain: every row commits to the previous row's hash, so editing or removing
-- history (even by a role able to bypass the append-only trigger) is detectable.
ALTER TABLE admin_audit ADD COLUMN chain_seq BIGINT;
ALTER TABLE admin_audit ADD COLUMN prev_hash TEXT;
ALTER TABLE admin_audit ADD COLUMN row_hash TEXT;
CREATE SEQUENCE admin_audit_chain_seq;

CREATE FUNCTION admin_audit_row_hash(p_prev TEXT, p_id UUID, p_actor UUID, p_action TEXT, p_target UUID, p_metadata JSONB, p_created TIMESTAMPTZ)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
    SELECT encode(digest(
        p_prev || '|' || p_id::text || '|' || coalesce(p_actor::text, '') || '|' || p_action || '|' ||
        coalesce(p_target::text, '') || '|' || p_metadata::text || '|' ||
        floor(extract(epoch FROM p_created) * 1000000)::bigint::text,
    'sha256'), 'hex')
$$;

CREATE FUNCTION admin_audit_chain() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE previous TEXT;
BEGIN
    -- Serialize audit inserts so each row links to exactly one predecessor.
    PERFORM pg_advisory_xact_lock(hashtextextended('admin_audit_chain', 0));
    SELECT row_hash INTO previous FROM admin_audit WHERE chain_seq IS NOT NULL ORDER BY chain_seq DESC LIMIT 1;
    NEW.chain_seq := nextval('admin_audit_chain_seq');
    NEW.prev_hash := coalesce(previous, 'genesis');
    NEW.row_hash := admin_audit_row_hash(NEW.prev_hash, NEW.id, NEW.actor_id, NEW.action, NEW.target_id, NEW.metadata, NEW.created_at);
    RETURN NEW;
END $$;

-- One-time backfill of existing rows in creation order. The append-only trigger is
-- disabled only inside this migration's transaction, by the schema owner.
ALTER TABLE admin_audit DISABLE TRIGGER admin_audit_immutable;
DO $$
DECLARE r RECORD; previous TEXT := 'genesis'; seq BIGINT;
BEGIN
    FOR r IN SELECT * FROM admin_audit ORDER BY created_at, id LOOP
        seq := nextval('admin_audit_chain_seq');
        UPDATE admin_audit SET chain_seq = seq, prev_hash = previous,
            row_hash = admin_audit_row_hash(previous, r.id, r.actor_id, r.action, r.target_id, r.metadata, r.created_at)
        WHERE id = r.id RETURNING row_hash INTO previous;
    END LOOP;
END $$;
ALTER TABLE admin_audit ENABLE TRIGGER admin_audit_immutable;

CREATE TRIGGER admin_audit_chain_link BEFORE INSERT ON admin_audit FOR EACH ROW EXECUTE FUNCTION admin_audit_chain();
CREATE UNIQUE INDEX admin_audit_chain_seq_idx ON admin_audit (chain_seq);

-- Recomputes the chain; returns the first broken row, or no rows when intact.
-- A deleted or reordered row breaks the next row's prev_hash. Sequence gaps alone are
-- normal (a rolled-back insert still consumes a value). Removal of the newest rows is
-- only detectable against an externally recorded head hash (see /api/v1/admin/audit/verify).
CREATE FUNCTION verify_admin_audit_chain() RETURNS TABLE (chain_seq BIGINT, id UUID, problem TEXT) LANGUAGE plpgsql AS $$
DECLARE r RECORD; previous TEXT := 'genesis';
BEGIN
    FOR r IN SELECT a.* FROM admin_audit a ORDER BY a.chain_seq LOOP
        IF r.chain_seq IS NULL OR r.row_hash IS NULL THEN
            chain_seq := r.chain_seq; id := r.id; problem := 'missing chain fields'; RETURN NEXT; RETURN;
        END IF;
        IF r.prev_hash <> previous THEN
            chain_seq := r.chain_seq; id := r.id; problem := 'previous-hash mismatch'; RETURN NEXT; RETURN;
        END IF;
        IF r.row_hash <> admin_audit_row_hash(r.prev_hash, r.id, r.actor_id, r.action, r.target_id, r.metadata, r.created_at) THEN
            chain_seq := r.chain_seq; id := r.id; problem := 'row content changed'; RETURN NEXT; RETURN;
        END IF;
        previous := r.row_hash;
    END LOOP;
END $$;
