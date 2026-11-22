-- Automatic moderation (stories/story-ai.ts, stories/photo-check.ts).
--
-- 1. A removal the automatic check makes has no person behind it: moderation_actions.actor_id
--    is empty for those. The owner still gets the notice and can appeal, and an admin's
--    decision on the appeal is recorded with the admin as usual.
ALTER TABLE moderation_actions ALTER COLUMN actor_id DROP NOT NULL;

-- 2. Profile and cover photos are checked too: which photo was last checked, so a new one is
--    checked once and an unchanged one never again.
ALTER TABLE users ADD COLUMN avatar_checked_media_id uuid;
ALTER TABLE users ADD COLUMN cover_checked_media_id uuid;
CREATE INDEX users_photo_unchecked_idx ON users (id)
  WHERE (avatar_media_id IS NOT NULL AND avatar_checked_media_id IS DISTINCT FROM avatar_media_id)
     OR (cover_media_id IS NOT NULL AND cover_checked_media_id IS DISTINCT FROM cover_media_id);

-- Photos already on profiles count as checked: only new ones from now on are sent to the model.
UPDATE users SET avatar_checked_media_id = avatar_media_id, cover_checked_media_id = cover_media_id;
