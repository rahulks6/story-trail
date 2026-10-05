import { query, queryOne, DatabaseError, type SqlParams } from "../../db/psql";
import { HttpError } from "../../http/errors";
import { authorize, confirmation, integer, permissions, text, uuid, type Principal } from "./policy";
export async function rows(sql: string, params: SqlParams = {}) { return (await query(sql, params)).map(r => JSON.parse(r.data as string) as Record<string, unknown>); }
export async function one(sql: string, params: SqlParams = {}) { const r = await queryOne(sql, params); return r ? JSON.parse(r.data as string) as Record<string, unknown> : null; }
export async function moderate(p: Principal, input: Record<string, unknown>) {
    const action = text(input.action, 30);
    const permission = action === 'keep' ? 'reports.review' : action === 'remove' ? 'content.remove' : action === 'restore' ? 'content.restore' : action === 'suspend' ? 'users.suspend' : 'users.restrict';
    authorize(p, permission);
    if (input.reportId)
        authorize(p, 'reports.review');
    confirmation(input.confirmed);
    const reason = text(input.reason, 500);
    if (!['keep', 'remove', 'restore', 'restrict', 'suspend', 'restore_account'].includes(action))
        throw new HttpError(422, 'Invalid action.');
    if (action === 'restore_account')
        authorize(p, 'users.suspend');
    try {
        return await one(`SELECT admin_moderate(:'actor'::uuid,NULLIF(:'report','')::uuid,:'version'::integer,:'type',NULLIF(:'target','')::uuid,:'action',:'reason') AS data`, {
            actor: p.userId, report: input.reportId ? uuid(input.reportId) : '', version: input.reportId ? integer(input.version, 1, 2147483647) : 0,
            type: input.targetType ? text(input.targetType, 20) : '', target: input.targetId ? uuid(input.targetId) : '', action, reason
        });
    }
    catch (e) {
        if (e instanceof DatabaseError) {
            console.warn(JSON.stringify({ event: 'moderation_action_failed', actor: p.userId, action }));
            if (e.detail.includes('CONFLICT'))
                throw new HttpError(409, 'This report or content was already resolved by another moderator. Refresh state.');
            if (/NOT_FOUND|INVALID_|PROTECTED_TARGET|RESTORE_NOT_ALLOWED/.test(e.detail))
                throw new HttpError(422, 'This moderation action is not allowed for the target.');
        }
        throw e;
    }
}
export async function manageAdmin(p: Principal, b: Record<string, unknown>) {
    const target = uuid(b.userId);
    const enabled = b.enabled !== false;
    authorize(p, enabled ? 'admins.update' : 'admins.disable', true);
    confirmation(b.confirmed);
    if (target === p.userId)
        throw new HttpError(403, 'You cannot change your own access.');
    if (b.role !== undefined && b.role !== 'ADMIN')
        throw new HttpError(403, 'Super Admin promotion is not available through this API.');
    if (!Array.isArray(b.permissions) || b.permissions.some(v => typeof v !== 'string' || !permissions.includes(v as typeof permissions[number])))
        throw new HttpError(422, 'Invalid permissions.');
    const version = integer(b.version ?? 0, 0, 2147483647);
    const result = await one(`WITH target AS (SELECT id FROM users WHERE id=:'target' AND deleted_at IS NULL AND is_active FOR UPDATE), changed AS (
 INSERT INTO admin_grants(user_id,role,permissions,enabled) SELECT id,'ADMIN',:'permissions'::jsonb,:'enabled'::boolean FROM target WHERE :'version'::integer=0
 ON CONFLICT(user_id) DO NOTHING RETURNING *), updated AS (
 UPDATE admin_grants SET permissions=:'permissions'::jsonb,enabled=:'enabled'::boolean,version=version+1,updated_at=now()
 WHERE user_id=:'target' AND user_id IN(SELECT id FROM target) AND role='ADMIN' AND version=:'version'::integer RETURNING *), changed_all AS (SELECT * FROM changed UNION ALL SELECT * FROM updated), revoked AS (
 DELETE FROM admin_sessions WHERE user_id IN(SELECT user_id FROM changed_all) RETURNING user_id), audit AS (
 INSERT INTO admin_audit(actor_id,action,target_id,metadata) SELECT :'actor','ADMIN_ACCESS_CHANGED',user_id,jsonb_build_object('permissions',permissions,'enabled',enabled,'version',version) FROM changed_all RETURNING id)
 SELECT to_jsonb(c) AS data FROM changed_all c`, { target, actor: p.userId, permissions: JSON.stringify(b.permissions), enabled, version });
    if (!result)
        throw new HttpError(409, 'Account unavailable, protected, or changed. Refresh before retrying.');
    return result;
}
