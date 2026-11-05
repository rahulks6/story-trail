-- Two-step login for everyone (Account security): an authenticator app's 6-digit code after the
-- password, or after Google, Apple or a phone code. src/modules/auth/two-step.ts. Additive.

-- The authenticator secret, sealed with the MFA key (shared/crypto.ts) like the admin console's.
-- confirmed_at is set once a first code proves the app was set up; until then it's pending.
CREATE TABLE user_mfa (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  secret_ciphertext text NOT NULL,
  last_used_step bigint NOT NULL DEFAULT 0,
  confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- One-time backup codes, hashed; a used one is never accepted again.
CREATE TABLE user_mfa_backup_codes (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash text NOT NULL,
  used_at timestamptz,
  PRIMARY KEY (user_id, code_hash)
);

-- Between the password (or provider) and the code: a short-lived, single-use challenge.
CREATE TABLE auth_two_step_challenges (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  attempts integer NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auth_two_step_challenges_expiry ON auth_two_step_challenges (expires_at);

-- Account security's sign-in history also lists two-step login being turned on or off, and a
-- wrong code after a right password (someone may know the password).
ALTER TABLE auth_security_events DROP CONSTRAINT auth_security_events_kind_valid;
ALTER TABLE auth_security_events ADD CONSTRAINT auth_security_events_kind_valid CHECK (kind IN (
  'login_succeeded', 'login_failed', 'login_new_device', 'login_locked', 'password_reset_requested',
  'password_reset_completed', 'password_changed', 'session_revoked', 'sessions_revoked',
  'two_step_enabled', 'two_step_disabled', 'two_step_failed'));
