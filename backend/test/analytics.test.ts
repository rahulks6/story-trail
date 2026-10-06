import "./admin-env";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { buildApp } from "../src/app";
import { query, queryOne } from "../src/db/psql";
import { deriveRates, purgeRawAnalytics, rollupAnalytics, storedDay } from "../src/modules/analytics/rollup";
import { analyticsIngestLimiter } from "../src/modules/analytics/analytics.routes";
import { buildTestPng } from "./fixtures";
import { adminSignIn } from "./adminSession";

const server = buildApp();
let base = "";
before(async () => {
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
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
  const input = { email: `an_${tag}@example.com`, username: `an_${tag}`, password: "correcthorsebattery", displayName: `Analytics ${tag}` };
  const r = await request("/api/v1/auth/signup", "POST", input);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  if (grant) await query(`INSERT INTO admin_grants(user_id, role, permissions) VALUES (:'id', 'ADMIN', :'p'::jsonb)`, { id: r.body.user.id, p: JSON.stringify(grant) });
  return { id: r.body.user.id as string, username: input.username, input, auth: { Authorization: `Bearer ${r.body.tokens.accessToken}` } };
}
type Account = Awaited<ReturnType<typeof account>>;
async function photo(owner: Account): Promise<string> {
  const r = await fetch(base + "/api/v1/media/photos", { method: "POST", headers: { ...owner.auth, "Content-Type": "image/png" }, body: buildTestPng(4, 4) });
  assert.equal(r.status, 201);
  return ((await r.json()) as { media: { id: string } }).media.id;
}
async function publish(owner: Account): Promise<string> {
  const r = await request("/api/v1/stories", "POST", { mediaId: await photo(owner) }, owner.auth);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return (r.body.story?.id ?? r.body.id) as string;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function ok(promise: Promise<{ status: number; body: any }>, expected = [200, 201, 204]) {
  const r = await promise;
  assert.ok(expected.includes(r.status), `${r.status} ${JSON.stringify(r.body)}`);
  return r;
}
const activeDays = (user: string) =>
  query(`SELECT day::text AS day, platform FROM analytics_active_days WHERE user_id = :'u' ORDER BY day, platform`, { u: user });
/** Activity is written after the response, in the background. */
async function waitForActiveDays(user: string, count: number) {
  for (let i = 0; i < 100; i++) {
    const rows = await activeDays(user);
    if (rows.length >= count) return rows;
    await new Promise((r) => setTimeout(r, 20));
  }
  return activeDays(user);
}
const todayUtc = async () => String((await queryOne(`SELECT (now() AT TIME ZONE 'UTC')::date::text AS d`))?.d);
const at = (day: string, time: string) => `${day} ${time}+00`;
async function setActive(user: string, day: string, platform: string) {
  await query(`INSERT INTO analytics_active_days (day, platform, user_id) VALUES (:'day'::date, :'p', :'u') ON CONFLICT DO NOTHING`, { day, p: platform, u: user });
}
async function appEvent(user: string, name: string, when: string, session: string | null = null, properties: object = {}) {
  await query(
    `INSERT INTO analytics_events (id, user_id, name, platform, session_id, properties, occurred_at)
     VALUES (gen_random_uuid(), :'u', :'n', 'android', ${session ? ":'s'::uuid" : "NULL"}, :'p'::jsonb, :'t'::timestamptz)`,
    { u: user, n: name, s: session ?? "", p: JSON.stringify(properties), t: when },
  );
}

describe("product analytics", () => {
  it("records each signed-in person as active once per day and platform, without Admin traffic or blocked accounts", async () => {
    const today = await todayUtc();
    const person = await account();
    for (let i = 0; i < 3; i++) await ok(request("/api/v1/auth/me", "GET", undefined, { ...person.auth, "X-Katkee-Platform": "ios" }));
    assert.deepEqual(await waitForActiveDays(person.id, 1), [{ day: today, platform: "ios" }]);
    await ok(request("/api/v1/auth/me", "GET", undefined, { ...person.auth, "X-Katkee-Platform": "Android" }));
    await ok(request("/api/v1/auth/me", "GET", undefined, { ...person.auth, "X-Katkee-Platform": "<script>" }));
    assert.deepEqual((await waitForActiveDays(person.id, 3)).map((r) => r.platform), ["android", "ios", "unknown"]);

    // Admin endpoints never count as consumer activity.
    const staff = await account();
    await request("/api/v1/admin/dashboard", "GET", undefined, { ...staff.auth, "X-Katkee-Platform": "android" });
    await ok(request("/api/v1/auth/me", "GET", undefined, { ...staff.auth, "X-Katkee-Platform": "web" }));
    await new Promise((r) => setTimeout(r, 150));
    assert.deepEqual((await waitForActiveDays(staff.id, 1)).map((r) => r.platform), ["web"]);

    // A suspended or deleted account is refused before anything is recorded.
    const blocked = await account();
    await query(`UPDATE users SET is_active = false WHERE id = :'id'`, { id: blocked.id });
    assert.equal((await request("/api/v1/auth/me", "GET", undefined, { ...blocked.auth, "X-Katkee-Platform": "ios" })).status, 403);
    await new Promise((r) => setTimeout(r, 150));
    assert.deepEqual(await activeDays(blocked.id), []);
  });

  it("stores app events once even when a batch is retried, keeping only allowlisted properties", async () => {
    analyticsIngestLimiter.reset();
    const person = await account();
    const session = randomUUID();
    const now = Date.now();
    const iso = (offsetMs: number) => new Date(now + offsetMs).toISOString();
    const started = { id: randomUUID(), name: "app_session_started", occurredAt: iso(-60_000), sessionId: session, properties: { coldStart: true, email: "x@example.com" } };
    const failed = { id: randomUUID(), name: "upload_failed", occurredAt: iso(-30_000), sessionId: session, properties: { mediaKind: "video", stage: "upload", reason: "network", attempts: 3, caption: "private words" } };
    const search = { id: randomUUID(), name: "search_performed", occurredAt: iso(-20_000), sessionId: session, properties: { query: "who I looked for" } };
    const skewed = { id: randomUUID(), name: "profile_viewed", occurredAt: iso(120_000), sessionId: session };
    const offline = { id: randomUUID(), name: "highlight_viewed", occurredAt: iso(-3 * 86_400_000), sessionId: null };
    const rejected = [
      { id: randomUUID(), name: "message_read", occurredAt: iso(0) },
      { id: randomUUID(), name: "profile_viewed", occurredAt: iso(-8 * 86_400_000) },
      { id: "not-a-uuid", name: "profile_viewed", occurredAt: iso(0) },
      { id: randomUUID(), name: "profile_viewed", occurredAt: iso(3_600_000) },
      { id: randomUUID(), name: "upload_failed", occurredAt: "yesterday" },
    ];
    const batch = { platform: "android", appVersion: "1.4.0", events: [started, failed, search, skewed, offline, started, ...rejected] };

    const first = await request("/api/v1/analytics/events", "POST", batch, person.auth);
    assert.deepEqual([first.status, first.body], [200, { accepted: 5, duplicates: 0, rejected: 5 }]);
    const retry = await request("/api/v1/analytics/events", "POST", batch, person.auth);
    assert.deepEqual(retry.body, { accepted: 0, duplicates: 5, rejected: 5 }, "a retried batch is never counted twice");

    const stored = await query(
      `SELECT name, platform, app_version, properties::text AS properties, session_id::text AS session, occurred_at <= now() AS not_future
       FROM analytics_events WHERE user_id = :'u' ORDER BY occurred_at`,
      { u: person.id },
    );
    assert.deepEqual(stored.map((e) => [e.name, e.properties]), [
      ["highlight_viewed", "{}"],
      ["app_session_started", '{"coldStart": true}'],
      ["upload_failed", '{"stage": "upload", "reason": "network", "attempts": 3, "mediaKind": "video"}'],
      ["search_performed", "{}"],
      ["profile_viewed", "{}"],
    ]);
    assert.ok(stored.every((e) => e.platform === "android" && e.app_version === "1.4.0" && e.not_future === "t"));
    assert.ok(!JSON.stringify(stored).includes("private words") && !JSON.stringify(stored).includes("x@example.com"));
    // An event queued offline marks the person active on the day it happened.
    const threeDaysAgo = String((await queryOne(`SELECT ((now() - interval '3 days') AT TIME ZONE 'UTC')::date::text AS d`))?.d);
    assert.ok((await activeDays(person.id)).some((r) => r.day === threeDaysAgo && r.platform === "android"));

    // Without a platform in the body, the request header is used.
    const fromHeader = await request("/api/v1/analytics/events", "POST", { events: [{ id: randomUUID(), name: "app_session_started", occurredAt: iso(0) }] }, { ...person.auth, "X-Katkee-Platform": "ios" });
    assert.equal(fromHeader.body.accepted, 1);
    assert.equal((await queryOne(`SELECT count(*) AS n FROM analytics_events WHERE user_id = :'u' AND platform = 'ios'`, { u: person.id }))?.n, "1");

    const tooMany = Array.from({ length: 51 }, () => ({ id: randomUUID(), name: "profile_viewed", occurredAt: iso(0) }));
    assert.equal((await request("/api/v1/analytics/events", "POST", { events: tooMany }, person.auth)).status, 422);
    assert.equal((await request("/api/v1/analytics/events", "POST", { events: [] }, person.auth)).status, 422);
    assert.equal((await request("/api/v1/analytics/events", "POST", batch)).status, 401);
  });

  it("aggregates a day exactly from real activity: users, Stories, engagement, DMs, app health and reports", async () => {
    const D = "2001-02-10";
    const [alice, bob, carol, dave, erin, frank] = await Promise.all([account(), account(), account(), account(), account(), account()]);
    const created: [Account, string][] = [[alice, "2001-01-01"], [bob, "2001-01-01"], [carol, D], [dave, "2001-01-15"], [erin, "2001-01-15"], [frank, "2001-01-01"]];
    for (const [who, day] of created) await query(`UPDATE users SET created_at = :'t' WHERE id = :'id'`, { t: at(day, "09:00"), id: who.id });

    // Activity: three people on D (Bob on two phones), Dave 3 days before, Erin 20 days
    // before, Frank 30 days before (just outside the monthly window), Alice the day after.
    for (const [who, day, platform] of [[alice, D, "android"], [bob, D, "ios"], [bob, D, "android"], [carol, D, "web"], [dave, "2001-02-07", "ios"],
      [erin, "2001-01-21", "unknown"], [frank, "2001-01-11", "android"], [alice, "2001-02-11", "android"]] as const) await setActive(who.id, day, platform);

    // Real Stories, views, likes, comments, shares, follows, DMs, a Highlight and a report,
    // made through the API now and then moved to D.
    const s1 = await publish(alice), s2 = await publish(alice);
    for (const [who, story] of [[bob, s1], [bob, s2], [carol, s1]] as const) await ok(request(`/api/v1/stories/${story}/view`, "POST", {}, who.auth));
    const story = (eventType: string, s: string, extra: object = {}) => ({ eventType, storyId: s, creatorId: alice.id, ...extra });
    for (const [who, event] of [
      [bob, story("story_complete", s1)], [bob, story("story_complete", s2)], [bob, story("story_replay", s1)], [bob, story("story_complete", s1)],
      [bob, story("watch_duration", s1, { valueMs: 4000 })], [carol, story("watch_duration", s1, { valueMs: 6000 })],
    ] as const) await ok(request("/api/v1/events", "POST", event, who.auth));
    await ok(request(`/api/v1/stories/${s1}/like`, "POST", {}, bob.auth));
    await ok(request(`/api/v1/stories/${s1}/comments`, "POST", { body: "Lovely light" }, carol.auth));
    await ok(request(`/api/v1/stories/${s2}/share`, "POST", {}, bob.auth));
    await ok(request(`/api/v1/users/${alice.username}/follow`, "POST", {}, bob.auth));
    const conversation = (await ok(request(`/api/v1/users/${alice.username}/conversation`, "POST", {}, bob.auth))).body;
    const conversationId = (conversation.conversation?.id ?? conversation.id) as string;
    for (const [who, text] of [[bob, "Hi there"], [bob, "Are you around?"], [alice, "Hello!"]] as const) {
      await ok(request(`/api/v1/conversations/${conversationId}/messages`, "POST", { body: text, clientMessageId: randomUUID() }, who.auth));
    }
    await ok(request("/api/v1/highlights", "POST", { title: "Winter", storyIds: [s1] }, alice.auth));
    await ok(request("/api/v1/reports", "POST", { targetType: "story", targetId: s2, reason: "spam" }, carol.auth));
    const failedMedia = await photo(alice);

    await query(`UPDATE stories SET created_at = :'t' WHERE owner_id = :'a'`, { t: at(D, "10:00"), a: alice.id });
    await query(`UPDATE story_views SET viewed_at = :'t' WHERE story_id IN (:'s1', :'s2')`, { t: at(D, "11:00"), s1, s2 });
    await query(`UPDATE recommendation_events SET created_at = :'t' WHERE viewer_id IN (:'b', :'c')`, { t: at(D, "11:30"), b: bob.id, c: carol.id });
    await query(`UPDATE story_likes SET created_at = :'t' WHERE story_id = :'s'`, { t: at(D, "11:40"), s: s1 });
    await query(`UPDATE story_comments SET created_at = :'t' WHERE story_id = :'s'`, { t: at(D, "11:45"), s: s1 });
    await query(`UPDATE story_shares SET created_at = :'t' WHERE story_id = :'s'`, { t: at(D, "11:50"), s: s2 });
    await query(`UPDATE follows SET created_at = :'t' WHERE follower_id = :'b'`, { t: at(D, "11:55"), b: bob.id });
    await query(
      `UPDATE messages m SET created_at = :'d'::date + x.t FROM (VALUES ('Hi there', time '12:00'), ('Are you around?', time '12:05'), ('Hello!', time '12:10')) x(body, t)
       WHERE m.conversation_id = :'c' AND m.body = x.body`,
      { d: D, c: conversationId },
    );
    // Alice's app confirmed delivery of Bob's first message only; Bob's confirmed Alice's reply.
    for (const [who, time] of [[alice, "12:01"], [bob, "12:15"]] as const) {
      await query(
        `INSERT INTO conversation_reads (conversation_id, user_id, last_delivered_at) VALUES (:'c', :'u', :'t')
         ON CONFLICT (conversation_id, user_id) DO UPDATE SET last_delivered_at = EXCLUDED.last_delivered_at`,
        { c: conversationId, u: who.id, t: at(D, time) },
      );
    }
    await query(`UPDATE highlights SET created_at = :'t' WHERE owner_id = :'a'`, { t: at(D, "13:00"), a: alice.id });
    await query(`UPDATE reports SET created_at = :'t' WHERE reporter_id = :'c'`, { t: at(D, "14:00"), c: carol.id });
    await query(`UPDATE media SET status = 'failed', created_at = :'t' WHERE id = :'m'`, { t: at(D, "15:00"), m: failedMedia });

    // What only the app can see: three sessions (one crashed), Stories started in the editor,
    // Highlight and profile views, a search and upload outcomes.
    const [sa, sb, sc] = [randomUUID(), randomUUID(), randomUUID()];
    for (const [who, s] of [[alice, sa], [bob, sb], [bob, sb], [carol, sc]] as const) await appEvent(who.id, "app_session_started", at(D, "08:00"), s);
    await appEvent(carol.id, "app_crash", at(D, "08:30"), sc, { fatal: true });
    for (const [who, name, n] of [[alice, "story_created", 2], [bob, "highlight_viewed", 1], [bob, "profile_viewed", 1], [carol, "profile_viewed", 1],
      [carol, "search_performed", 1], [alice, "upload_succeeded", 3], [alice, "upload_failed", 1]] as const) {
      for (let i = 0; i < n; i++) await appEvent(who.id, name, at(D, "09:30"));
    }
    // Noise outside D must not leak in.
    await appEvent(alice.id, "app_session_started", at("2001-02-11", "00:00"), randomUUID());
    await appEvent(alice.id, "upload_failed", at("2001-02-09", "23:59"));

    const metrics = (await queryOne(`SELECT analytics_rollup_day(:'d'::date, 'UTC')::text AS m`, { d: D }))?.m;
    const expected = {
      users: { dau: 3, wau: 4, mau: 5, returning: 2, registrations: 1, platforms: { android: 2, ios: 1, web: 1, unknown: 0 } },
      stories: { published: 2, activeCreators: 1, views: 3, viewers: 2, completions: 3, completedViews: 2, replays: 1, watchMs: 10000, watchSamples: 2, highlightsCreated: 1 },
      engagement: { likes: 1, comments: 1, shares: 1, follows: 1 },
      dms: { sent: 3, senders: 2, received: 2 },
      app: { sessions: 3, crashedSessions: 1, crashes: 1, storiesStarted: 2, highlightViews: 1, profileViews: 2, searches: 1, uploadsSucceeded: 3, uploadsFailed: 1, processingFailures: 1 },
      moderation: { reports: 1, resolved: 0 },
      ads: { requested: 0, rendered: 0, impressions: 0, qualifiedViews: 0, completions: 0, clicks: 0, hides: 0, reports: 0 },
    };
    assert.deepEqual(JSON.parse(String(metrics)), expected);
    assert.deepEqual(await storedDay(D), expected, "the day's totals are stored");
    assert.deepEqual(deriveRates(expected), {
      storiesPerViewer: 1.5, completionRate: 0.6667, averageWatchSeconds: 5, uploadSuccessRate: 0.75, crashFreeSessions: 0.6667,
      adClickRate: null, adCompletionRate: null, adHideRate: null, adReportRate: null,
    });
    // Recomputing replaces the day instead of adding to it.
    await query(`SELECT analytics_rollup_day(:'d'::date, 'UTC')`, { d: D });
    assert.deepEqual(await storedDay(D), expected);
  });

  it("computes D1, D7 and D30 retention by signup day, pending until the day has finished", async () => {
    const C = "2001-03-01";
    const [u1, u2, u3, u4, later] = await Promise.all([account(), account(), account(), account(), account()]);
    for (const who of [u1, u2, u3, u4]) await query(`UPDATE users SET created_at = :'t' WHERE id = :'id'`, { t: at(C, "08:00"), id: who.id });
    await query(`UPDATE users SET created_at = :'t' WHERE id = :'id'`, { t: at("2001-03-02", "08:00"), id: later.id });
    for (const [who, day] of [[u1, "2001-03-02"], [u1, "2001-03-08"], [u1, "2001-03-31"], [u2, "2001-03-02"], [u3, "2001-03-08"], [u4, C], [u2, "2001-03-03"], [later, "2001-03-02"]] as const) {
      await setActive(who.id, day, "android");
    }
    await query(`SELECT analytics_rollup_retention(:'c'::date, :'c'::date, 'UTC')`, { c: C });
    assert.deepEqual(await queryOne(`SELECT cohort_size, d1, d7, d30 FROM analytics_retention WHERE cohort_day = :'c'`, { c: C }), { cohort_size: "4", d1: "2", d7: "2", d30: "1" });

    const today = await todayUtc();
    await query(`SELECT analytics_rollup_retention(:'d'::date, :'d'::date, 'UTC')`, { d: today });
    const pending = await queryOne(`SELECT cohort_size::int > 0 AS has_people, d1, d7, d30 FROM analytics_retention WHERE cohort_day = :'d'`, { d: today });
    assert.deepEqual(pending, { has_people: "t", d1: null, d7: null, d30: null }, "today's signups have no retention yet");
  });

  it("shows Admins totals only, behind analytics.read, and refreshes on the worker's code path", async () => {
    const analyst = await account(["analytics.read"]);
    const moderator = await account(["reports.read"]);
    const ah = await adminSignIn(base, analyst.input.email, analyst.input.password);
    const mh = await adminSignIn(base, moderator.input.email, moderator.input.password);

    const refreshed = await request("/api/v1/admin/analytics/refresh", "POST", {}, ah);
    assert.equal(refreshed.status, 200, JSON.stringify(refreshed.body));
    assert.ok(refreshed.body.days >= 1);
    const overview = await request("/api/v1/admin/analytics?days=30", "GET", undefined, ah);
    assert.equal(overview.status, 200);
    const today = await todayUtc();
    assert.equal(overview.body.today, today);
    const todayRow = overview.body.daily.find((d: { day: string }) => d.day === today);
    assert.ok(todayRow, "today's totals exist after a refresh");
    assert.ok(todayRow.metrics.users.dau >= 1 && overview.body.live.dau >= todayRow.metrics.users.dau);
    assert.equal(overview.body.live.mau >= overview.body.live.wau && overview.body.live.wau >= overview.body.live.dau, true);
    for (const key of ["open", "underReview", "appealed", "appealsOpen"]) assert.equal(typeof overview.body.backlog[key], "number", key);
    assert.ok(overview.body.retention.every((c: { cohortSize: number }) => c.cohortSize > 0));
    assert.ok("crashFreeSessions" in overview.body.period.rates && "uploadSuccessRate" in overview.body.period.rates);

    // Aggregates only: no person is identifiable from the dashboard.
    const people = await query(`SELECT id::text, username::text, email::text FROM users`);
    const payload = JSON.stringify(overview.body);
    for (const p of people) for (const v of [p.id, p.username, p.email]) assert.ok(!v || !payload.includes(String(v)), `dashboard leaked ${v}`);

    assert.equal((await request("/api/v1/admin/analytics", "GET", undefined, mh)).status, 403);
    assert.equal((await request("/api/v1/admin/analytics/refresh", "POST", {}, mh)).status, 403);
    assert.equal((await request("/api/v1/admin/analytics", "GET", undefined, analyst.auth)).status, 401, "consumer tokens never reach Admin data");
  });

  it("the worker fills in today and purges raw data past retention, keeping the daily totals", async () => {
    const person = await account();
    await appEvent(person.id, "app_session_started", new Date(Date.now() - 100 * 86_400_000).toISOString(), randomUUID());
    await appEvent(person.id, "app_session_started", new Date().toISOString(), randomUUID());
    await query(`INSERT INTO analytics_active_days (day, platform, user_id) VALUES ((now() AT TIME ZONE 'UTC')::date - 100, 'ios', :'u')`, { u: person.id });
    const before = await queryOne(`SELECT count(*) AS n FROM analytics_daily`);

    assert.ok((await rollupAnalytics()) >= 1);
    const removed = await purgeRawAnalytics(10, 40);
    assert.ok(removed >= 2, `removed ${removed}`);
    assert.equal((await queryOne(`SELECT count(*) AS n FROM analytics_events WHERE user_id = :'u'`, { u: person.id }))?.n, "1", "recent events stay");
    assert.equal((await queryOne(`SELECT count(*) AS n FROM analytics_events WHERE occurred_at < now() - interval '40 days'`))?.n, "0");
    assert.equal((await queryOne(`SELECT count(*) AS n FROM analytics_active_days WHERE day < (now() AT TIME ZONE 'UTC')::date - 40`))?.n, "0");
    assert.ok(Number((await queryOne(`SELECT count(*) AS n FROM analytics_daily`))?.n) >= Number(before?.n), "daily totals are kept");
    assert.ok(await storedDay("2001-02-10"), "an old day's totals survive the purge");
  });
});
