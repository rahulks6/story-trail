import { containsPattern } from "../../shared/validation";
import type { Router } from "../../http/router";
import { sendJson } from "../../http/respond";
import { HttpError } from "../../http/errors";
import { parsePagination, parseQueryString } from "../../http/pagination";
import { query } from "../../db/psql";
import { config } from "../../config/env";
import { body, password, text, uuid, integer, confirmation, permissions } from "./policy";
import { adminLogin, confirmEnrollment, cookie, enabled, hash, regenerateBackupCodes, reauthenticate, requireAdmin, resetAdminMfa, startEnrollment, verifyLoginMfa } from "./security";
import { rows, one, moderate, manageAdmin } from "./admin.service";
import { addNote, listAppeals, reportDetail, reportMessages, reviewAppeal } from "./moderation-admin";
import { parseReportStatus } from "../moderation/moderation.repository";
import { mediaStorage } from "../media/instance";
import { receiveUpload } from "../media/media.service";
import { findMediaById } from "../media/media.repository";
import { sendMediaFile } from "../media/delivery";
import { sendPage, sendUnversionedAsset, sendVersionedAsset } from "./console-assets";
/** "https://Evil.Example.com/path" → "evil.example.com"; anything that isn't a domain is refused. */
function linkDomain(value: unknown): string {
    const raw = text(value, 300).toLowerCase().replace(/^[a-z]+:\/\//, '').split(/[/?#:]/)[0]!.replace(/\.$/, '');
    if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(raw) || raw.length > 253) throw new HttpError(422, 'Enter a domain such as example.com.');
    return raw;
}
export function registerAdminRoutes(router: Router): void {
    // The console's pages and assets (console-assets.ts): a built, versioned console in production.
    router.get('/admin/login', async (_req, res) => { enabled(); await sendPage(res, 'login.html'); });
    router.get('/admin', async (req, res) => { enabled(); await requireAdmin(req); await sendPage(res, 'index.html'); });
    router.get('/admin/assets/:file', async (req, res) => { enabled(); sendVersionedAsset(req, res, req.params.file!); });
    router.get('/admin/app.js', async (req, res) => { enabled(); await sendUnversionedAsset(req, res, 'app.js'); });
    router.get('/admin/style.css', async (req, res) => { enabled(); await sendUnversionedAsset(req, res, 'style.css'); });
    // Password first; the Admin session cookie is only issued after the second factor.
    router.post('/api/v1/admin/login', async (req, res) => {
        const b = body(req.body);
        const result = await adminLogin(req, text(b.email, 254), password(b.password));
        res.setHeader('Cache-Control', 'no-store');
        if (result.kind === 'mfa') { sendJson(res, 200, { mfaRequired: true, challenge: result.challenge }); return; }
        if (result.kind === 'enroll') { sendJson(res, 200, { mfaEnrollmentRequired: true, challenge: result.challenge }); return; }
        res.setHeader('Set-Cookie', cookie(result.token));
        sendJson(res, 200, { principal: result.principal, csrf: result.csrf });
    });
    router.post('/api/v1/admin/login/mfa', async (req, res) => {
        const b = body(req.body);
        const session = await verifyLoginMfa(req, b.challenge, b.code, b.backupCode);
        res.setHeader('Cache-Control', 'no-store'); res.setHeader('Set-Cookie', cookie(session.token));
        sendJson(res, 200, { principal: session.principal, csrf: session.csrf });
    });
    router.post('/api/v1/admin/mfa/enroll', async (req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        sendJson(res, 200, await startEnrollment(req, body(req.body).challenge));
    });
    router.post('/api/v1/admin/mfa/enroll/confirm', async (req, res) => {
        const b = body(req.body);
        const session = await confirmEnrollment(req, b.challenge, b.code);
        res.setHeader('Cache-Control', 'no-store'); res.setHeader('Set-Cookie', cookie(session.token));
        sendJson(res, 200, { principal: session.principal, csrf: session.csrf, backupCodes: session.backupCodes });
    });
    router.post('/api/v1/admin/mfa/backup-codes', async (req, res) => {
        const p = await requireAdmin(req, undefined, false, true);
        confirmation(body(req.body).confirmed);
        res.setHeader('Cache-Control', 'no-store');
        sendJson(res, 200, { backupCodes: await regenerateBackupCodes(p) });
    });
    router.post('/api/v1/admin/admins/:id/mfa-reset', async (req, res) => {
        const p = await requireAdmin(req, 'admins.update', true, true);
        confirmation(body(req.body).confirmed);
        await resetAdminMfa(p, uuid(req.params.id));
        sendJson(res, 204, undefined);
    });
    router.get('/api/v1/admin/session', async (req, res) => { const p = await requireAdmin(req); sendJson(res, 200, { principal: { userId: p.userId, role: p.role, permissions: p.permissions, mfaVerified: p.mfaVerified ?? false }, permissions }); });
    // Step-up: password plus a current authenticator (or backup) code once MFA is set up.
    router.post('/api/v1/admin/reauthenticate', async (req, res) => { const p = await requireAdmin(req); const b = body(req.body); await reauthenticate(p, password(b.password), b.code); sendJson(res, 204, undefined); });
    router.post('/api/v1/admin/logout', async (req, res) => { const p = await requireAdmin(req); await query(`DELETE FROM admin_sessions WHERE token_hash=:'hash'`, { hash: p.sessionHash! }); res.setHeader('Set-Cookie', cookie('', 0)); sendJson(res, 204, undefined); });
    router.get('/api/v1/admin/dashboard', async (req, res) => { await requireAdmin(req, 'reports.read'); sendJson(res, 200, await one(`SELECT jsonb_build_object('queue',(SELECT count(*) FROM reports WHERE status IN ('OPEN','UNDER_REVIEW')),'highPriority',(SELECT count(*) FROM reports WHERE priority>=2 AND status IN ('OPEN','UNDER_REVIEW')),'appealsOpen',(SELECT count(*) FROM moderation_appeals WHERE status='OPEN'),'reportsToday',(SELECT count(*) FROM reports WHERE created_at>=date_trunc('day',now())),'resolvedToday',(SELECT count(*) FROM reports WHERE reviewed_at>=date_trunc('day',now())),'restricted',(SELECT count(*) FROM users WHERE moderation_state='RESTRICTED'),'pendingAds',(SELECT count(*) FROM ad_campaigns WHERE status='PENDING_REVIEW')) AS data`)); });
    router.get('/api/v1/admin/reports', async (req, res) => {
        await requireAdmin(req, 'reports.read');
        const q = parseQueryString(req.url ?? '');
        const page = parsePagination(q);
        // Status uses the lifecycle names (lowercase names from before Phase 4 still work); minPriority 0-3.
        // Empty or "all" lists every status (the console's search); no parameter means the open queue.
        const status = q.status === '' || q.status === 'all' ? '' : parseReportStatus(q.status);
        if (status === null) throw new HttpError(422, 'Invalid status filter.');
        const minPriority = q.minPriority ? Number(q.minPriority) : 0;
        if (!Number.isInteger(minPriority) || minPriority < 0 || minPriority > 3) throw new HttpError(422, 'Invalid priority filter.');
        sendJson(res, 200, { items: await rows(`SELECT to_jsonb(r) AS data FROM reports r WHERE (:'status'='' OR r.status=:'status') AND r.priority >= :'minPriority'::integer AND (:'type'='' OR r.target_type=:'type') AND (:'reason'='' OR r.reason=:'reason') AND (:'search'='' OR r.id::text=:'search' OR r.target_id::text=:'search') ORDER BY priority DESC,created_at ASC LIMIT :'limit' OFFSET :'offset'`, { ...page, status, minPriority, type: q.type ?? '', reason: q.reason ?? '', search: (q.search ?? '').slice(0, 120) }), ...page });
    });
    router.get('/api/v1/admin/reports/:id', async (req, res) => { const p = await requireAdmin(req, 'reports.read'); sendJson(res, 200, await reportDetail(p, req.params.id!)); });
    router.post('/api/v1/admin/reports/:id/notes', async (req, res) => { const p = await requireAdmin(req, 'reports.review'); sendJson(res, 201, { note: await addNote(p, req.params.id!, body(req.body)) }); });
    // Reporter-attached DM evidence only; permission-gated and audited (see moderation-admin.ts).
    router.get('/api/v1/admin/reports/:id/messages', async (req, res) => { const p = await requireAdmin(req, 'reports.messages.read'); res.setHeader('Cache-Control', 'no-store'); sendJson(res, 200, { items: await reportMessages(p, req.params.id!) }); });
    router.post('/api/v1/admin/reports/:id/claim', async (req, res) => { const p = await requireAdmin(req, 'reports.review'); const b = body(req.body); confirmation(b.confirmed); const result = await one(`WITH r AS(UPDATE reports SET status='UNDER_REVIEW',version=version+1,updated_at=now(),reviewed_by=:'actor' WHERE id=:'id' AND status='OPEN' AND version=:'version' RETURNING *),audit AS(INSERT INTO admin_audit(actor_id,action,target_id) SELECT :'actor','REPORT_UNDER_REVIEW',id FROM r) SELECT to_jsonb(r) AS data FROM r`, { id: uuid(req.params.id), actor: p.userId, version: integer(b.version, 1, 2147483647) }); if (!result)
        throw new HttpError(409, 'Report already claimed or resolved. Refresh state.'); sendJson(res, 200, result); });
    router.post('/api/v1/admin/moderate', async (req, res) => { const p = await requireAdmin(req, undefined, false, true); sendJson(res, 200, await moderate(p, body(req.body))); });
    router.get('/api/v1/admin/users', async (req, res) => { await requireAdmin(req, 'users.view'); const q = parseQueryString(req.url ?? ''); const page = parsePagination(q); sendJson(res, 200, { items: await rows(`SELECT jsonb_build_object('id',id,'username',username,'displayName',display_name,'state',moderation_state,'active',is_active) AS data FROM users WHERE deleted_at IS NULL AND (username::text ILIKE :'pattern' OR id::text=:'search') ORDER BY username LIMIT :'limit' OFFSET :'offset'`, { ...page, pattern: containsPattern((q.search ?? '').slice(0, 100)), search: (q.search ?? '').slice(0, 100) }), ...page }); });
    router.get('/api/v1/admin/history', async (req, res) => { await requireAdmin(req, 'moderation.history.read'); const q = parseQueryString(req.url ?? ''); const page = parsePagination(q); sendJson(res, 200, { items: await rows(`SELECT to_jsonb(a) AS data FROM moderation_actions a WHERE (:'target'='' OR target_id::text=:'target') ORDER BY created_at DESC LIMIT :'limit' OFFSET :'offset'`, { ...page, target: q.target ?? '' }), ...page }); });
    // Filterable by action (prefix match, e.g. MODERATION_), actor, target and time range.
    router.get('/api/v1/admin/audit', async (req, res) => {
        await requireAdmin(req, 'audit.read');
        const q = parseQueryString(req.url ?? ''); const page = parsePagination(q);
        const optionalUuid = (v: string | undefined) => (v ? uuid(v) : '');
        const optionalTime = (v: string | undefined) => { if (!v) return ''; const t = new Date(v); if (!Number.isFinite(t.getTime())) throw new HttpError(422, 'Invalid date filter.'); return t.toISOString(); };
        const action = (q.action ?? '').toUpperCase();
        if (action && !/^[A-Z_]{2,60}$/.test(action)) throw new HttpError(422, 'Invalid action filter.');
        sendJson(res, 200, { items: await rows(`SELECT to_jsonb(a) - 'prev_hash' AS data FROM admin_audit a
          WHERE (:'action' = '' OR a.action LIKE :'action' || '%') AND (:'actor' = '' OR a.actor_id = NULLIF(:'actor','')::uuid)
            AND (:'target' = '' OR a.target_id = NULLIF(:'target','')::uuid)
            AND (:'from' = '' OR a.created_at >= NULLIF(:'from','')::timestamptz) AND (:'to' = '' OR a.created_at < NULLIF(:'to','')::timestamptz)
          ORDER BY a.created_at DESC, a.chain_seq DESC LIMIT :'limit' OFFSET :'offset'`,
          { ...page, action, actor: optionalUuid(q.actor), target: optionalUuid(q.target), from: optionalTime(q.from), to: optionalTime(q.to) }), ...page });
    });
    // Recomputes the audit hash chain. Record headHash externally (e.g. daily) to also detect removal of the newest rows.
    router.get('/api/v1/admin/audit/verify', async (req, res) => {
        await requireAdmin(req, 'audit.read');
        const broken = await one(`SELECT to_jsonb(v) AS data FROM verify_admin_audit_chain() v LIMIT 1`);
        const head = await one(`SELECT jsonb_build_object('rows', (SELECT count(*) FROM admin_audit), 'headSeq', chain_seq, 'headHash', row_hash) AS data FROM admin_audit ORDER BY chain_seq DESC NULLS LAST LIMIT 1`);
        sendJson(res, 200, { intact: broken === null, firstProblem: broken, ...(head ?? { rows: 0, headSeq: null, headHash: null }) });
    });
    router.get('/api/v1/admin/security-alerts', async (req, res) => {
        await requireAdmin(req, 'security.alerts.read');
        const q = parseQueryString(req.url ?? ''); const page = parsePagination(q);
        sendJson(res, 200, { items: await rows(`SELECT to_jsonb(s) AS data FROM security_alerts s WHERE (:'open' <> 'true' OR s.acknowledged_at IS NULL) ORDER BY s.created_at DESC LIMIT :'limit' OFFSET :'offset'`, { ...page, open: q.open ?? 'true' }), ...page });
    });
    router.post('/api/v1/admin/security-alerts/:id/acknowledge', async (req, res) => {
        const p = await requireAdmin(req, 'security.alerts.read');
        confirmation(body(req.body).confirmed);
        const result = await one(`WITH a AS (UPDATE security_alerts SET acknowledged_by = :'actor', acknowledged_at = now() WHERE id = :'id' AND acknowledged_at IS NULL RETURNING *), audit AS (INSERT INTO admin_audit(actor_id, action, target_id, metadata) SELECT :'actor', 'SECURITY_ALERT_ACKNOWLEDGED', id, jsonb_build_object('kind', kind) FROM a) SELECT to_jsonb(a) AS data FROM a`, { id: uuid(req.params.id), actor: p.userId });
        if (!result) throw new HttpError(409, 'Alert not found or already acknowledged.');
        sendJson(res, 200, result);
    });
    router.get('/api/v1/admin/admins', async (req, res) => { await requireAdmin(req, 'admins.read', true); const page = parsePagination(parseQueryString(req.url ?? '')); sendJson(res, 200, { items: await rows(`SELECT jsonb_build_object('userId',g.user_id,'username',u.username,'role',g.role,'permissions',g.permissions,'enabled',g.enabled,'version',g.version) AS data FROM admin_grants g JOIN users u ON u.id=g.user_id ORDER BY g.created_at DESC LIMIT :'limit' OFFSET :'offset'`, { ...page }), ...page }); });
    router.post('/api/v1/admin/admins', async (req, res) => { const p = await requireAdmin(req, 'admins.create', true, true); sendJson(res, 200, await manageAdmin(p, body(req.body))); });
    // Link safety: domains nobody can link to (src/modules/safety/links.ts). Every change is audited.
    router.get('/api/v1/admin/safety/blocked-domains', async (req, res) => { await requireAdmin(req, 'safety.settings.manage'); const page = parsePagination(parseQueryString(req.url ?? '')); sendJson(res, 200, { items: await rows(`SELECT jsonb_build_object('domain',d.domain,'reason',d.reason,'createdAt',d.created_at,'by',u.username) AS data FROM blocked_link_domains d LEFT JOIN users u ON u.id=d.created_by ORDER BY d.created_at DESC LIMIT :'limit' OFFSET :'offset'`, { ...page }), ...page }); });
    router.post('/api/v1/admin/safety/blocked-domains', async (req, res) => { const p = await requireAdmin(req, 'safety.settings.manage', false, true); const b = body(req.body); confirmation(b.confirmed); const domain = linkDomain(b.domain); const result = await one(`WITH d AS (INSERT INTO blocked_link_domains (domain, reason, created_by) VALUES (:'domain', :'reason', :'actor') ON CONFLICT (domain) DO NOTHING RETURNING *), audit AS (INSERT INTO admin_audit (actor_id, action, metadata) SELECT :'actor', 'LINK_DOMAIN_BLOCKED', jsonb_build_object('domain', domain, 'reason', reason) FROM d) SELECT jsonb_build_object('domain', domain) AS data FROM d`, { domain, reason: text(b.reason, 300), actor: p.userId }); if (!result) throw new HttpError(409, 'That domain is already blocked.'); sendJson(res, 201, result); });
    router.post('/api/v1/admin/safety/blocked-domains/remove', async (req, res) => { const p = await requireAdmin(req, 'safety.settings.manage', false, true); const b = body(req.body); confirmation(b.confirmed); const domain = linkDomain(b.domain); const result = await one(`WITH d AS (DELETE FROM blocked_link_domains WHERE domain = :'domain' RETURNING *), audit AS (INSERT INTO admin_audit (actor_id, action, metadata) SELECT :'actor', 'LINK_DOMAIN_UNBLOCKED', jsonb_build_object('domain', domain) FROM d) SELECT jsonb_build_object('domain', domain) AS data FROM d`, { domain, actor: p.userId }); if (!result) throw new HttpError(404, 'That domain is not blocked.'); sendJson(res, 200, result); });
    router.get('/api/v1/admin/appeals', async (req, res) => { const p = await requireAdmin(req, 'reports.review'); const q = parseQueryString(req.url ?? ''); const page = parsePagination(q); sendJson(res, 200, { items: await listAppeals(p, q.status ?? 'OPEN', page.limit, page.offset), ...page }); });
    // UPHELD reverses the action (needs the matching restore permission); DENIED keeps it. Both close the report.
    router.post('/api/v1/admin/appeals/:id', async (req, res) => { const p = await requireAdmin(req, 'reports.review', false, true); sendJson(res, 200, await reviewAppeal(p, req.params.id!, body(req.body))); });
    router.post('/api/v1/admin/media/:kind', async (req, res) => { const p = await requireAdmin(req, 'ads.create'); const kind = req.params.kind; if (kind !== 'photo' && kind !== 'video')
        throw new HttpError(422, 'Invalid media kind.'); const media = await receiveUpload(req, p.userId, kind, mediaStorage); sendJson(res, 201, { media: { id: media.id, kind: media.kind, status: media.status, processingError: media.processingError } }); }, { rawBody: true });
    // Videos are processed after upload; the console polls this before creating a campaign.
    router.get('/api/v1/admin/media/:id', async (req, res) => { const p = await requireAdmin(req, 'ads.create'); const media = await findMediaById(uuid(req.params.id)); if (!media || media.ownerId !== p.userId)
        throw new HttpError(404, 'Media not found.'); sendJson(res, 200, { media: { id: media.id, kind: media.kind, status: media.status, processingError: media.processingError } }); });
    router.get('/api/v1/admin/evidence/:reportId', async (req, res) => { await requireAdmin(req, 'reports.read'); const row = await one(`SELECT jsonb_build_object('mediaId',CASE r.target_type WHEN 'story' THEN s.media_id ELSE c.media_id END) AS data FROM reports r LEFT JOIN stories s ON r.target_type='story' AND s.id=r.target_id LEFT JOIN ad_creatives c ON r.target_type='ad' AND c.id=r.target_id WHERE r.id=:'id'`, { id: uuid(req.params.reportId) }); if (!row?.mediaId)
        throw new HttpError(404, 'Evidence unavailable.'); const media = await findMediaById(String(row.mediaId)); if (!media)
        throw new HttpError(404, 'Evidence unavailable.'); await sendMediaFile(req, res, media, null, false, mediaStorage, { redirect: false }); });
}
