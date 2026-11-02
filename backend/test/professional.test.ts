// Professional accounts and their dashboard (src/modules/professional, migration 0066): the
// switch and its rules, the category on the profile, and that every number on the dashboard is
// counted honestly, owner-only, with followers' active hours held back below the minimum.
import "./env";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { buildApp } from "../src/app";
import { authHeader, makeClient, uniqueUser } from "./helpers";
import { buildTestPng } from "./fixtures";
import { query, queryOne } from "../src/db/psql";
import { MIN_ACTIVE_FOLLOWERS, audienceHours } from "../src/modules/professional/dashboard";
import { noteActivity, resetActivityCache } from "../src/modules/analytics/activity";

let client: ReturnType<typeof makeClient>;
let baseUrl: string;
const server = buildApp();

before(async () => {
  await new Promise<void>((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  client = makeClient(baseUrl);
});
after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

type User = { username: string; token: string; id: string };
async function signup(): Promise<User> {
  const input = uniqueUser();
  const res = await client.post("/api/v1/auth/signup", input);
  return { username: input.username, token: res.body.tokens.accessToken as string, id: res.body.user.id as string };
}
async function publish(owner: User): Promise<string> {
  const upload = await fetch(`${baseUrl}/api/v1/media/photos`, { method: "POST", headers: { "Content-Type": "image/png", ...authHeader(owner.token) }, body: buildTestPng(4, 4) });
  const mediaId = ((await upload.json()) as { media: { id: string } }).media.id;
  const res = await client.post("/api/v1/stories", { mediaId, caption: "", audience: "public", allowComments: "everyone", allowSharing: true }, authHeader(owner.token));
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.story.id as string;
}
const follow = (a: User, b: User) => client.post(`/api/v1/users/${b.username}/follow`, undefined, authHeader(a.token));
const goPro = (u: User, body: Record<string, unknown> = { category: "creator" }) => client.put("/api/v1/me/professional", body, authHeader(u.token));
const dashboard = (u: User, qs = "days=7&tz=Asia/Kolkata") => client.get(`/api/v1/me/professional/dashboard?${qs}`, authHeader(u.token));

describe("switching to a professional account", () => {
  it("starts personal, switches with a category, shows it quietly on the profile, and switches back", async () => {
    const me = await signup();
    const other = await signup();
    const status = await client.get("/api/v1/me/professional", authHeader(me.token));
    assert.equal(status.status, 200);
    assert.deepEqual(status.body, { professional: null, eligibility: { eligible: true, reasons: [] } });

    assert.equal((await goPro(me, { category: "influencer" })).status, 422, "only known categories");
    assert.equal((await goPro(me, { category: "artist", showCategory: "yes" })).status, 422);

    const on = await goPro(me, { category: "artist", timeZone: "Asia/Kolkata" });
    assert.equal(on.status, 200, JSON.stringify(on.body));
    assert.equal(on.body.professional.category, "artist");
    assert.equal(on.body.professional.showCategory, true);
    assert.ok(Date.parse(on.body.professional.since) > 0);
    const tz = await queryOne(`SELECT professional_time_zone FROM users WHERE id = :'id'`, { id: me.id });
    assert.equal(tz?.professional_time_zone, "Asia/Kolkata");

    const seen = await client.get(`/api/v1/users/${me.username}`, authHeader(other.token));
    assert.equal(seen.body.profile.professionalCategory, "artist");
    const self = await client.get("/api/v1/auth/me", authHeader(me.token));
    assert.equal(self.body.user.professionalCategory, "artist");

    // Changing the category keeps the first switch's date; hiding it takes it off the profile.
    const hidden = await goPro(me, { category: "brand", showCategory: false, timeZone: "Not/AZone" });
    assert.equal(hidden.body.professional.since, on.body.professional.since);
    assert.equal(hidden.body.professional.category, "brand");
    assert.equal((await client.get(`/api/v1/users/${me.username}`, authHeader(other.token))).body.profile.professionalCategory, null);
    assert.equal((await queryOne(`SELECT professional_time_zone FROM users WHERE id = :'id'`, { id: me.id }))?.professional_time_zone, "Asia/Kolkata", "an unknown zone is ignored");

    const off = await client.delete("/api/v1/me/professional", authHeader(me.token));
    assert.equal(off.status, 200);
    assert.equal(off.body.professional, null);
    assert.equal((await client.get(`/api/v1/users/${me.username}`, authHeader(other.token))).body.profile.professionalCategory, null);
    assert.equal((await dashboard(me)).status, 403, "the dashboard goes with it");
  });

  it("refuses a private account, and a professional account can't turn private", async () => {
    const me = await signup();
    await client.patch("/api/v1/users/me", { isPrivate: true }, authHeader(me.token));
    const status = await client.get("/api/v1/me/professional", authHeader(me.token));
    assert.equal(status.body.eligibility.eligible, false);
    assert.match(status.body.eligibility.reasons[0], /Private accounts can't be professional/);
    const refused = await goPro(me);
    assert.equal(refused.status, 409);
    assert.equal(refused.body.code, "private_account");

    await client.patch("/api/v1/users/me", { isPrivate: false }, authHeader(me.token));
    assert.equal((await goPro(me)).status, 200);
    const privateAgain = await client.patch("/api/v1/users/me", { isPrivate: true }, authHeader(me.token));
    assert.equal(privateAgain.status, 409);
    assert.equal(privateAgain.body.code, "professional_account");
    assert.equal((await client.get("/api/v1/auth/me", authHeader(me.token))).body.user.isPrivate, false, "nothing changed");
  });

  it("needs a signed-in account", async () => {
    assert.equal((await client.get("/api/v1/me/professional")).status, 401);
    assert.equal((await client.put("/api/v1/me/professional", { category: "creator" })).status, 401);
    assert.equal((await client.get("/api/v1/me/professional/dashboard?days=7")).status, 401);
  });
});

describe("the professional dashboard", () => {
  it("counts reach, views, interactions and follower changes honestly, and only for its owner", async () => {
    const creator = await signup();
    await goPro(creator);
    const viewers = [await signup(), await signup(), await signup()];
    // Two of the three follow before watching; one of them unfollows later.
    await follow(viewers[0]!, creator);
    await follow(viewers[1]!, creator);
    const first = await publish(creator);
    const second = await publish(creator);
    for (const v of viewers) await client.post(`/api/v1/stories/${first}/view`, undefined, authHeader(v.token));
    await client.post(`/api/v1/stories/${second}/view`, undefined, authHeader(viewers[0]!.token));
    // Own views, likes and comments never count.
    await client.post(`/api/v1/stories/${first}/view`, undefined, authHeader(creator.token));
    await client.post(`/api/v1/stories/${first}/like`, undefined, authHeader(creator.token));
    await client.post(`/api/v1/stories/${first}/like`, undefined, authHeader(viewers[0]!.token));
    await client.post(`/api/v1/stories/${first}/like`, undefined, authHeader(viewers[1]!.token));
    await client.post(`/api/v1/stories/${second}/comments`, { body: "Lovely" }, authHeader(viewers[2]!.token));
    await client.post(`/api/v1/stories/${first}/share`, undefined, authHeader(viewers[2]!.token));
    await client.delete(`/api/v1/users/${creator.username}/follow`, authHeader(viewers[1]!.token));

    const res = await dashboard(creator);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const d = res.body.dashboard;
    assert.equal(d.days, 7);
    assert.equal(d.timeZone, "Asia/Kolkata");
    assert.equal(d.daily.length, 7);
    assert.equal(d.to, d.daily.at(-1).day);
    assert.equal(d.summary.accountsReached, 3);
    assert.equal(d.summary.reachedFollowers, 2, "the snapshot at their first view");
    assert.equal(d.summary.storyViews, 4);
    assert.equal(d.summary.storiesPosted, 2);
    assert.equal(d.summary.likes, 2);
    assert.equal(d.summary.comments, 1);
    assert.equal(d.summary.shares, 1);
    assert.equal(d.summary.replies, 0);
    assert.equal(d.summary.followers, 1);
    assert.deepEqual(d.previous, { accountsReached: 0, storyViews: 0 });
    const today = d.daily.at(-1);
    assert.deepEqual([today.views, today.followersGained, today.followersLost], [4, 2, 1]);
    assert.equal(d.topStories.length, 2);
    assert.equal(d.topStories[0].id, first, "most viewed first");
    assert.deepEqual([d.topStories[0].views, d.topStories[0].likes, d.topStories[0].shares], [3, 2, 1]);
    assert.ok(d.topStories[0].media?.thumbnailUrl, "your own thumbnail");
    assert.deepEqual(d.audience, { status: "not_enough", minimumFollowers: MIN_ACTIVE_FOLLOWERS });

    // Days before follower changes were counted are "not counted", never 0.
    await query(`UPDATE follower_history_start SET started_at = now() - interval '2 days'`);
    try {
      const partial = (await dashboard(creator)).body.dashboard;
      assert.equal(partial.daily[0].followersGained, null);
      assert.equal(partial.daily.at(-1).followersGained, 2);
      assert.equal(partial.summary.followersNet, null, "not counted for the whole period");
      const counted = (await dashboard(creator, "days=7&tz=UTC")).body.dashboard;
      assert.equal(counted.timeZone, "UTC");
    } finally {
      await query(`UPDATE follower_history_start SET started_at = now() - interval '400 days'`);
    }
    const whole = (await dashboard(creator, "days=30&tz=Asia/Kolkata")).body.dashboard;
    assert.equal(whole.daily.length, 30);
    assert.equal(whole.summary.followersNet, 1);

    assert.equal((await dashboard(creator, "days=14")).status, 400);
    // There is no way to ask for someone else's: the route is always yours, and theirs is personal.
    const outsider = (await dashboard(viewers[0]!)).body;
    assert.equal(outsider.code, "not_professional");
  });

  it("shows when followers are active only from the minimum up, and only as shares of the busiest hour", async () => {
    const creator = await signup();
    await goPro(creator, { category: "creator", timeZone: "Asia/Kolkata" });
    const followers: User[] = [];
    for (let i = 0; i < MIN_ACTIVE_FOLLOWERS; i++) {
      const f = await signup();
      await follow(f, creator);
      followers.push(f);
    }
    // 14:30 UTC is 20:00 in India; 03:30 UTC is 09:00.
    const evening = new Date(Date.now() - 86_400_000);
    evening.setUTCHours(14, 30, 0, 0);
    const morning = new Date(evening);
    morning.setUTCHours(3, 30, 0, 0);
    await query(`DELETE FROM activity_half_hours WHERE user_id = ANY (string_to_array(:'ids', ',')::uuid[])`, { ids: followers.map((f) => f.id).join(",") });
    for (const f of followers.slice(0, MIN_ACTIVE_FOLLOWERS - 1)) {
      await query(`INSERT INTO activity_half_hours (user_id, slot) VALUES (:'u', :'s')`, { u: f.id, s: evening.toISOString() });
    }
    assert.equal((await audienceHours(creator.id, "Asia/Kolkata")).status, "not_enough", "nine followers is below the minimum");

    await query(`INSERT INTO activity_half_hours (user_id, slot) VALUES (:'u', :'s')`, { u: followers.at(-1)!.id, s: evening.toISOString() });
    for (const f of followers.slice(0, 5)) await query(`INSERT INTO activity_half_hours (user_id, slot) VALUES (:'u', :'s')`, { u: f.id, s: morning.toISOString() });
    // Cached from the first count: still "not enough" until it's counted again.
    assert.equal((await audienceHours(creator.id, "Asia/Kolkata")).status, "not_enough");
    await query(`DELETE FROM professional_audience_hours WHERE user_id = :'id'`, { id: creator.id });
    const ready = await audienceHours(creator.id, "Asia/Kolkata");
    assert.equal(ready.status, "ready");
    if (ready.status !== "ready") return;
    assert.equal(ready.peakHour, 20);
    assert.equal(ready.hours[20], 100);
    assert.equal(ready.hours[9], 50);
    assert.equal(ready.hours.length, 24);
    assert.equal(ready.basedOnFollowers, MIN_ACTIVE_FOLLOWERS);
    const stored = await queryOne(`SELECT hours FROM professional_audience_hours WHERE user_id = :'id'`, { id: creator.id });
    assert.ok(JSON.parse(String(stored?.hours)).every((n: number) => n >= 0 && n <= 100), "shares only, never counts");

    // A different time zone is counted again in that zone.
    const utc = await audienceHours(creator.id, "UTC");
    assert.equal(utc.status === "ready" && utc.peakHour, 14);
    const shown = (await dashboard(creator)).body.dashboard.audience;
    assert.equal(shown.status, "ready");
    assert.equal(shown.peakHour, 20);
  });

  it("records each person's active half hour once, from any signed-in request", async () => {
    const me = await signup();
    resetActivityCache();
    const at = new Date("2026-10-29T10:47:00Z");
    noteActivity(me.id, "android", at);
    noteActivity(me.id, "ios", new Date("2026-10-29T10:58:00Z"));
    let rows: Awaited<ReturnType<typeof query>> = [];
    for (let i = 0; i < 50 && rows.length === 0; i++) {
      await new Promise((r) => setTimeout(r, 20));
      rows = await query(`SELECT to_json(slot) #>> '{}' AS slot FROM activity_half_hours WHERE user_id = :'u' AND slot < now() - interval '1 hour'`, { u: me.id });
    }
    assert.deepEqual(rows.map((r) => Date.parse(r.slot as string)), [Date.parse("2026-10-29T10:30:00Z")]);
  });

  it("accepts the dashboard-viewed analytics event with its range only", async () => {
    const me = await signup();
    const res = await client.post("/api/v1/analytics/events", {
      events: [{ id: crypto.randomUUID(), name: "professional_dashboard_viewed", occurredAt: new Date().toISOString(), properties: { range: "30d", followers: 12 } }],
    }, authHeader(me.token));
    assert.equal(res.status, 200);
    assert.equal(res.body.accepted, 1);
    const row = await queryOne(`SELECT properties FROM analytics_events WHERE user_id = :'u'`, { u: me.id });
    assert.deepEqual(JSON.parse(String(row?.properties)), { range: "30d" });
  });
});
