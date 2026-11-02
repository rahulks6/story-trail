-- Sign in with Apple joins Google and phone (src/modules/auth/apple.ts). Additive: a new provider
-- value, a column for Apple's refresh token, and single-use nonces.

-- 1. APPLE is a provider like the others: same identities, proofs, linking and deletion rules.
ALTER TABLE auth_identities DROP CONSTRAINT auth_identities_provider_check;
ALTER TABLE auth_identities ADD CONSTRAINT auth_identities_provider_check CHECK (provider IN ('GOOGLE', 'PHONE', 'APPLE'));
ALTER TABLE auth_provider_proofs DROP CONSTRAINT auth_provider_proofs_provider_check;
ALTER TABLE auth_provider_proofs ADD CONSTRAINT auth_provider_proofs_provider_check CHECK (provider IN ('GOOGLE', 'PHONE', 'APPLE'));

-- 2. App Review 5.1.1(v): deleting an account revokes its Sign in with Apple authorisation, which
--    takes the refresh token Apple issued for it and the client ID it was issued to:
--    {"clientId": ..., "refreshToken": ...}. A proof carries it from sign-in until the identity is
--    created, linked or used, then the identity keeps the latest one. It only works with Katkee's
--    own signed client secret, is cleared once revoked, and is never returned by the API.
ALTER TABLE auth_provider_proofs ADD COLUMN provider_grant jsonb;
ALTER TABLE auth_identities ADD COLUMN provider_grant jsonb;

-- 3. The nonce the app passes to Apple, which Apple signs into the identity token: issued by the
--    API, used once, within ten minutes, so a captured token cannot be replayed. Stored as Apple
--    receives it, the SHA-256 of the value the app holds.
CREATE TABLE auth_apple_nonces (
    nonce_hash  text PRIMARY KEY,
    expires_at  timestamptz NOT NULL DEFAULT now() + interval '10 minutes',
    consumed_at timestamptz
);
CREATE INDEX auth_apple_nonces_expiry_idx ON auth_apple_nonces (expires_at);
