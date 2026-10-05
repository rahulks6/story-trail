import { queryOne } from "../../db/psql";
import { HttpError } from "../../http/errors";
/** RESTRICTED: cannot publish, comment, or start a new DM conversation. Existing DMs remain usable. */
export async function assertCanContribute(userId: string): Promise<void> {
    const row = await queryOne(`SELECT moderation_state,is_active FROM users WHERE id=:'id' AND deleted_at IS NULL`, { id: userId });
    if (!row || row.is_active !== 't' || row.moderation_state !== 'ACTIVE')
        throw new HttpError(403, 'Your account cannot perform this action.');
}
