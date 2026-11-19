import "./env";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { buildApp } from "../src/app";
import { query, queryOne } from "../src/db/psql";
import { authHeader, makeClient, uniqueUser } from "./helpers";
import { welcomeNewPeople } from "../src/modules/growth/official";
import { DAILY_THEMES, queueDailyThemePushes, themeForDate, indiaDate } from "../src/modules/themes/daily-themes";
import { pushOnlyText } from "../src/modules/push/push-text";
import { LOCALES } from "../src/shared/locale";

let client: ReturnType<typeof makeClient>;
const server = buildApp();

before(async () => {
  await new Promise<void>((resolve) => server.listen(0, resolve));
  client = makeClient(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
});
after(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); });

async function person(opts: { private?: boolean } = {}) {
  const input = uniqueUser();
  const res = await client.post("/api/v1/auth/signup", input);
  const p = { input, token: res.body.tokens.accessToken as string, id: res.body.user.id as string };
  if (opts.private) await client.patch("/api/v1/users/me", { isPrivate: true }, authHeader(p.token));
  return p;
}
const follows = async (a: string, b: string) =>
  (await queryOne(`SELECT 1 AS x FROM follows WHERE follower_id = :'a' AND followee_id = :'b'`, { a, b })) !== null;
async function withDevice(id: string) {
  await query(`INSERT INTO push_devices (user_id, provider, platform, token) VALUES (:'u', 'fcm', 'android', :'t')`, { u: id, t: `token-${id}-0123456789` });
}

describe("Katkee's own account", () => {
  let official: Awaited<ReturnType<typeof person>>;
  before(async () => {
    official = await person();
    await query(`UPDATE users SET is_official = true WHERE id = :'id'`, { id: official.id });
  });

  it("follows new public people once, with a follow in their Activity, and never private or test accounts", async () => {
    const a = await person();
    const hidden = await person({ private: true });
    const test = await person();
    await query(`UPDATE users SET email = 'support+e2e-official-test@katkee.com' WHERE id = :'id'`, { id: test.id });
    await welcomeNewPeople();
    assert.equal(await follows(official.id, a.id), true);
    assert.equal(await follows(official.id, hidden.id), false);
    assert.equal(await follows(official.id, test.id), false);
    assert.equal(await follows(a.id, official.id), false, "nobody is made to follow it");
    const activity = await client.get("/api/v1/notifications", authHeader(a.token));
    assert.ok(activity.body.notifications.some((n: { type: string; actor: { username: string } }) => n.type === "follow" && n.actor.username === official.input.username));

    // Removed as a follower: not followed again.
    await query(`DELETE FROM follows WHERE follower_id = :'o' AND followee_id = :'a'`, { o: official.id, a: a.id });
    await welcomeNewPeople();
    assert.equal(await follows(official.id, a.id), false);
  });

  it("is suggested first to people who don't follow it, and not once they do", async () => {
    const a = await person();
    const res = await client.get("/api/v1/search/suggestions", authHeader(a.token));
    assert.equal(res.body.suggestions[0]?.username, official.input.username);
    assert.deepEqual(res.body.suggestions[0]?.reason, { kind: "official" });
    await client.post(`/api/v1/users/${official.input.username}/follow`, {}, authHeader(a.token));
    const after = await client.get("/api/v1/search/suggestions", authHeader(a.token));
    assert.ok(!after.body.suggestions.some((s: { username: string }) => s.username === official.input.username));
  });

  it("only one account can be official", async () => {
    const other = await person();
    await assert.rejects(query(`UPDATE users SET is_official = true WHERE id = :'id'`, { id: other.id }));
  });

  it("founding spots: how many of the first 1,000 are taken", async () => {
    const a = await person();
    const res = await client.get("/api/v1/founding", authHeader(a.token));
    assert.equal(res.status, 200);
    assert.equal(res.body.total, 1000);
    assert.ok(res.body.taken >= 1 && res.body.left === 1000 - res.body.taken);
  });
});

describe("Today's theme", () => {
  // A festival's first day has its own greeting instead; keep today an ordinary day here.
  before(async () => { await query(`DELETE FROM festivals WHERE starts_on = (now() AT TIME ZONE 'Asia/Kolkata')::date`); });
  it("one theme a day, the same for everyone, cycling through the list", () => {
    assert.equal(themeForDate("2026-11-20").slug, themeForDate("2026-11-20").slug);
    const seen = new Set(Array.from({ length: DAILY_THEMES.length }, (_, i) => themeForDate(new Date(Date.UTC(2026, 10, 1 + i)).toISOString().slice(0, 10)).slug));
    assert.equal(seen.size, DAILY_THEMES.length);
    for (const t of DAILY_THEMES) for (const l of LOCALES) assert.ok(t.title[l].length > 0, `${t.slug} ${l}`);
  });

  it("Home gets today's theme in the person's language, and whether they've posted", async () => {
    const a = await person();
    await query(`UPDATE users SET locale = 'hi' WHERE id = :'id'`, { id: a.id });
    const res = await client.get("/api/v1/themes/today", authHeader(a.token));
    const theme = themeForDate(indiaDate());
    assert.equal(res.body.slug, theme.slug);
    assert.equal(res.body.title, theme.title.hi);
    assert.equal(res.body.postedToday, false);
  });

  it("the evening reminder: only to people who haven't posted, never twice a day, at most 3 a week", async () => {
    // Only these two have a phone to send to; other tests' people have none.
    const a = await person();
    await withDevice(a.id);
    await query(`UPDATE users SET locale = 'mr' WHERE id = :'id'`, { id: a.id });
    const before = await queueDailyThemePushes();
    assert.ok(before >= 1);
    const queued = await query(`SELECT user_id, params FROM push_outbox WHERE kind = 'daily_theme'`);
    assert.ok(queued.some((r) => r.user_id === a.id));
    assert.equal(await queueDailyThemePushes(), 0, "never twice the same day");
    // The text is in the person's language.
    const slug = themeForDate(indiaDate()).slug;
    assert.ok(pushOnlyText("daily_theme", { slug }, "mr", null)?.includes(themeForDate(indiaDate()).title.mr));
    // A week with three already: no more.
    await query(`DELETE FROM push_sent WHERE user_id = :'a' AND kind = 'daily_theme'`, { a: a.id });
    for (const d of ["2000-01-01", "2000-01-02", "2000-01-03"]) {
      await query(`INSERT INTO push_sent (user_id, kind, ref_key, sent_at) VALUES (:'a', 'daily_theme', :'d', now() - interval '1 day')`, { a: a.id, d });
    }
    await queueDailyThemePushes();
    assert.equal((await query(`SELECT 1 FROM push_sent WHERE user_id = :'a' AND kind = 'daily_theme' AND ref_key = :'d'`, { a: a.id, d: indiaDate() })).length, 0);
  });

  it("no theme reminder for someone who heard a streak or nudge today", async () => {
    const a = await person();
    await withDevice(a.id);
    await query(`INSERT INTO push_sent (user_id, kind, ref_key) VALUES (:'a', 'nudge', 'x')`, { a: a.id });
    await queueDailyThemePushes();
    assert.equal((await query(`SELECT 1 FROM push_sent WHERE user_id = :'a' AND kind = 'daily_theme'`, { a: a.id })).length, 0);
  });
});
