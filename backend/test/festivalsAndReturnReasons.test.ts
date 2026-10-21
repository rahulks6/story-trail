import "./env";
import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { buildApp } from "../src/app";
import { authHeader, makeClient, uniqueUser } from "./helpers";
import { buildTestPng } from "./fixtures";
import { query, queryOne } from "../src/db/psql";
import { renderPush } from "../src/modules/push/dispatcher";
import {
  NEW_STORY_DAILY_CAP, hourInIndia, queueFestivalGreetings, queueNudges, queueStreakReminders, queueViewMilestones, runReturnReasons,
} from "../src/modules/reminders/return-reasons";

let client: ReturnType<typeof makeClient>;
let baseUrl: string;
const server = buildApp();
const TODAY = "(now() AT TIME ZONE 'Asia/Kolkata')::date";

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
async function publish(owner: User, extra: Record<string, unknown> = {}): Promise<string> {
  const upload = await fetch(`${baseUrl}/api/v1/media/photos`, { method: "POST", headers: { "Content-Type": "image/png", ...authHeader(owner.token) }, body: buildTestPng(4, 4) });
  const mediaId = ((await upload.json()) as { media: { id: string } }).media.id;
  const res = await client.post("/api/v1/stories", { mediaId, caption: "", audience: "public", allowComments: "everyone", allowSharing: true, ...extra }, authHeader(owner.token));
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.story.id as string;
}
const follow = (a: User, b: User) => client.post(`/api/v1/users/${b.username}/follow`, undefined, authHeader(a.token));
const phone = (u: User) => client.post("/api/v1/push/devices", { provider: "fcm", platform: "android", token: `tok-${u.id}-abcdefghijklmnop` }, authHeader(u.token));
const outbox = (u: User, kind: string) => query(`SELECT kind, actor_id, ref_id, body, link FROM push_outbox WHERE user_id = :'u' AND kind = :'k' ORDER BY id`, { u: u.id, k: kind });
const setPrefs = (u: User, prefs: Record<string, boolean>) => client.patch("/api/v1/notifications/preferences", prefs, authHeader(u.token));

describe("festivals", () => {
  beforeEach(async () => {
    // A known calendar: a two-day festival today, another next month.
    await query(`DELETE FROM festivals`);
    await query(
      `INSERT INTO festivals (slug, name, emoji, greeting, starts_on, ends_on) VALUES
         ('test-diwali', 'Diwali', '🪔', 'Happy Diwali', ${TODAY}, ${TODAY} + 1),
         ('test-holi', 'Holi', '🎨', 'Happy Holi', ${TODAY} + 30, ${TODAY} + 30)`,
    );
  });

  it("names today's festival and gathers its public Stories, never private, followers-only or blocked ones", async () => {
    const viewer = await signup();
    const pub = await signup();
    const priv = await signup();
    const blocked = await signup();
    await publish(pub, { festival: "test-diwali" });
    await publish(pub, { festival: "test-diwali" });
    await publish(viewer, { festival: "test-diwali" });
    await client.patch("/api/v1/users/me", { isPrivate: true }, authHeader(priv.token));
    await publish(priv, { festival: "test-diwali" });
    await publish(blocked, { festival: "test-diwali" });
    await client.post(`/api/v1/users/${blocked.username}/block`, undefined, authHeader(viewer.token));
    const followersOnly = await signup();
    await publish(followersOnly, { festival: "test-diwali", audience: "followers" });

    const r = await client.get("/api/v1/festivals/current", authHeader(viewer.token));
    assert.equal(r.status, 200);
    assert.equal(r.body.festival.slug, "test-diwali");
    assert.equal(r.body.festival.greeting, "Happy Diwali");
    assert.deepEqual(r.body.creators, [viewer.username, pub.username], "your own first, then others; never private, blocked or followers-only");
    assert.equal(r.body.storyCount, 3);
  });

  it("only a current festival can be tagged; anything else publishes untagged", async () => {
    const u = await signup();
    const ok = await publish(u, { festival: "test-diwali" });
    const later = await publish(u, { festival: "test-holi" });
    const unknown = await publish(u, { festival: "no-such-fest" });
    const rows = await query(`SELECT id, festival FROM stories WHERE id IN (:'a', :'b', :'c')`, { a: ok, b: later, c: unknown });
    const tag = Object.fromEntries(rows.map((r) => [r.id, r.festival]));
    assert.equal(tag[ok], "test-diwali");
    assert.equal(tag[later], null);
    assert.equal(tag[unknown], null);
  });

  it("with no festival today, says which comes next", async () => {
    await query(`DELETE FROM festivals WHERE slug = 'test-diwali'`);
    const u = await signup();
    const r = await client.get("/api/v1/festivals/current", authHeader(u.token));
    assert.equal(r.body.festival, null);
    assert.equal(r.body.next.slug, "test-holi");
  });

  it("greets everyone once on a festival's first day, unless reminders are off", async () => {
    const a = await signup();
    const off = await signup();
    const noPhone = await signup();
    await phone(a);
    await phone(off);
    await setPrefs(off, { remindersEnabled: false });
    await queueFestivalGreetings();
    await queueFestivalGreetings();
    const sent = await outbox(a, "festival");
    assert.equal(sent.length, 1, "once per festival");
    assert.equal(sent[0]!.body, "🪔 Happy Diwali! Share your Diwali Story on Katkee");
    assert.equal(sent[0]!.link, "katkee://home");
    assert.equal((await outbox(off, "festival")).length, 0);
    assert.equal((await outbox(noPhone, "festival")).length, 0);
  });
});

describe("reasons to come back", () => {
  it("tells followers who can see it that you posted, once a day per person", async () => {
    const owner = await signup();
    const fan = await signup();
    const muted = await signup();
    const stranger = await signup();
    await follow(fan, owner);
    await follow(muted, owner);
    await setPrefs(muted, { storiesEnabled: false });
    const first = await publish(owner);
    await publish(owner);
    const pushes = await outbox(fan, "new_story");
    assert.equal(pushes.length, 1, "one push for that person today");
    assert.equal(pushes[0]!.ref_id, first);
    assert.equal((await outbox(muted, "new_story")).length, 0);
    assert.equal((await outbox(stranger, "new_story")).length, 0);
    const rendered = await renderPush({ id: "x", userId: fan.id, kind: "new_story", actorId: owner.id, refId: first, attempts: 1 });
    assert.ok("message" in rendered && rendered.message.body === `@${owner.username} posted a new Story`);
    assert.ok("message" in rendered && rendered.message.data.url === `katkee://story/${first}`);
  });

  it(`never more than ${NEW_STORY_DAILY_CAP} new-Story pushes a day, and Close Friends Stories only reach the list`, async () => {
    const fan = await signup();
    for (let i = 0; i < NEW_STORY_DAILY_CAP + 2; i++) {
      const poster = await signup();
      await follow(fan, poster);
      await publish(poster);
    }
    assert.equal((await outbox(fan, "new_story")).length, NEW_STORY_DAILY_CAP);

    const owner = await signup();
    const friend = await signup();
    const other = await signup();
    await follow(friend, owner);
    await follow(other, owner);
    await client.put(`/api/v1/close-friends/${friend.username}`, undefined, authHeader(owner.token));
    await publish(owner, { audience: "close_friends" });
    assert.equal((await outbox(friend, "new_story")).length, 1);
    assert.equal((await outbox(other, "new_story")).length, 0);
  });

  it("celebrates view milestones once each", async () => {
    const owner = await signup();
    const story = await publish(owner);
    const viewers = [];
    for (let i = 0; i < 10; i++) viewers.push(await signup());
    for (const v of viewers) await query(`INSERT INTO story_views (story_id, viewer_id) VALUES (:'s', :'v')`, { s: story, v: v.id });
    await queueViewMilestones();
    await queueViewMilestones();
    const sent = await outbox(owner, "story_milestone");
    assert.equal(sent.length, 1);
    assert.equal(sent[0]!.body, "Your Story reached 10 views 🎉");
    assert.equal(sent[0]!.link, `katkee://story/${story}`);
    const rendered = await renderPush({ id: "x", userId: owner.id, kind: "story_milestone", actorId: null, refId: story, attempts: 1, body: sent[0]!.body, link: sent[0]!.link });
    assert.ok("message" in rendered && rendered.message.body === "Your Story reached 10 views 🎉");
    await setPrefs(owner, { milestonesEnabled: false });
    const off = await renderPush({ id: "x", userId: owner.id, kind: "story_milestone", actorId: null, refId: story, attempts: 1, body: "x", link: null });
    assert.deepEqual(off, { skip: "story_milestone pushes turned off" });
  });

  it("counts your posting streak in days, and reminds you in the evening to keep it", async () => {
    const u = await signup();
    await phone(u);
    const a = await publish(u);
    const b = await publish(u);
    const c = await publish(u);
    // Yesterday and the two days before; nothing yet today.
    for (const [id, days] of [[a, 1], [b, 2], [c, 3]] as const) {
      await query(`UPDATE stories SET created_at = now() - make_interval(days => :'d'::integer) WHERE id = :'id'`, { id, d: days });
    }
    const streak = await client.get("/api/v1/stories/streak", authHeader(u.token));
    assert.deepEqual(streak.body.streak, { days: 3, postedToday: false });
    await queueStreakReminders();
    await queueStreakReminders();
    const sent = await outbox(u, "streak");
    assert.equal(sent.length, 1);
    assert.equal(sent[0]!.body, "🔥 Keep your 3-day streak going: post a Story today");

    await publish(u);
    assert.deepEqual((await client.get("/api/v1/stories/streak", authHeader(u.token))).body.streak, { days: 4, postedToday: true });
  });

  it("others see your streak on your profile, unless your account is private and they don't follow you", async () => {
    const poster = await signup();
    const viewer = await signup();
    const story = await publish(poster);
    await query(`UPDATE stories SET created_at = now() - interval '1 day' WHERE id = :'id'`, { id: story });
    await publish(poster);
    const seen = await client.get(`/api/v1/users/${poster.username}`, authHeader(viewer.token));
    assert.deepEqual(seen.body.profile.streak, { days: 2, postedToday: true });
    await client.patch("/api/v1/users/me", { isPrivate: true }, authHeader(poster.token));
    assert.equal((await client.get(`/api/v1/users/${poster.username}`, authHeader(viewer.token))).body.profile.streak, null);
    assert.deepEqual((await client.get(`/api/v1/users/${poster.username}`, authHeader(poster.token))).body.profile.streak, { days: 2, postedToday: true }, "always to yourself");
  });

  it("nudges after a few quiet days, at most weekly", async () => {
    const quiet = await signup();
    const active = await signup();
    await phone(quiet);
    await phone(active);
    await query(`UPDATE users SET created_at = now() - interval '5 days' WHERE id IN (:'a', :'b')`, { a: quiet.id, b: active.id });
    await publish(active);
    await queueNudges();
    await queueNudges();
    const sent = await outbox(quiet, "nudge");
    assert.equal(sent.length, 1);
    assert.match(sent[0]!.body as string, /first Story/);
    assert.equal((await outbox(active, "nudge")).length, 0, "posted recently");
  });

  it("runs festival greetings by day and reminders only in the evening, India time", async () => {
    assert.equal(hourInIndia(new Date("2026-10-20T03:30:00Z")), 9);
    const night = await runReturnReasons(new Date("2026-10-20T18:00:00Z")); // 23:30 in India
    assert.deepEqual(Object.keys(night), ["milestones"]);
    const evening = await runReturnReasons(new Date("2026-10-20T13:30:00Z")); // 19:00
    assert.deepEqual(Object.keys(evening).sort(), ["festival", "milestones", "nudge", "streak"]);
  });

  it("the new switches are saved with the others", async () => {
    const u = await signup();
    const r = await setPrefs(u, { storiesEnabled: false, milestonesEnabled: true, remindersEnabled: false });
    assert.equal(r.status, 200);
    assert.equal(r.body.preferences.storiesEnabled, false);
    assert.equal(r.body.preferences.remindersEnabled, false);
    const row = await queryOne(`SELECT stories_enabled, reminders_enabled FROM notification_preferences WHERE user_id = :'u'`, { u: u.id });
    assert.deepEqual(row, { stories_enabled: "f", reminders_enabled: "f" });
  });
});
