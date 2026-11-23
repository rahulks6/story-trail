/**
 * A person's check on the automatic moderation (stories/story-ai.ts, stories/photo-check.ts): the
 * Stories and profile photos it removed and the accounts it suspended, each with a View of what
 * was removed (only for admins who can read reports, and written to the audit log every time)
 * and, for a Story the check got wrong, Restore: the Story comes back and, if the account was
 * suspended automatically, so does the account. A removed photo can't be put back; its owner can
 * upload it again.
 */
import { DatabaseError } from "../../db/psql";
import { HttpError } from "../../http/errors";
import { authorize, confirmation, text, uuid, type Principal } from "./policy";
import { one, rows } from "./admin.service";

/** Newest first: every action the automatic check took, with what an admin needs to judge it. */
export async function listAutomaticActions(limit: number, offset: number): Promise<Record<string, unknown>[]> {
  return rows(
    `SELECT jsonb_build_object(
       'id', a.id, 'createdAt', a.created_at, 'action', a.action, 'targetType', a.target_type, 'reason', a.reason,
       'owner', jsonb_build_object('id', u.id, 'username', u.username, 'displayName', u.display_name,
                                   'state', u.moderation_state, 'joinedAt', u.created_at, 'deleted', u.deleted_at IS NOT NULL),
       'media', CASE WHEN a.target_type = 'story' THEN (SELECT m.kind FROM media m WHERE m.id = s.media_id)
                     WHEN a.action IN ('remove_profile_photo', 'remove_cover_photo') THEN 'photo' END,
       'restored', CASE WHEN a.target_type = 'story' THEN s.moderation_removed_at IS NULL
                        WHEN a.action = 'suspend' THEN u.moderation_state = 'ACTIVE' ELSE false END,
       'restorable', a.target_type = 'story' AND s.moderation_removed_at IS NOT NULL AND u.deleted_at IS NULL
                     OR a.action = 'suspend' AND u.moderation_state = 'SUSPENDED' AND u.deleted_at IS NULL) AS data
     FROM moderation_actions a
     LEFT JOIN stories s ON a.target_type = 'story' AND s.id = a.target_id
     JOIN users u ON u.id = CASE WHEN a.target_type = 'story' THEN s.owner_id ELSE a.target_id END
     WHERE a.actor_id IS NULL AND a.target_type IN ('story', 'user')
     ORDER BY a.created_at DESC LIMIT :'limit' OFFSET :'offset'`,
    { limit, offset },
  );
}

/** What an automatic action removed, for View: its media id. Each view is audit-logged. */
export async function automaticActionMedia(p: Principal, actionId: string): Promise<string> {
  authorize(p, "reports.read");
  const id = uuid(actionId);
  const row = await one(
    `SELECT jsonb_build_object('mediaId', CASE WHEN a.target_type = 'story' THEN s.media_id::text ELSE a.previous_state->>'media_id' END,
                               'target', a.target_id) AS data
     FROM moderation_actions a LEFT JOIN stories s ON a.target_type = 'story' AND s.id = a.target_id
     WHERE a.id = :'id' AND a.actor_id IS NULL`,
    { id },
  );
  if (!row?.mediaId) throw new HttpError(404, "Nothing to show for this action.");
  await rows(
    `INSERT INTO admin_audit (actor_id, action, target_id, metadata) VALUES (:'actor', 'AUTOMATIC_REMOVAL_VIEWED', :'target', jsonb_build_object('actionId', :'id'::text))
     RETURNING jsonb_build_object('ok', true) AS data`,
    { actor: p.userId, target: String(row.target), id },
  );
  return String(row.mediaId);
}

/**
 * Undoes an automatic action the check got wrong: a removed Story comes back (content.restore),
 * and an account it suspended is active again (users.suspend). Restoring a Story also restores
 * its owner when the suspension was automatic, since the account can't hold a Story otherwise.
 * Recorded like any admin decision: moderation history, audit log and a notice to the owner.
 */
export async function restoreAutomaticAction(p: Principal, actionId: string, input: Record<string, unknown>): Promise<Record<string, unknown>> {
  confirmation(input.confirmed);
  const reason = typeof input.reason === "string" && input.reason.trim() ? text(input.reason, 500) : "Restored after review: the automatic check was wrong.";
  const id = uuid(actionId);
  const action = await one(
    `SELECT jsonb_build_object('action', a.action, 'targetType', a.target_type, 'target', a.target_id,
       'owner', CASE WHEN a.target_type = 'story' THEN s.owner_id ELSE a.target_id END,
       'suspendedAutomatically', EXISTS (
         SELECT 1 FROM users u WHERE u.id = CASE WHEN a.target_type = 'story' THEN s.owner_id ELSE a.target_id END
           AND u.moderation_state = 'SUSPENDED'
           AND (SELECT x.actor_id IS NULL FROM moderation_actions x
                WHERE x.target_type = 'user' AND x.target_id = u.id AND x.action = 'suspend' ORDER BY x.created_at DESC LIMIT 1))) AS data
     FROM moderation_actions a LEFT JOIN stories s ON a.target_type = 'story' AND s.id = a.target_id
     WHERE a.id = :'id' AND a.actor_id IS NULL`,
    { id },
  );
  if (!action) throw new HttpError(404, "Automatic action not found.");
  const isStory = action.action === "remove" && action.targetType === "story";
  const isSuspension = action.action === "suspend" && action.targetType === "user";
  if (!isStory && !isSuspension) throw new HttpError(422, "Only a removed Story or a suspension can be restored here.");
  if (isStory) authorize(p, "content.restore");
  if (isSuspension || action.suspendedAutomatically === true) authorize(p, "users.suspend");
  const moderate = (type: string, target: string, act: string) =>
    one(`SELECT admin_moderate(:'actor'::uuid, NULL, NULL, :'type', :'target'::uuid, :'action', :'reason') AS data`, { actor: p.userId, type, target, action: act, reason });
  const done: string[] = [];
  try {
    if (isSuspension || action.suspendedAutomatically === true) {
      await moderate("user", String(action.owner), "restore_account");
      done.push("account");
    }
    if (isStory) {
      await moderate("story", String(action.target), "restore");
      done.push("story");
    }
  } catch (error) {
    if (error instanceof DatabaseError) {
      if (error.detail.includes("RESTORE_NOT_ALLOWED") || error.detail.includes("CONFLICT")) throw new HttpError(409, "Already restored, or the account can't be restored. Refresh.");
      if (error.detail.includes("PROTECTED_TARGET")) throw new HttpError(403, "This account can't be changed here.");
    }
    throw error;
  }
  return { restored: done };
}
