-- Phase 14: Katkee is for people 18 and older (India launch: the Digital Personal Data Protection
-- Act 2023 treats everyone under 18 as a child). Additive: one nullable column, one new table, a
-- new report reason, and the provider sign-up function taking the date of birth.

-- 1. The date of birth a person gives when they create an account. The API refuses anyone under
--    18 before anything is stored (src/modules/auth/age.ts). It is never shown on a profile,
--    never returned by the API, never used for ads, and is cleared when a deleted account is
--    scrubbed. Accounts created before this migration have none.
ALTER TABLE users ADD COLUMN birth_date date;
ALTER TABLE users ADD CONSTRAINT users_birth_date_plausible CHECK (birth_date IS NULL OR birth_date >= DATE '1900-01-01');

-- 2. India's IT Rules 2021, rule 3(1)(h): an intermediary keeps the information a person
--    registered with for 180 days after the account is cancelled. Retention scrubs a deleted
--    account 30 days after deletion (src/modules/media/retention.ts deletedAccounts); it copies
--    the registration details here first, and deletes each record once the account has been
--    deleted for 180 days (RETENTION_DELETED_ACCOUNT_RECORD_DAYS). Nothing in the API or the
--    Admin console reads this table: it exists only to answer lawful requests.
CREATE TABLE deleted_account_records (
    user_id        uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
    username       citext NOT NULL,
    -- Names it used before a rename, oldest first: the first is the one it registered with.
    previous_usernames jsonb NOT NULL DEFAULT '[]'::jsonb,
    email          citext,
    display_name   text NOT NULL,
    birth_date     date,
    -- [{"provider": "GOOGLE" | "PHONE", "subject": ..., "linkedAt": ...}]; a phone subject is the
    -- keyed hash the sign-in stored, never the number itself.
    identities     jsonb NOT NULL DEFAULT '[]'::jsonb,
    registered_at  timestamptz NOT NULL,
    deleted_at     timestamptz NOT NULL,
    recorded_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX deleted_account_records_deleted_idx ON deleted_account_records (deleted_at);

-- 3. "May be under 18" joins the report reasons, ranked with nudity and violence: a child's
--    account on an adults-only service is handled first.
ALTER TABLE reports DROP CONSTRAINT reports_reason_valid;
ALTER TABLE reports ADD CONSTRAINT reports_reason_valid CHECK (reason IN (
  'spam', 'harassment', 'nudity', 'violence', 'hate_speech', 'self_harm', 'impersonation', 'scam', 'under_18', 'other'));
CREATE OR REPLACE FUNCTION report_reason_priority(p_reason text) RETURNS integer LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_reason WHEN 'self_harm' THEN 3 WHEN 'violence' THEN 2 WHEN 'hate_speech' THEN 2 WHEN 'nudity' THEN 2
    WHEN 'under_18' THEN 2 WHEN 'harassment' THEN 1 WHEN 'impersonation' THEN 1 WHEN 'scam' THEN 1 ELSE 0 END
$$;

-- 4. Signing up with Google or a phone number records the date of birth too. A new account
--    without one is refused; the API has already checked the age. Returning people don't need
--    one: their account exists, so callers that pass three arguments still work for them.
DROP FUNCTION complete_provider_proof(text, text, text);
CREATE FUNCTION complete_provider_proof(p_hash text, p_username text, p_name text, p_birth_date date DEFAULT NULL) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE proof auth_provider_proofs%ROWTYPE; identity auth_identities%ROWTYPE; target users%ROWTYPE;
BEGIN
 SELECT * INTO proof FROM auth_provider_proofs WHERE token_hash=p_hash AND consumed_at IS NULL AND expires_at>now() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_PROOF'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(proof.provider||proof.subject,1));
 SELECT * INTO identity FROM auth_identities WHERE provider=proof.provider AND subject=proof.subject;
 IF FOUND THEN
  SELECT * INTO target FROM users WHERE id=identity.user_id FOR UPDATE;
  IF NOT target.is_active OR target.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'ACCOUNT_UNAVAILABLE'; END IF;
 ELSE
  IF proof.verified_email IS NOT NULL AND EXISTS(SELECT 1 FROM users WHERE email=proof.verified_email AND deleted_at IS NULL) THEN RAISE EXCEPTION 'LINK_REQUIRED'; END IF;
  IF p_username IS NULL OR p_username='' THEN RAISE EXCEPTION 'USERNAME_REQUIRED'; END IF;
  IF p_birth_date IS NULL THEN RAISE EXCEPTION 'BIRTH_DATE_REQUIRED'; END IF;
  INSERT INTO users(username,email,password_hash,display_name,birth_date) VALUES(p_username,proof.verified_email,NULL,coalesce(nullif(p_name,''),p_username),p_birth_date) RETURNING * INTO target;
  INSERT INTO auth_identities(user_id,provider,subject) VALUES(target.id,proof.provider,proof.subject);
 END IF;
 UPDATE auth_identities SET last_used_at=now() WHERE user_id=target.id AND provider=proof.provider;
 UPDATE auth_provider_proofs SET consumed_at=now() WHERE token_hash=p_hash;
 RETURN target.id;
END $$;
