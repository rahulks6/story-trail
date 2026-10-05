import { HttpError } from "../../http/errors";
import { config } from "../../config/env";
import { queryOne, DatabaseError } from "../../db/psql";
import { one, rows } from "../admin/admin.service";
import { authorize, confirmation, integer, text, uuid, type Principal } from "../admin/policy";
export const adsEnabled = () => config.features.ads && config.features.sponsored;
export function destination(value: unknown): string {
    const raw = text(value, 2048);
    let url: URL;
    try {
        url = new URL(raw);
    }
    catch {
        throw new HttpError(422, 'Invalid destination.');
    }
    if (url.protocol !== 'https:' || url.username || url.password || url.port || !url.hostname.includes('.') || /^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(url.hostname) || url.hostname.endsWith('.local') || url.hostname.includes(':'))
        throw new HttpError(422, 'Use a public HTTPS destination without credentials or custom ports.');
    return url.href;
}
export async function createCampaign(p: Principal, b: Record<string, unknown>) {
    authorize(p, 'ads.create');
    confirmation(b.confirmed);
    const start = new Date(text(b.startAt, 40)), end = new Date(text(b.endAt, 40));
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start)
        throw new HttpError(422, 'Invalid schedule.');
    const currency = text(b.currency, 3).toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency))
        throw new HttpError(422, 'Invalid currency.');
    const cta = text(b.cta, 30);
    if (!['Learn More', 'Visit Website', 'Shop Now', 'Install'].includes(cta))
        throw new HttpError(422, 'Unsupported CTA.');
    const result = await one(`WITH campaign AS (
 INSERT INTO ad_campaigns(advertiser_id,name,objective,start_at,end_at,budget_minor,currency,impression_limit,user_cap,daily_cap,created_by)
 SELECT a.id,:'name',:'objective',:'start'::timestamptz,:'end'::timestamptz,:'budget'::bigint,:'currency',:'allocation'::integer,:'user_cap'::integer,:'daily'::integer,:'actor' FROM advertisers a,media m
 WHERE a.id=:'advertiser' AND m.id=:'media' AND m.owner_id=:'actor' AND m.status='ready' AND NOT EXISTS(SELECT 1 FROM stories WHERE media_id=m.id)
 RETURNING *),creative AS(INSERT INTO ad_creatives(campaign_id,media_id,caption,cta,destination) SELECT id,:'media',:'caption',:'cta',:'destination' FROM campaign RETURNING id),audit AS(INSERT INTO admin_audit(actor_id,action,target_id) SELECT :'actor','CAMPAIGN_CREATED',id FROM campaign)
 SELECT to_jsonb(k) AS data FROM campaign k`, { actor: p.userId, advertiser: uuid(b.advertiserId), media: uuid(b.mediaId), name: text(b.name, 120), objective: 'awareness', start: start.toISOString(), end: end.toISOString(), budget: integer(b.budgetMinor, 0, 1000000000), currency, allocation: integer(b.impressionLimit, 1, 100000000), user_cap: integer(b.userCap, 1, 100), daily: integer(b.dailyCap, 1, 20), caption: typeof b.caption === 'string' && b.caption.length <= 500 ? b.caption : '', cta, destination: destination(b.destination) });
    if (!result)
        throw new HttpError(422, 'Advertiser or owned unpublished media unavailable.');
    return result;
}
export async function transition(p: Principal, id: string, b: Record<string, unknown>) {
    const action = text(b.action, 20);
    authorize(p, action === 'approve' || action === 'reject' ? 'ads.review' : action === 'pause' ? 'ads.pause' : 'ads.edit');
    confirmation(b.confirmed);
    try {
        return await one(`SELECT transition_campaign(:'actor',:'id',:'version',:'action',:'reason') AS data`, { actor: p.userId, id: uuid(id), version: integer(b.version, 1, 2147483647), action, reason: text(b.reason, 500) });
    }
    catch (e) {
        if (e instanceof DatabaseError && /CONFLICT|INVALID_TRANSITION|SELF_REVIEW|NOT_FOUND/.test(e.detail))
            throw new HttpError(409, 'Campaign changed, transition unavailable, or independent review required.');
        throw e;
    }
}
export async function placements(viewer: string, organicCount: number) {
    if (!adsEnabled())
        return [];
    const setting = await queryOne('SELECT organic_gap,session_cap FROM ad_delivery_settings WHERE id=1');
    if (!setting)
        return [];
    const items: Record<string, unknown>[] = [];
    const gap = Number(setting.organic_gap);
    for (let slot = gap; slot < organicCount && slot <= gap * Number(setting.session_cap); slot += gap) {
        const reserved = await queryOne(`SELECT reserve_ad(:'viewer',:'slot') AS id`, { viewer, slot });
        if (reserved?.id) {
            const detail = await delivery(viewer, reserved.id);
            if (detail)
                items.push({ ...detail, afterOrganic: slot });
        }
    }
    return items;
}
export async function delivery(viewer: string, id: string) {
    if (!adsEnabled())
        return null;
    return one(`SELECT jsonb_build_object('deliveryId',d.id,'creativeId',c.id,'brand',a.name,'mediaKind',m.kind,'caption',c.caption,'cta',c.cta,'destination',c.destination,'reportingEnabled',:'reporting'::boolean,'explanation','This is a broadly delivered sponsored Story. No personal targeting or private messages are used.') AS data
 FROM ad_deliveries d JOIN ad_campaigns k ON k.id=d.campaign_id JOIN ad_creatives c ON c.id=d.creative_id JOIN advertisers a ON a.id=k.advertiser_id JOIN users u ON u.id=a.user_id JOIN media m ON m.id=c.media_id
 WHERE d.id=:'id' AND d.viewer_id=:'viewer' AND d.expires_at>now() AND k.status='ACTIVE' AND c.review_status='APPROVED' AND k.start_at<=now() AND k.end_at>now() AND m.status='ready' AND u.deleted_at IS NULL AND u.is_active AND NOT u.is_private
 AND NOT EXISTS(SELECT 1 FROM ad_hides WHERE viewer_id=:'viewer' AND creative_id=c.id)
 AND NOT EXISTS(SELECT 1 FROM blocks b WHERE (b.blocker_id=:'viewer' AND b.blocked_id=u.id) OR (b.blocked_id=:'viewer' AND b.blocker_id=u.id))`, { viewer, id, reporting: config.features.adReporting });
}
export async function ingest(viewer: string, b: Record<string, unknown>) {
    const id = uuid(b.deliveryId), event = text(b.event, 30), ms = integer(b.visibleMs ?? 0, 0, 3600000);
    if (!['ad_rendered', 'ad_impression', 'ad_qualified_view', 'ad_complete', 'ad_click', 'ad_hide', 'ad_load_failed'].includes(event))
        throw new HttpError(422, 'Invalid event.');
    if (event === 'ad_impression' && ms < 1000 || event === 'ad_qualified_view' && ms < 2000)
        throw new HttpError(422, 'Viewability threshold not met.');
    // Deduplicate per delivery/type and reject events for another viewer. Server elapsed time is a second bound.
    return one(`WITH valid AS(SELECT * FROM ad_deliveries WHERE id=:'id' AND viewer_id=:'viewer' AND created_at>now()-interval '1 day' AND extract(epoch FROM now()-created_at)*1000>=:'ms'::integer),event AS(
 INSERT INTO ad_events(delivery_id,event_type,visible_ms) SELECT id,:'event',:'ms'::integer FROM valid ON CONFLICT(delivery_id,event_type) DO NOTHING RETURNING id),hidden AS(
 INSERT INTO ad_hides(viewer_id,creative_id) SELECT viewer_id,creative_id FROM valid WHERE :'event'='ad_hide' ON CONFLICT DO NOTHING RETURNING creative_id)
 SELECT jsonb_build_object('accepted',EXISTS(SELECT 1 FROM valid)) AS data`, { id, viewer, event, ms });
}
/** Any creative or schedule edit revokes approval and all outstanding deliveries. */
export async function editCampaign(p: Principal, id: string, b: Record<string, unknown>) {
    authorize(p, 'ads.edit');
    confirmation(b.confirmed);
    const start = new Date(text(b.startAt, 40)), end = new Date(text(b.endAt, 40));
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start)
        throw new HttpError(422, 'Invalid schedule.');
    const caption = typeof b.caption === 'string' && b.caption.length <= 500 ? b.caption : null;
    if (caption === null)
        throw new HttpError(422, 'Caption must be at most 500 characters.');
    const cta = text(b.cta, 30);
    if (!['Learn More', 'Visit Website', 'Shop Now', 'Install'].includes(cta))
        throw new HttpError(422, 'Invalid CTA.');
    const result = await one(`WITH changed AS (
 UPDATE ad_campaigns k SET name=:'name',start_at=:'start'::timestamptz,end_at=:'end'::timestamptz,status='DRAFT',version=version+1,updated_by=:'actor',updated_at=now()
 WHERE k.id=:'id' AND k.version=:'version' AND k.status IN ('DRAFT','REJECTED','PAUSED','APPROVED')
 AND EXISTS(SELECT 1 FROM ad_creatives c WHERE c.campaign_id=k.id AND c.review_status<>'REMOVED')
 RETURNING *),creative AS (
 UPDATE ad_creatives SET caption=:'caption',cta=:'cta',destination=:'destination',review_status='PENDING' WHERE campaign_id IN(SELECT id FROM changed) RETURNING id),expired AS (
 UPDATE ad_deliveries SET expires_at=now() WHERE campaign_id IN(SELECT id FROM changed) RETURNING id),audit AS (
 INSERT INTO admin_audit(actor_id,action,target_id,metadata) SELECT :'actor','CAMPAIGN_EDITED',id,jsonb_build_object('version',version,'approvalReset',true) FROM changed)
 SELECT to_jsonb(k) AS data FROM changed k`, { id: uuid(id), actor: p.userId, version: integer(b.version, 1, 2147483647), name: text(b.name, 120), start: start.toISOString(), end: end.toISOString(), caption, cta, destination: destination(b.destination) });
    if (!result)
        throw new HttpError(409, 'Pause the campaign first, or refresh its current version. Removed creatives cannot be edited back into delivery.');
    return result;
}
