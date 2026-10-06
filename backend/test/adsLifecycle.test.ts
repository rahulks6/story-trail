import "./admin-env";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { buildApp } from "../src/app";
import { query, queryOne } from "../src/db/psql";
import { completeFinishedCampaigns } from "../src/modules/ads/ads.service";
import { buildTestPng } from "./fixtures";
import { adminSignIn, type AdminHeaders } from "./adminSession";

const server = buildApp();
let base = "";
after(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

async function request(path: string, method = "GET", data?: unknown, headers: Record<string, string> = {}) {
  const r = await fetch(base + path, { method, headers: { "Content-Type": "application/json", ...headers }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
  const text = await r.text();
  return { status: r.status, body: text ? JSON.parse(text) : null };
}
async function account(grant?: string[]) {
  const tag = randomUUID().slice(0, 8);
  const input = { email: `ads_${tag}@example.com`, username: `ads_${tag}`, password: "correcthorsebattery", displayName: `Ads ${tag}` };
  const r = await request("/api/v1/auth/signup", "POST", input);
  assert.equal(r.status, 201);
  if (grant) await query(`INSERT INTO admin_grants(user_id, role, permissions) VALUES (:'id', 'ADMIN', :'p'::jsonb)`, { id: r.body.user.id, p: JSON.stringify(grant) });
  return { id: r.body.user.id as string, input, auth: { Authorization: `Bearer ${r.body.tokens.accessToken}` } };
}
type Account = Awaited<ReturnType<typeof account>>;

let creator: Account, reviewer: Account, ch: AdminHeaders, rh: AdminHeaders, advertiserId: string;
before(async () => {
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  creator = await account(["ads.create", "ads.edit", "ads.pause", "ads.analytics.read"]);
  reviewer = await account(["ads.review", "ads.analytics.read"]);
  ch = await adminSignIn(base, creator.input.email, creator.input.password);
  rh = await adminSignIn(base, reviewer.input.email, reviewer.input.password);
  advertiserId = (await request("/api/v1/admin/advertisers", "POST", { name: "Sunrise Travel", userId: creator.id, confirmed: true }, ch)).body.id;
});

async function photoOf(owner: Account): Promise<string> {
  const r = await fetch(base + "/api/v1/media/photos", { method: "POST", headers: { ...owner.auth, "Content-Type": "image/png" }, body: buildTestPng(4, 4) });
  return ((await r.json()) as { media: { id: string } }).media.id;
}
function draft(overrides: Record<string, unknown> = {}) {
  return (async () => ({
    advertiserId, mediaId: await photoOf(creator), name: `Campaign ${randomUUID().slice(0, 6)}`,
    startAt: new Date(Date.now() - 60000).toISOString(), endAt: new Date(Date.now() + 3600000).toISOString(),
    budgetMinor: 50000, currency: "INR", impressionLimit: 100, userCap: 2, dailyCap: 2,
    caption: "Weekend getaways", cta: "Learn More", destination: "https://example.com/offer", confirmed: true, ...overrides,
  }))();
}
async function transition(id: string, version: number, action: string, headers: AdminHeaders) {
  const r = await request(`/api/v1/admin/campaigns/${id}/transition`, "POST", { action, version, reason: `${action} for test`, confirmed: true }, headers);
  assert.equal(r.status, 200, `${action}: ${JSON.stringify(r.body)}`);
  return r.body as { status: string; version: number };
}
async function activeCampaign(overrides: Record<string, unknown> = {}): Promise<string> {
  const created = await request("/api/v1/admin/campaigns", "POST", await draft(overrides), ch);
  assert.equal(created.status, 201, JSON.stringify(created.body));
  let state = await transition(created.body.id, created.body.version, "submit", ch);
  state = await transition(created.body.id, state.version, "approve", rh);
  await transition(created.body.id, state.version, "activate", ch);
  return created.body.id as string;
}
const endAll = () => query(`UPDATE ad_campaigns SET status = 'COMPLETED' WHERE status IN ('ACTIVE', 'PAUSED', 'APPROVED')`);
const placements = (viewer: Account, qs = "organicCount=12") => request(`/api/v1/ads/placements?${qs}`, "GET", undefined, viewer.auth);

describe("ads lifecycle", () => {
  it("is created, reviewed, approved, delivered, paused, resumed, measured, reported and completed", async () => {
    const created = await request("/api/v1/admin/campaigns", "POST", await draft(), ch);
    assert.equal(created.body.status, "DRAFT");
    let state = await transition(created.body.id, created.body.version, "submit", ch);
    assert.equal(state.status, "PENDING_REVIEW");
    assert.equal((await request(`/api/v1/admin/campaigns/${created.body.id}/transition`, "POST", { action: "approve", version: state.version, reason: "self", confirmed: true }, ch)).status, 403, "creators can't approve");
    state = await transition(created.body.id, state.version, "approve", rh);
    assert.equal(state.status, "APPROVED");
    state = await transition(created.body.id, state.version, "activate", ch);
    assert.equal(state.status, "ACTIVE");

    const viewer = await account();
    const items = (await placements(viewer)).body.items;
    assert.equal(items.length >= 1, true);
    const ad = items[0];
    assert.deepEqual([ad.brand, ad.cta, ad.destination], ["Sunrise Travel", "Learn More", "https://example.com/offer"]);
    assert.match(ad.explanation, /^Shown broadly to people on Katkee\. Advertisers never see who you are/);
    await query(`UPDATE ad_deliveries SET created_at = now() - interval '10 seconds' WHERE id = :'id'`, { id: ad.deliveryId });
    for (const [event, visibleMs] of [["ad_rendered", 0], ["ad_impression", 1500], ["ad_qualified_view", 2500], ["ad_complete", 5000], ["ad_click", 0]] as const) {
      assert.equal((await request("/api/v1/ads/events", "POST", { events: [{ deliveryId: ad.deliveryId, event, visibleMs }] }, viewer.auth)).status, 204, event);
    }
    const report = await request(`/api/v1/ads/deliveries/${ad.deliveryId}/report`, "POST", { reason: "scam" }, viewer.auth);
    assert.equal(report.status, 200);
    assert.deepEqual(await queryOne(`SELECT reason, source FROM reports WHERE target_type = 'ad' AND reporter_id = :'v'`, { v: viewer.id }), { reason: "scam", source: "ad" });
    const analytics = await request(`/api/v1/admin/campaigns/${created.body.id}/analytics`, "GET", undefined, ch);
    const counts = Object.fromEntries(analytics.body.counts.map((c: { event: string; count: number }) => [c.event, Number(c.count)]));
    assert.deepEqual([counts.ad_requested, counts.ad_rendered, counts.ad_impression, counts.ad_qualified_view, counts.ad_complete, counts.ad_click, counts.ad_report], [1, 1, 1, 1, 1, 1, 1]);

    state = await transition(created.body.id, state.version, "pause", ch);
    assert.equal(state.status, "PAUSED");
    assert.equal((await placements(await account())).body.items.length, 0, "a paused campaign is not delivered (organic only)");
    state = await transition(created.body.id, state.version, "activate", ch);
    state = await transition(created.body.id, state.version, "complete", ch);
    assert.equal(state.status, "COMPLETED");
  });

  it("targets broad interest categories and platforms only, and explains why", async () => {
    await endAll();
    const id = await activeCampaign({ audience: { interests: ["travel"], platforms: ["ios"] }, userCap: 1 });
    const traveller = await account();
    await request("/api/v1/users/me", "PATCH", { interests: ["Travel", "Cooking"] }, traveller.auth);
    const other = await account();
    await request("/api/v1/users/me", "PATCH", { interests: ["Christianity", "Gardening"] }, other.auth);

    assert.equal((await placements(traveller, "organicCount=12&platform=android")).body.items.length, 0, "wrong platform");
    const matched = (await placements(traveller, "organicCount=12&platform=ios")).body.items;
    assert.equal(matched.length, 1);
    assert.match(matched[0].explanation, /^Shown to people interested in Travel\./);
    assert.equal((await placements(other, "organicCount=12&platform=ios")).body.items.length, 0, "no match: organic Stories only");
    assert.equal((await queryOne(`SELECT count(*) AS n FROM ad_deliveries WHERE campaign_id = :'c'`, { c: id }))?.n, "1");

    for (const [audience, message] of [
      [{ interests: ["religion"] }, /Sensitive categories/],
      [{ interests: ["gardening_tools"] }, /Only the listed broad interest categories/],
      [{ age: [18, 24] }, /not age/],
      [{ platforms: ["web"] }, /android and\/or ios/],
    ] as const) {
      const r = await request("/api/v1/admin/campaigns", "POST", await draft({ audience }), ch);
      assert.equal(r.status, 422, JSON.stringify(audience));
      assert.match(r.body.message, message);
    }
    const categories = await request("/api/v1/admin/ad-interest-categories", "GET", undefined, ch);
    assert.equal(categories.body.items.length, 20);
    assert.ok(!categories.body.items.some((c: { key: string }) => /relig|health|polit|sexual/.test(c.key)));
  });

  it("supports a View Profile CTA that opens the advertiser's profile", async () => {
    await endAll();
    await activeCampaign({ cta: "View Profile", destination: undefined });
    const viewer = await account();
    const ad = (await placements(viewer)).body.items[0];
    assert.deepEqual([ad.cta, ad.profileUsername, ad.destination], ["View Profile", creator.input.username, null]);
  });

  it("falls back to organic Stories on bad input or when nothing is eligible", async () => {
    await endAll();
    const viewer = await account();
    for (const qs of ["", "organicCount=abc", "organicCount=5000", "organicCount=-1"]) assert.equal((await placements(viewer, qs)).status, 422, qs);
    const none = await placements(viewer);
    assert.deepEqual([none.status, none.body.items], [200, []]);
  });

  it("completes campaigns automatically at the end date or when impressions run out", async () => {
    await endAll();
    const ended = await activeCampaign();
    const capped = await activeCampaign({ impressionLimit: 1 });
    await query(`UPDATE ad_campaigns SET end_at = now() - interval '1 minute' WHERE id = :'id'`, { id: ended });
    await placements(await account());
    assert.ok((await completeFinishedCampaigns()) >= 2);
    const states = await query(`SELECT id, status FROM ad_campaigns WHERE id IN (:'a', :'b')`, { a: ended, b: capped });
    assert.ok(states.every((s) => s.status === "COMPLETED"), JSON.stringify(states));
    const audit = await query(`SELECT target_id, metadata->>'reason' AS reason FROM admin_audit WHERE action = 'CAMPAIGN_COMPLETED' AND target_id IN (:'a', :'b') ORDER BY reason`, { a: ended, b: capped });
    assert.deepEqual(audit.map((a) => [a.target_id, a.reason]), [[ended, "end_date"], [capped, "impression_limit"]]);
    assert.equal(await completeFinishedCampaigns(), 0, "nothing left to complete");
  });
});
