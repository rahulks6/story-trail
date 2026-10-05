-- Provider authentication extends canonical users; existing email accounts remain valid.
ALTER TABLE users ALTER COLUMN email DROP NOT NULL;
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
CREATE TABLE auth_identities (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id),
 provider text NOT NULL CHECK(provider IN ('GOOGLE','PHONE')), subject text NOT NULL,
 verified_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now(),
 last_used_at timestamptz NOT NULL DEFAULT now(), UNIQUE(provider,subject), UNIQUE(user_id,provider)
);
CREATE TABLE auth_provider_proofs (
 token_hash text PRIMARY KEY, provider text NOT NULL CHECK(provider IN ('GOOGLE','PHONE')),
 subject text NOT NULL, verified_email citext, display_name text NOT NULL DEFAULT '',
 expires_at timestamptz NOT NULL DEFAULT now()+interval '5 minutes', consumed_at timestamptz
);
CREATE INDEX auth_provider_proofs_expiry_idx ON auth_provider_proofs(expires_at);
CREATE TABLE auth_reauth_tickets (
 token_hash text PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id),
 expires_at timestamptz NOT NULL DEFAULT now()+interval '5 minutes',consumed_at timestamptz
);
CREATE TABLE auth_phone_challenges (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), token_hash text NOT NULL UNIQUE,
 phone_hash text NOT NULL, ip_hash text NOT NULL, masked_destination text NOT NULL,
 provider_sid text, status text NOT NULL DEFAULT 'SENDING' CHECK(status IN ('SENDING','PENDING','CHECKING','VERIFIED','FAILED')),
 attempts integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL DEFAULT now()+interval '10 minutes'
);
CREATE INDEX auth_phone_rate_idx ON auth_phone_challenges(phone_hash,created_at DESC);
CREATE INDEX auth_phone_ip_rate_idx ON auth_phone_challenges(ip_hash,created_at DESC);
CREATE INDEX auth_phone_created_idx ON auth_phone_challenges(created_at DESC);

CREATE FUNCTION complete_provider_proof(p_hash text,p_username text,p_name text) RETURNS uuid LANGUAGE plpgsql AS $$
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
  INSERT INTO users(username,email,password_hash,display_name) VALUES(p_username,proof.verified_email,NULL,coalesce(nullif(p_name,''),p_username)) RETURNING * INTO target;
  INSERT INTO auth_identities(user_id,provider,subject) VALUES(target.id,proof.provider,proof.subject);
 END IF;
 UPDATE auth_identities SET last_used_at=now() WHERE user_id=target.id AND provider=proof.provider;
 UPDATE auth_provider_proofs SET consumed_at=now() WHERE token_hash=p_hash;
 RETURN target.id;
END $$;

CREATE FUNCTION change_auth_identity(p_user uuid,p_ticket text,p_proof text,p_unlink text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE target users%ROWTYPE; proof auth_provider_proofs%ROWTYPE; existing uuid;
BEGIN
 SELECT * INTO target FROM users WHERE id=p_user AND deleted_at IS NULL AND is_active FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'ACCOUNT_UNAVAILABLE'; END IF;
 UPDATE auth_reauth_tickets SET consumed_at=now() WHERE token_hash=p_ticket AND user_id=p_user AND consumed_at IS NULL AND expires_at>now();
 IF NOT FOUND THEN RAISE EXCEPTION 'REAUTH_REQUIRED'; END IF;
 IF p_unlink<>'' THEN
  IF target.password_hash IS NULL AND (SELECT count(*) FROM auth_identities WHERE user_id=p_user AND provider<>p_unlink)=0 THEN RAISE EXCEPTION 'LAST_METHOD'; END IF;
  DELETE FROM auth_identities WHERE user_id=p_user AND provider=p_unlink;
 ELSE
  SELECT * INTO proof FROM auth_provider_proofs WHERE token_hash=p_proof AND consumed_at IS NULL AND expires_at>now() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_PROOF'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(proof.provider||proof.subject,1));
  SELECT user_id INTO existing FROM auth_identities WHERE provider=proof.provider AND subject=proof.subject;
  IF existing IS NOT NULL AND existing<>p_user THEN RAISE EXCEPTION 'IDENTITY_IN_USE'; END IF;
  IF EXISTS(SELECT 1 FROM auth_identities WHERE user_id=p_user AND provider=proof.provider AND subject<>proof.subject) THEN RAISE EXCEPTION 'PROVIDER_ALREADY_LINKED'; END IF;
  INSERT INTO auth_identities(user_id,provider,subject) VALUES(p_user,proof.provider,proof.subject) ON CONFLICT(provider,subject) DO NOTHING;
  UPDATE auth_provider_proofs SET consumed_at=now() WHERE token_hash=p_proof;
 END IF;
 -- A changed login method revokes refresh material; current access expires normally.
 UPDATE refresh_tokens SET revoked_at=now() WHERE user_id=p_user AND revoked_at IS NULL;
END $$;
CREATE FUNCTION reserve_phone_challenge(p_token text,p_phone text,p_ip text,p_mask text,p_daily_limit integer) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE result uuid;
BEGIN
 PERFORM pg_advisory_xact_lock(782384921);
 IF EXISTS(SELECT 1 FROM auth_phone_challenges WHERE phone_hash=p_phone AND created_at>now()-interval '60 seconds')
 OR (SELECT count(*) FROM auth_phone_challenges WHERE phone_hash=p_phone AND created_at>now()-interval '1 day')>=5
 OR (SELECT count(*) FROM auth_phone_challenges WHERE ip_hash=p_ip AND created_at>now()-interval '1 hour')>=20
 OR (SELECT count(*) FROM auth_phone_challenges WHERE created_at>date_trunc('day',now()))>=p_daily_limit THEN RAISE EXCEPTION 'OTP_LIMIT'; END IF;
 INSERT INTO auth_phone_challenges(token_hash,phone_hash,ip_hash,masked_destination) VALUES(p_token,p_phone,p_ip,p_mask) RETURNING id INTO result;
 RETURN result;
END $$;
