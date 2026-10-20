-- Email verification: a 6-digit code sent to the account's email. Until it is entered the email
-- is unverified (nothing is blocked; the app asks people to verify). A completed password reset
-- also verifies the email, since the code reached that inbox.
ALTER TABLE users ADD COLUMN email_verified_at timestamptz;

CREATE TABLE email_verification_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  email citext NOT NULL,
  code_hash text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '30 minutes',
  consumed_at timestamptz
);
CREATE INDEX email_verification_requests_user_idx ON email_verification_requests (user_id, created_at DESC) WHERE consumed_at IS NULL;
