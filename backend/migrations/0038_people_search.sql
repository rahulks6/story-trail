-- Phase 8b: people search also matches interests, and "Suggested for you" (spec section 10).
-- Indexes only; no data changes.
--
-- Interests are a JSON array kept as text (interests_json). The trigram index lets a "contains"
-- search use an index (each element is then checked exactly); the GIN index on the lowercased
-- array finds people who share an interest.
CREATE INDEX users_interests_trgm_idx ON users USING GIN (interests_json gin_trgm_ops);
CREATE INDEX users_interest_keys_idx ON users USING GIN ((lower(interests_json)::jsonb));
-- One- and two-letter searches (too short for trigrams) read usernames in this order: those
-- starting with the term, then the rest, stopping after a page.
CREATE INDEX users_username_lower_c_idx ON users ((lower(username::text) COLLATE "C"));

-- A person's newest followers ("Follows you") and newest follows (the people whose follows make
-- "Followed by ..." suggestions), without sorting everyone they follow or who follows them.
CREATE INDEX follows_followee_recent_idx ON follows (followee_id, created_at DESC);
CREATE INDEX follows_follower_recent_idx ON follows (follower_id, created_at DESC);
