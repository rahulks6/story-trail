// The invite contest (src/modules/growth/contest.ts): a friend counts for their inviter only after
// using Katkee on 3 different days; suspended, test, staff and Katkee's own accounts don't take
// part; the leaderboard, your place and friends' progress; and the pushes that go with it.
import "./admin-env";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { buildApp } from "../src/app";
import { query, queryOne } from "../src/db/psql";
import { queueContestPushes } from "../src/modules/growth/contest";
import { renderPush } from "../src/modules/push/dispatcher";
import { authHeader, makeClient, uniqueUser } from "./helpers";
import { adminSignIn } from "./adminSession";

const server = buildApp();
let baseUrl: string;
let client: ReturnType<typeof makeClient>;
let contestId: string;

before(async () => {
  await new Promise<void>((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  client = makeClient(baseUrl);
  // A contest running now, and only that one: the real one from the migration (from 23 Nov
  // 2026) is left out of this file's own database so the dates don't depend on today.
  await query(`DELETE FROM invite_contests`);
  contestId = (await queryOne(
    `INSERT INTO invite_contests (slug, prize_minor, starts_at, ends_at, counts_until)
     VALUES ('test-contest', 100000, now() - interval '10 days', now() + interval '10 days', now() + interval '13 days') RETURNING id`,
  ))!.id as string;
});
after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

interface Person { id: string; username: string; email: string; password: string; token: string }
async function person(): Promise<Person> {
  const input = uniqueUser();
  const res = await client.post("/api/v1/auth/signup", input);
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return { ...input, id: res.body.user.id as string, token: res.body.tokens.accessToken as string };
}
async function invite(inviter: Person): Promise<Person> {
  const code = (await client.get("/api/v1/invites/me", authHeader(inviter.token))).body.invite.code as string;
  const friend = await person();
  assert.equal((await client.post("/api/v1/invites/redeem", { code }, authHeader(friend.token))).body.status, "redeemed");
  return friend;
}
/** The friend used Katkee on `days` different days, today and the days before. */
async function activeOn(who: Person, days: number) {
  await query(
    `INSERT INTO analytics_active_days (day, platform, user_id)
     SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date - n, 'android', :'id' FROM generate_series(0, :'days'::int - 1) n
     ON CONFLICT DO NOTHING`,
    { id: who.id, days },
  );
  // Joined before those days, so all of them count.
  await query(`UPDATE invite_redemptions SET created_at = now() - make_interval(days => :'days'::int) WHERE invitee_id = :'id'`, { id: who.id, days });
}
const contest = async (who: Person) => {
  const res = await client.get("/api/v1/contest", authHeader(who.token));
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body.contest;
};

describe("Invite contest", () => {
  it("counts a friend after 3 different days, ranks inviters and shows your friends' progress", async () => {
    const [asha, ravi] = [await person(), await person()];
    const [a1, a2, a3] = [await invite(asha), await invite(asha), await invite(asha)];
    const r1 = await invite(ravi);
    await activeOn(a1, 3);
    await activeOn(a2, 5);
    await activeOn(a3, 2); // not yet
    await activeOn(r1, 3);

    const mine = await contest(asha);
    assert.equal(mine.state, "running");
    assert.deepEqual(mine.prize, { amountMinor: 100000, currency: "INR", kind: "amazon_voucher" });
    assert.equal(mine.rulesUrl, "https://katkee.com/contest");
    assert.deepEqual({ counted: mine.me.counted, pending: mine.me.pending, rank: mine.me.rank, toFirst: mine.me.toFirst }, { counted: 2, pending: 1, rank: 1, toFirst: 0 });
    const progress = Object.fromEntries(mine.me.friends.map((f: { username: string; activeDays: number; counted: boolean }) => [f.username, [f.activeDays, f.counted]]));
    assert.deepEqual(progress, { [a1.username]: [3, true], [a2.username]: [3, true], [a3.username]: [2, false] });
    assert.deepEqual(mine.leaders.map((l: { username: string; counted: number; rank: number }) => [l.username, l.counted, l.rank]), [[asha.username, 2, 1], [ravi.username, 1, 2]]);

    const his = await contest(ravi);
    assert.equal(his.me.rank, 2);
    assert.equal(his.me.toFirst, 2, "two more friends to be first alone");
    const newcomer = await contest(await person());
    assert.deepEqual({ counted: newcomer.me.counted, rank: newcomer.me.rank, toFirst: newcomer.me.toFirst }, { counted: 0, rank: null, toFirst: 3 });
  });

  it("leaves out suspended friends, test accounts, staff and friends from before the contest", async () => {
    const inviter = await person();
    const [ok, suspended, early] = [await invite(inviter), await invite(inviter), await invite(inviter)];
    for (const f of [ok, suspended, early]) await activeOn(f, 3);
    await query(`UPDATE users SET moderation_state = 'SUSPENDED' WHERE id = :'id'`, { id: suspended.id });
    await query(`UPDATE invite_redemptions SET created_at = now() - interval '30 days' WHERE invitee_id = :'id'`, { id: early.id });
    assert.equal((await contest(inviter)).me.counted, 1);

    const staff = await person();
    await activeOn(await invite(staff), 3);
    await query(`INSERT INTO admin_grants(user_id, role, permissions) VALUES (:'id', 'ADMIN', '["users.view"]'::jsonb)`, { id: staff.id });
    const view = await contest(staff);
    assert.equal(view.me.counted, 0, "staff can't take part");
    assert.ok(!view.leaders.some((l: { username: string }) => l.username === staff.username));

    // Staff check the people taking part, friend by friend, before sending the prize.
    const admin = await adminSignIn(baseUrl, staff.email, staff.password);
    const review = await fetch(`${baseUrl}/api/v1/admin/contest`, { headers: admin });
    assert.equal(review.status, 200);
    const people = ((await review.json()) as { people: Array<{ username: string; counted: number; friends: Array<{ username: string; activeDays: number }> }> }).people;
    const row = people.find((p) => p.username === inviter.username);
    assert.equal(row?.counted, 1);
    assert.deepEqual(row?.friends.map((f) => f.username), [ok.username], "suspended and earlier friends aren't listed");
    assert.equal((await fetch(`${baseUrl}/api/v1/admin/contest`, { headers: authHeader(inviter.token) })).status >= 400, true);
  });

  it("is only shown in English, Hindi and Marathi, and needs sign-in", async () => {
    const abroad = await person();
    await query(`UPDATE users SET locale = 'de' WHERE id = :'id'`, { id: abroad.id });
    assert.equal(await contest(abroad), null);
    assert.equal((await client.get("/api/v1/contest")).status, 401);
  });

  it("tells inviters when a friend counts, once, and announces the contest once from announce_at", async () => {
    const inviter = await person();
    await query(`INSERT INTO push_devices (user_id, provider, platform, token) VALUES (:'id', 'fcm', 'android', :'token')`, { id: inviter.id, token: `test-token-${inviter.id}` });
    const friend = await invite(inviter);
    await activeOn(friend, 3);
    const noon = new Date();
    noon.setUTCHours(6, 30); // 12:00 in India
    await queueContestPushes(noon);
    await queueContestPushes(noon);
    const counted = await query(`SELECT id, actor_id, params, body FROM push_outbox WHERE user_id = :'id' AND kind = 'contest_counted'`, { id: inviter.id });
    assert.equal(counted.length, 1);
    assert.equal(counted[0]!.actor_id, friend.id);

    const rendered = await renderPush({ id: counted[0]!.id as string, userId: inviter.id, kind: "contest_counted", actorId: friend.id, refId: null, attempts: 0, body: String(counted[0]!.body), link: "katkee://contest", params: JSON.parse(String(counted[0]!.params)) });
    assert.ok("message" in rendered, JSON.stringify(rendered));
    assert.match(JSON.stringify(rendered.message), new RegExp(`@${friend.username} now counts for you in the invite contest 🏆 1 so far`));

    assert.equal((await query(`SELECT 1 FROM push_outbox WHERE kind = 'invite_contest'`)).length, 0, "no announcement before announce_at");
    await query(`UPDATE invite_contests SET announce_at = now() - interval '1 day' WHERE id = :'id'`, { id: contestId });
    await queueContestPushes(noon);
    await queueContestPushes(noon);
    const announced = await query(`SELECT 1 FROM push_outbox WHERE kind = 'invite_contest' AND user_id = :'id'`, { id: inviter.id });
    assert.equal(announced.length, 1);
  });
});
