-- Growth, privately: find friends from your contacts, and invite friends with a personal link
-- (src/modules/growth). Additive: new columns default to what everyone has today, new tables
-- start empty.

-- 1. "Let people find me from their contacts" (Settings > Privacy). On by default; off means
--    contact matching never returns this account, whatever the other person uploads.
ALTER TABLE users ADD COLUMN findable_by_contacts boolean NOT NULL DEFAULT true;

-- 2. The hash the app makes of a contact's email or phone number, made the same way for an
--    account's own verified email here. The app hashes "katkee-contacts-v1|<kind>|<value>" with
--    SHA-256 (mobile/src/utils/contactHashes.ts) and uploads only that. The "pepper" is fixed and
--    ships in the app, so it is not a secret: it stops a hash being reused across services, not a
--    determined guesser (phone numbers are few enough to try them all). That is why uploaded
--    hashes are never stored, and why phone numbers are matched through a keyed hash (below).
--    convert_to is only STABLE because it looks up the encoding by name; the database is UTF8 for
--    its whole life, so declaring the wrapper IMMUTABLE (needed for the index) is safe.
CREATE FUNCTION contact_match_hash(p_kind text, p_value text) RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT encode(sha256(convert_to('katkee-contacts-v1|' || p_kind || '|' || p_value, 'UTF8')), 'hex')
$$;
-- Emails are already stored as they are, so hashing them here adds nothing a leak would reveal;
-- only verified ones match, so nobody is found through an address they never proved is theirs.
CREATE INDEX users_contact_email_idx ON users (contact_match_hash('email', lower(btrim(email::text))))
  WHERE email IS NOT NULL AND email_verified_at IS NOT NULL AND deleted_at IS NULL;

-- 3. Phone numbers are never stored, only a keyed hash for sign-in (0024). Matching gets its own
--    keyed hash of the app's hash: HMAC(PHONE_IDENTITY_SECRET, the hash above), so a copy of the
--    database alone can't turn it back into numbers. The number is only seen while someone signs
--    in or links a phone, so the key travels from the code request to the proof to the identity.
--    Phones linked before this migration have none until their next phone sign-in.
ALTER TABLE auth_phone_challenges ADD COLUMN contact_key text;
ALTER TABLE auth_provider_proofs ADD COLUMN contact_key text;
ALTER TABLE auth_identities ADD COLUMN contact_key text;
CREATE INDEX auth_identities_contact_key_idx ON auth_identities (contact_key) WHERE provider = 'PHONE' AND contact_key IS NOT NULL;

-- 4. Invite links: katkee.com/i/<code>, one code per person, made the first time they share it.
--    Eight characters from an alphabet without look-alikes (no 0/o, 1/l/i): about 10^12 codes,
--    so guessing one that belongs to someone is impractical.
CREATE TABLE invite_codes (
  user_id    uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  code       text NOT NULL UNIQUE CHECK (code ~ '^[2-9a-hjkmnp-z]{8}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Who joined from whose link: one inviter per new account, at most. Each suggests the other in
-- "Suggested for you", and the inviter hears "@x joined from your invite".
CREATE TABLE invite_redemptions (
  invitee_id uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  inviter_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (invitee_id <> inviter_id)
);
CREATE INDEX invite_redemptions_inviter_idx ON invite_redemptions (inviter_id, created_at DESC);
CREATE INDEX invite_redemptions_created_brin ON invite_redemptions USING brin (created_at);

-- "@x joined from your invite": an Activity row and a push, like a follow. The lists keep the
-- countdown and collab kinds added by 0062/0063, which run before this file.
ALTER TABLE notifications DROP CONSTRAINT notifications_type_valid;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_valid
    CHECK (type IN ('like', 'comment', 'follow', 'follow_request', 'follow_accepted', 'mention', 'verification', 'invite_joined',
                    'collab_invite', 'collab_accepted'));
ALTER TABLE push_outbox DROP CONSTRAINT push_outbox_kind_check;
ALTER TABLE push_outbox ADD CONSTRAINT push_outbox_kind_check
  CHECK (kind IN ('like', 'comment', 'follow', 'follow_request', 'follow_accepted', 'mention', 'message', 'badge',
                  'new_story', 'story_milestone', 'festival', 'streak', 'nudge', 'message_reaction', 'verification', 'invite_joined',
                  'countdown', 'collab_invite', 'collab_accepted'));

-- 5. The app reports an invite shared (and from where), an invite link opened in the app, and how
--    many contacts were found; never who, and never the contacts themselves.
ALTER TABLE analytics_events DROP CONSTRAINT IF EXISTS analytics_events_name_check;
ALTER TABLE analytics_events ADD CONSTRAINT analytics_events_name_check CHECK (name IN (
  'app_session_started', 'app_crash', 'story_created', 'highlight_viewed',
  'profile_viewed', 'search_performed', 'upload_succeeded', 'upload_failed', 'story_shared_external',
  'invite_shared', 'invite_link_opened', 'contacts_checked'));
