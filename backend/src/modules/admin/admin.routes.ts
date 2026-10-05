import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { Router } from "../../http/router";
import { sendJson } from "../../http/respond";
import { HttpError } from "../../http/errors";
import { parsePagination, parseQueryString } from "../../http/pagination";
import { query } from "../../db/psql";
import { config } from "../../config/env";
import { body, password, text, uuid, integer, confirmation, permissions } from "./policy";
import { adminLogin, cookie, enabled, hash, requireAdmin, reauthenticate } from "./security";
import { rows, one, moderate, manageAdmin } from "./admin.service";
import { mediaStorage } from "../media/instance";
import { receiveUpload } from "../media/media.service";
import { findMediaById } from "../media/media.repository";
export function registerAdminRoutes(router: Router): void {
    for (const [url, file, mime] of [['/admin/login', 'login.html', 'text/html'], ['/admin', 'index.html', 'text/html'], ['/admin/app.js', 'app.js', 'text/javascript'], ['/admin/style.css', 'style.css', 'text/css']]) {
        router.get(url!, async (req, res) => { enabled(); if (url === '/admin')
            await requireAdmin(req); res.setHeader('Cache-Control', 'no-store'); res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob:; media-src 'self' blob:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"); res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Content-Type', mime!); res.end(await fs.readFile(path.join(config.admin.staticRoot, file!))); });
    }
    router.post('/api/v1/admin/login', async (req, res) => { const b = body(req.body); const result = await adminLogin(req, text(b.email, 254), password(b.password)); res.setHeader('Set-Cookie', cookie(result.token)); res.setHeader('Cache-Control', 'no-store'); sendJson(res, 200, { principal: result.principal, csrf: result.csrf }); });
    router.get('/api/v1/admin/session', async (req, res) => { const p = await requireAdmin(req); sendJson(res, 200, { principal: { userId: p.userId, role: p.role, permissions: p.permissions }, permissions }); });
    router.post('/api/v1/admin/reauthenticate', async (req, res) => { const p = await requireAdmin(req); await reauthenticate(p, password(body(req.body).password)); sendJson(res, 204, undefined); });
    router.post('/api/v1/admin/logout', async (req, res) => { const p = await requireAdmin(req); await query(`DELETE FROM admin_sessions WHERE token_hash=:'hash'`, { hash: p.sessionHash! }); res.setHeader('Set-Cookie', cookie('', 0)); sendJson(res, 204, undefined); });
    router.get('/api/v1/admin/dashboard', async (req, res) => { await requireAdmin(req, 'reports.read'); sendJson(res, 200, await one(`SELECT jsonb_build_object('queue',(SELECT count(*) FROM reports WHERE status IN ('pending','under_review')),'highPriority',(SELECT count(*) FROM reports WHERE priority>=2 AND status IN ('pending','under_review')),'reportsToday',(SELECT count(*) FROM reports WHERE created_at>=date_trunc('day',now())),'resolvedToday',(SELECT count(*) FROM reports WHERE reviewed_at>=date_trunc('day',now())),'restricted',(SELECT count(*) FROM users WHERE moderation_state='RESTRICTED'),'pendingAds',(SELECT count(*) FROM ad_campaigns WHERE status='PENDING_REVIEW')) AS data`)); });
    router.get('/api/v1/admin/reports', async (req, res) => {
        await requireAdmin(req, 'reports.read');
        const q = parseQueryString(req.url ?? '');
        const page = parsePagination(q);
        sendJson(res, 200, { items: await rows(`SELECT to_jsonb(r) AS data FROM reports r WHERE (:'status'='' OR r.status=:'status') AND (:'type'='' OR r.target_type=:'type') AND (:'reason'='' OR r.reason=:'reason') AND (:'search'='' OR r.id::text=:'search' OR r.target_id::text=:'search') ORDER BY priority DESC,created_at ASC LIMIT :'limit' OFFSET :'offset'`, { ...page, status: q.status ?? 'pending', type: q.type ?? '', reason: q.reason ?? '', search: (q.search ?? '').slice(0, 120) }), ...page });
    });
    router.get('/api/v1/admin/reports/:id', async (req, res) => {
        await requireAdmin(req, 'reports.read');
        const id = uuid(req.params.id);
        const report = await one(`SELECT to_jsonb(r) AS data FROM reports r WHERE id=:'id'`, { id });
        if (!report)
            throw new HttpError(404, 'Report not found.');
        const target = await one(`SELECT data FROM (
 SELECT 'story' AS type,s.id,jsonb_build_object('id',s.id,'username',u.username,'caption',s.caption,'mediaId',s.media_id,'deleted',s.deleted_at IS NOT NULL) AS data FROM stories s JOIN users u ON u.id=s.owner_id
 UNION ALL SELECT 'comment',c.id,jsonb_build_object('id',c.id,'username',u.username,'body',c.body,'deleted',c.deleted_at IS NOT NULL) FROM story_comments c JOIN users u ON u.id=c.user_id
 UNION ALL SELECT 'user',u.id,jsonb_build_object('id',u.id,'username',u.username,'bio',u.bio,'state',u.moderation_state) FROM users u
 UNION ALL SELECT 'ad',c.id,jsonb_build_object('id',c.id,'caption',c.caption,'mediaId',c.media_id,'destination',c.destination,'state',c.review_status) FROM ad_creatives c
 ) targets WHERE type=:'type' AND id=:'target'`, { type: String(report.target_type), target: String(report.target_id) });
        const counts = await one(`SELECT jsonb_build_object('count',count(*)) AS data FROM reports WHERE target_type=:'type' AND target_id=:'target'`, { type: String(report.target_type), target: String(report.target_id) });
        sendJson(res, 200, { report, target, counts });
    });
    router.post('/api/v1/admin/reports/:id/claim', async (req, res) => { const p = await requireAdmin(req, 'reports.review'); const b = body(req.body); confirmation(b.confirmed); const result = await one(`WITH r AS(UPDATE reports SET status='under_review',version=version+1,updated_at=now(),reviewed_by=:'actor' WHERE id=:'id' AND status='pending' AND version=:'version' RETURNING *),audit AS(INSERT INTO admin_audit(actor_id,action,target_id) SELECT :'actor','REPORT_UNDER_REVIEW',id FROM r) SELECT to_jsonb(r) AS data FROM r`, { id: uuid(req.params.id), actor: p.userId, version: integer(b.version, 1, 2147483647) }); if (!result)
        throw new HttpError(409, 'Report already claimed or resolved. Refresh state.'); sendJson(res, 200, result); });
    router.post('/api/v1/admin/moderate', async (req, res) => { const p = await requireAdmin(req, undefined, false, true); sendJson(res, 200, await moderate(p, body(req.body))); });
    router.get('/api/v1/admin/users', async (req, res) => { await requireAdmin(req, 'users.view'); const q = parseQueryString(req.url ?? ''); const page = parsePagination(q); sendJson(res, 200, { items: await rows(`SELECT jsonb_build_object('id',id,'username',username,'displayName',display_name,'state',moderation_state,'active',is_active) AS data FROM users WHERE deleted_at IS NULL AND (username::text ILIKE :'pattern' OR id::text=:'search') ORDER BY username LIMIT :'limit' OFFSET :'offset'`, { ...page, pattern: `%${(q.search ?? '').slice(0, 100)}%`, search: (q.search ?? '').slice(0, 100) }), ...page }); });
    router.get('/api/v1/admin/history', async (req, res) => { await requireAdmin(req, 'moderation.history.read'); const q = parseQueryString(req.url ?? ''); const page = parsePagination(q); sendJson(res, 200, { items: await rows(`SELECT to_jsonb(a) AS data FROM moderation_actions a WHERE (:'target'='' OR target_id::text=:'target') ORDER BY created_at DESC LIMIT :'limit' OFFSET :'offset'`, { ...page, target: q.target ?? '' }), ...page }); });
    router.get('/api/v1/admin/audit', async (req, res) => { await requireAdmin(req, 'audit.read'); const page = parsePagination(parseQueryString(req.url ?? '')); sendJson(res, 200, { items: await rows(`SELECT to_jsonb(a) AS data FROM admin_audit a ORDER BY created_at DESC LIMIT :'limit' OFFSET :'offset'`, { ...page }), ...page }); });
    router.get('/api/v1/admin/admins', async (req, res) => { await requireAdmin(req, 'admins.read', true); const page = parsePagination(parseQueryString(req.url ?? '')); sendJson(res, 200, { items: await rows(`SELECT jsonb_build_object('userId',g.user_id,'username',u.username,'role',g.role,'permissions',g.permissions,'enabled',g.enabled,'version',g.version) AS data FROM admin_grants g JOIN users u ON u.id=g.user_id ORDER BY g.created_at DESC LIMIT :'limit' OFFSET :'offset'`, { ...page }), ...page }); });
    router.post('/api/v1/admin/admins', async (req, res) => { const p = await requireAdmin(req, 'admins.create', true, true); sendJson(res, 200, await manageAdmin(p, body(req.body))); });
    router.get('/api/v1/admin/appeals', async (req, res) => { await requireAdmin(req, 'reports.review'); const page = parsePagination(parseQueryString(req.url ?? '')); sendJson(res, 200, { items: await rows(`SELECT to_jsonb(a) AS data FROM moderation_appeals a ORDER BY created_at ASC LIMIT :'limit' OFFSET :'offset'`, { ...page }), ...page }); });
    router.post('/api/v1/admin/appeals/:id', async (req, res) => { const p = await requireAdmin(req, 'reports.review', false, true); const b = body(req.body); confirmation(b.confirmed); const decision = text(b.decision, 20); if (!['UPHELD', 'DENIED'].includes(decision))
        throw new HttpError(422, 'Invalid decision.'); const result = await one(`WITH changed AS (UPDATE moderation_appeals SET status=:'decision',resolution=:'reason',reviewer_id=:'actor',version=version+1 WHERE id=:'id' AND status='OPEN' AND version=:'version' RETURNING *), audit AS(INSERT INTO admin_audit(actor_id,action,target_id,metadata) SELECT :'actor','APPEAL_REVIEWED',id,jsonb_build_object('decision',status,'resolution',resolution) FROM changed) SELECT to_jsonb(c) AS data FROM changed c`, { id: uuid(req.params.id), actor: p.userId, decision, reason: text(b.reason, 500), version: integer(b.version, 1, 2147483647) }); if (!result)
        throw new HttpError(409, 'Appeal already reviewed.'); sendJson(res, 200, result); });
    router.post('/api/v1/admin/media/:kind', async (req, res) => { const p = await requireAdmin(req, 'ads.create'); const kind = req.params.kind; if (kind !== 'photo' && kind !== 'video')
        throw new HttpError(422, 'Invalid media kind.'); const media = await receiveUpload(req, p.userId, kind, mediaStorage); sendJson(res, 201, { media: { id: media.id, kind: media.kind } }); }, { rawBody: true });
    router.get('/api/v1/admin/evidence/:reportId', async (req, res) => { await requireAdmin(req, 'reports.read'); const row = await one(`SELECT jsonb_build_object('mediaId',CASE r.target_type WHEN 'story' THEN s.media_id ELSE c.media_id END) AS data FROM reports r LEFT JOIN stories s ON r.target_type='story' AND s.id=r.target_id LEFT JOIN ad_creatives c ON r.target_type='ad' AND c.id=r.target_id WHERE r.id=:'id'`, { id: uuid(req.params.reportId) }); if (!row?.mediaId)
        throw new HttpError(404, 'Evidence unavailable.'); const media = await findMediaById(String(row.mediaId)); if (!media)
        throw new HttpError(404, 'Evidence unavailable.'); res.setHeader('Content-Type', media.mimeType); res.setHeader('Cache-Control', 'no-store'); mediaStorage.readStream(media.storageKey).on('error', () => res.destroy()).pipe(res); });
}
