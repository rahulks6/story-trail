import { streamMedia } from '../media/stream';
import type { KatkeeRequest, Router } from "../../http/router";
import { requireAuth } from "../../http/middleware/auth.middleware";
import { sendJson } from "../../http/respond";
import { HttpError } from "../../http/errors";
import { RateLimiter } from "../../http/rateLimiter";
import { parsePagination, parseQueryString } from "../../http/pagination";
import { queryOne } from "../../db/psql";
import { config } from "../../config/env";
import { body, confirmation, integer, text, uuid } from "../admin/policy";
import { requireAdmin } from "../admin/security";
import { one, rows } from "../admin/admin.service";
import * as ads from "./ads.service";
import { findMediaById } from "../media/media.repository";
import { mediaStorage } from "../media/instance";
const eventLimit = new RateLimiter(60000, 120), reportLimit = new RateLimiter(3600000, 20);
/** Operational ad permissions include reading the resources needed for that operation. */
async function requireAdResources(req: KatkeeRequest): Promise<void> {
    const p = await requireAdmin(req);
    if (p.role !== 'SUPER_ADMIN' && !['ads.create', 'ads.edit', 'ads.review', 'ads.pause', 'ads.analytics.read'].some(permission => p.permissions.includes(permission))) {
        throw new HttpError(403, 'Advertising permission required.');
    }
}
export function registerAdsRoutes(router: Router): void {
    router.get('/api/v1/admin/advertisers', async (req, res) => { await requireAdResources(req); const page = parsePagination(parseQueryString(req.url ?? '')); sendJson(res, 200, { items: await rows(`SELECT to_jsonb(a) AS data FROM advertisers a ORDER BY created_at DESC LIMIT :'limit' OFFSET :'offset'`, { ...page }), ...page }); });
    router.post('/api/v1/admin/advertisers', async (req, res) => { const p = await requireAdmin(req, 'ads.create'); const b = body(req.body); confirmation(b.confirmed); const result = await one(`WITH a AS(INSERT INTO advertisers(name,user_id,created_by) SELECT :'name',id,:'actor' FROM users WHERE id=:'user' AND deleted_at IS NULL AND is_active AND NOT is_private RETURNING *),audit AS(INSERT INTO admin_audit(actor_id,action,target_id) SELECT :'actor','ADVERTISER_CREATED',id FROM a) SELECT to_jsonb(a) AS data FROM a`, { name: text(b.name, 100), user: uuid(b.userId), actor: p.userId }); if (!result)
        throw new HttpError(422, 'A public, active advertiser account is required.'); sendJson(res, 201, result); });
    router.get('/api/v1/admin/campaigns', async (req, res) => { await requireAdResources(req); const q = parseQueryString(req.url ?? ''); const page = parsePagination(q); sendJson(res, 200, { items: await rows(`SELECT to_jsonb(k)||jsonb_build_object('creative',to_jsonb(c),'advertiser',a.name) AS data FROM ad_campaigns k JOIN ad_creatives c ON c.campaign_id=k.id JOIN advertisers a ON a.id=k.advertiser_id WHERE (:'status'='' OR k.status=:'status') AND (:'search'='' OR k.id::text=:'search' OR k.name ILIKE :'pattern') ORDER BY k.created_at DESC LIMIT :'limit' OFFSET :'offset'`, { ...page, status: q.status ?? '', search: q.search ?? '', pattern: `%${(q.search ?? '').slice(0, 120)}%` }), ...page }); });
    router.post('/api/v1/admin/campaigns', async (req, res) => { const p = await requireAdmin(req, 'ads.create'); sendJson(res, 201, await ads.createCampaign(p, body(req.body))); });
    router.post('/api/v1/admin/campaigns/:id/transition', async (req, res) => { const p = await requireAdmin(req, undefined, false, true); sendJson(res, 200, await ads.transition(p, req.params.id!, body(req.body))); });
    router.post('/api/v1/admin/campaigns/:id/edit', async (req, res) => { const p = await requireAdmin(req, 'ads.edit', false, true); sendJson(res, 200, await ads.editCampaign(p, req.params.id!, body(req.body))); });
    router.get('/api/v1/admin/campaigns/:id/analytics', async (req, res) => { await requireAdmin(req, 'ads.analytics.read'); const counts = await rows(`SELECT jsonb_build_object('event',e.event_type,'count',count(*)) AS data FROM ad_events e JOIN ad_deliveries d ON d.id=e.delivery_id WHERE d.campaign_id=:'id' GROUP BY e.event_type`, { id: uuid(req.params.id) }); sendJson(res, 200, { counts, spend: null, billingEnabled: false }); });
    router.get('/api/v1/admin/campaigns/:id/preview', async (req, res) => { await requireAdResources(req); const row = await queryOne(`SELECT c.media_id FROM ad_creatives c WHERE campaign_id=:'id'`, { id: uuid(req.params.id) }); if (!row)
        throw new HttpError(404, 'Not found.'); const m = await findMediaById(row.media_id!); if (!m)
        throw new HttpError(404, 'Not found.'); await streamMedia(req,res,m,mediaStorage); });
    router.get('/api/v1/admin/ad-settings', async (req, res) => { await requireAdmin(req, 'ads.analytics.read'); sendJson(res, 200, await one('SELECT to_jsonb(s) AS data FROM ad_delivery_settings s WHERE id=1')); });
    router.post('/api/v1/admin/ad-settings', async (req, res) => { const p = await requireAdmin(req, 'ads.edit', true, true); const b = body(req.body); confirmation(b.confirmed); sendJson(res, 200, await one(`WITH s AS(UPDATE ad_delivery_settings SET organic_gap=:'gap',session_cap=:'session',daily_cap=:'daily' WHERE id=1 RETURNING *),audit AS(INSERT INTO admin_audit(actor_id,action,metadata) SELECT :'actor','AD_SETTINGS_CHANGED',to_jsonb(s) FROM s) SELECT to_jsonb(s) AS data FROM s`, { gap: integer(b.organicGap, 3, 100), session: integer(b.sessionCap, 1, 10), daily: integer(b.dailyCap, 1, 50), actor: p.userId })); });
    router.get('/api/v1/ads/placements', async (req, res) => { requireAuth(req); if (!ads.adsEnabled()) {
        sendJson(res, 200, { items: [] });
        return;
    } const q = parseQueryString(req.url ?? ''); eventLimit.check(req.userId!); try {
        sendJson(res, 200, { items: await ads.placements(req.userId!, integer(Number(q.organicCount), 0, 1000)) });
    }
    catch {
        console.warn(JSON.stringify({ event: 'ad_insertion_failed' }));
        sendJson(res, 200, { items: [] });
    } });
    router.post('/api/v1/ads/events', async (req, res) => { requireAuth(req); if (!ads.adsEnabled()) {
        sendJson(res, 204, undefined);
        return;
    } eventLimit.check(req.userId!); const b = body(req.body); if (!Array.isArray(b.events) || b.events.length > 20)
        throw new HttpError(422, 'Invalid event batch.'); for (const e of b.events)
        await ads.ingest(req.userId!, body(e)); sendJson(res, 204, undefined); });
    router.get('/api/v1/ads/deliveries/:id', async (req, res) => { requireAuth(req); const item = await ads.delivery(req.userId!, uuid(req.params.id)); if (!item)
        throw new HttpError(404, 'Ad unavailable.'); sendJson(res, 200, item); });
    router.get('/api/v1/ads/deliveries/:id/media', async (req, res) => { requireAuth(req); const id = uuid(req.params.id); if (!(await ads.delivery(req.userId!, id)))
        throw new HttpError(404, 'Ad unavailable.'); const row = await queryOne(`SELECT c.media_id FROM ad_deliveries d JOIN ad_creatives c ON c.id=d.creative_id WHERE d.id=:'id'`, { id }); const m = row ? await findMediaById(row.media_id!) : null; if (!m)
        throw new HttpError(404, 'Ad unavailable.'); await streamMedia(req,res,m,mediaStorage); });
    router.post('/api/v1/ads/deliveries/:id/report', async (req, res) => { requireAuth(req); if (!config.features.adReporting || !ads.adsEnabled())
        throw new HttpError(404, 'Not found.'); reportLimit.check(req.userId!); const id = uuid(req.params.id), b = body(req.body); const reason = text(b.reason, 30); if (!['scam', 'inappropriate', 'offensive', 'prohibited', 'impersonation', 'other'].includes(reason))
        throw new HttpError(422, 'Invalid reason.'); const result = await one(`WITH d AS(SELECT * FROM ad_deliveries WHERE id=:'id' AND viewer_id=:'viewer'),claim AS(INSERT INTO ad_events(delivery_id,event_type) SELECT id,'ad_report' FROM d ON CONFLICT DO NOTHING RETURNING delivery_id),r AS(INSERT INTO reports(reporter_id,target_type,target_id,reason,details) SELECT :'viewer','ad',creative_id,'other',:'reason' FROM d JOIN claim ON claim.delivery_id=d.id RETURNING id) SELECT jsonb_build_object('accepted',EXISTS(SELECT 1 FROM d)) AS data`, { id, viewer: req.userId!, reason }); if (!result?.accepted)
        throw new HttpError(404, 'Delivery not found.'); sendJson(res, 200, result); });
}

