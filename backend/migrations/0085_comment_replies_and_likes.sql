-- Replies to comments and likes on comments (stories/engagement.service.ts).
--
-- 1. A reply belongs to a top-level comment: one level, as people read them, so a reply to a
--    reply is filed under the same top-level comment (and names the person it answers).
ALTER TABLE story_comments ADD COLUMN parent_id uuid REFERENCES story_comments (id) ON DELETE CASCADE;
CREATE INDEX story_comments_parent_idx ON story_comments (parent_id) WHERE parent_id IS NOT NULL;

-- 2. Likes on a comment, once per person.
CREATE TABLE comment_likes (
  comment_id uuid NOT NULL REFERENCES story_comments (id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (comment_id, user_id)
);
CREATE INDEX comment_likes_user_idx ON comment_likes (user_id, created_at DESC);

-- 3. "@x liked your comment" and "@x replied to your comment": notification and push kinds,
--    keeping every kind earlier migrations added (0078's pattern).
DO $$
DECLARE
  allowed text[];
BEGIN
  SELECT array_agg(DISTINCT m[1]) INTO allowed
    FROM pg_constraint c, regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''', 'g') AS m
   WHERE c.conname = 'notifications_type_valid' AND c.conrelid = 'notifications'::regclass;
  IF allowed IS NULL OR NOT ('like' = ANY (allowed)) THEN
    RAISE EXCEPTION 'notifications_type_valid not found or not understood';
  END IF;
  ALTER TABLE notifications DROP CONSTRAINT notifications_type_valid;
  EXECUTE format('ALTER TABLE notifications ADD CONSTRAINT notifications_type_valid CHECK (type IN (%s))',
    (SELECT string_agg(quote_literal(k), ', ' ORDER BY k) FROM (SELECT DISTINCT unnest(allowed || ARRAY['comment_like', 'comment_reply']) AS k) kinds));

  SELECT array_agg(DISTINCT m[1]) INTO allowed
    FROM pg_constraint c, regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''', 'g') AS m
   WHERE c.conname = 'push_outbox_kind_check' AND c.conrelid = 'push_outbox'::regclass;
  IF allowed IS NULL OR NOT ('message' = ANY (allowed)) THEN
    RAISE EXCEPTION 'push_outbox_kind_check not found or not understood';
  END IF;
  ALTER TABLE push_outbox DROP CONSTRAINT push_outbox_kind_check;
  EXECUTE format('ALTER TABLE push_outbox ADD CONSTRAINT push_outbox_kind_check CHECK (kind IN (%s))',
    (SELECT string_agg(quote_literal(k), ', ' ORDER BY k) FROM (SELECT DISTINCT unnest(allowed || ARRAY['comment_like', 'comment_reply']) AS k) kinds));
END $$;
