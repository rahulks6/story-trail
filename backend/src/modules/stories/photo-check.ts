import { query } from "../../db/psql";
import * as mediaRepo from "../media/media.repository";
import type { ObjectStore } from "../media/storage";
import { pictureOf, type StoryAiClient } from "./story-ai";

/**
 * Profile and cover photos get the same automatic check as Stories (story-ai.ts): a new photo is
 * looked at once, and one showing nudity or sexual content is taken off the profile at once. The
 * owner gets a notice (moderation_notices) and can choose another photo. Photos on profiles before
 * migration 0082 count as checked.
 */
export const PHOTO_REMOVAL_REASON = "Automatic check: nudity or sexual content in a profile photo";

type Slot = "avatar" | "cover";
const COLUMN: Record<Slot, { media: string; checked: string }> = {
  avatar: { media: "avatar_media_id", checked: "avatar_checked_media_id" },
  cover: { media: "cover_media_id", checked: "cover_checked_media_id" },
};

interface PendingPhoto {
  userId: string;
  slot: Slot;
  mediaId: string;
}

/** Up to `limit` photos not looked at yet, each marked as looked at so no other worker takes it. */
export async function claimPhotos(limit: number, only?: readonly string[]): Promise<PendingPhoto[]> {
  const rows = await query(
    `WITH pick AS (
       SELECT id, avatar_media_id, cover_media_id,
              (avatar_media_id IS NOT NULL AND avatar_checked_media_id IS DISTINCT FROM avatar_media_id) AS avatar_new,
              (cover_media_id IS NOT NULL AND cover_checked_media_id IS DISTINCT FROM cover_media_id) AS cover_new
       FROM users
       WHERE deleted_at IS NULL
         AND ((avatar_media_id IS NOT NULL AND avatar_checked_media_id IS DISTINCT FROM avatar_media_id)
           OR (cover_media_id IS NOT NULL AND cover_checked_media_id IS DISTINCT FROM cover_media_id))
         AND (cardinality(:'only'::uuid[]) = 0 OR id = ANY (:'only'::uuid[]))
       LIMIT :'limit' FOR UPDATE SKIP LOCKED),
     marked AS (
       UPDATE users u SET avatar_checked_media_id = u.avatar_media_id, cover_checked_media_id = u.cover_media_id
       FROM pick WHERE u.id = pick.id RETURNING u.id)
     SELECT pick.* FROM pick JOIN marked ON marked.id = pick.id`,
    { limit, only: `{${(only ?? []).join(",")}}` },
  );
  const photos: PendingPhoto[] = [];
  for (const row of rows) {
    if (row.avatar_new === "t") photos.push({ userId: row.id as string, slot: "avatar", mediaId: row.avatar_media_id as string });
    if (row.cover_new === "t") photos.push({ userId: row.id as string, slot: "cover", mediaId: row.cover_media_id as string });
  }
  return photos;
}

/** Takes the photo off the profile (if it's still the one there) and tells the owner. */
export async function removePhoto(photo: PendingPhoto): Promise<boolean> {
  const column = COLUMN[photo.slot].media;
  const rows = await query(
    `WITH removed AS (
       UPDATE users SET ${column} = NULL WHERE id = :'user' AND ${column} = :'media' RETURNING id),
     action AS (
       INSERT INTO moderation_actions (report_id, actor_id, target_type, target_id, action, reason, previous_state, new_state)
       SELECT NULL, NULL, 'user', id, :'action', :'reason', jsonb_build_object('media_id', :'media'::text), jsonb_build_object('state', 'PHOTO_REMOVED')
       FROM removed RETURNING id)
     INSERT INTO moderation_notices (user_id, action_id) SELECT :'user', id FROM action RETURNING user_id`,
    { user: photo.userId, media: photo.mediaId, action: photo.slot === "avatar" ? "remove_profile_photo" : "remove_cover_photo", reason: PHOTO_REMOVAL_REASON },
  );
  return rows.length > 0;
}

/** A photo the check couldn't do this time is let go round again. */
async function releasePhoto(photo: PendingPhoto): Promise<void> {
  const { checked, media } = COLUMN[photo.slot];
  await query(`UPDATE users SET ${checked} = NULL WHERE id = :'user' AND ${media} = :'media'`, { user: photo.userId, media: photo.mediaId });
}

/** One round: the next few new photos looked at; those showing nudity or sexual content removed. */
export async function checkPhotos(ai: StoryAiClient, store: ObjectStore, limit: number, only?: readonly string[]): Promise<{ checked: number; removed: number }> {
  const result = { checked: 0, removed: 0 };
  for (const photo of await claimPhotos(limit, only)) {
    const media = await mediaRepo.findMediaById(photo.mediaId);
    const image = media ? await pictureOf(media, store) : null;
    if (!image) continue;
    try {
      const seen = await ai.understand({ image, caption: "", words: [], song: null, festival: null });
      result.checked++;
      if (seen !== "refused" && seen.safety === "sexual" && (await removePhoto(photo))) result.removed++;
    } catch {
      await releasePhoto(photo);
      break; // the API is busy or down: the rest wait for the next round
    }
  }
  return result;
}
