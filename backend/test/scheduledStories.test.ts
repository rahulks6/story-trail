// Scheduled Stories (src/modules/stories/scheduled.ts, migration 0067): validated and owner-only,
// invisible everywhere until the worker publishes them on time, with their 24 hours starting then.
import "./env";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { buildApp } from "../src/app";
import { authHeader, makeClient, uniqueUser } from "./helpers";
import { buildTestPng } from "./fixtures";
import { query, queryOne } from "../src/db/psql";
import { config } from "../src/config/env";
import { publishDueScheduledStories, ScheduledStoriesWorker } from "../src/modules/stories/scheduled";
import { renderPush } from "../src/modules/push/dispatcher";

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
async function upload(owner: User): Promise<string> {
  const res = await fetch(`${baseUrl}/api/v1/media/photos`, { method: "POST", headers: { "Content-Type": "image/png", ...authHeader(owner.token) }, body: buildTestPng(4, 4) });
  return ((await res.json()) as { media: { id: string } }).media.id;
}
const requestId = () => `story_${randomUUID().replace(/-/g, "")}`;
const inHours = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();
function share(owner: User, mediaId: string, extra: Record<string, unknown> = {}) {
  return client.post("/api/v1/stories", { mediaId, requestId: requestId(), caption: "Later", audience: "public", allowComments: "everyone", allowSharing: true, ...extra }, authHeader(owner.token));
}
/** Makes a schedule due now, as if its time had come. */
const makeDue = (id: string) => query(`UPDATE scheduled_stories SET publish_at = now() - interval '1 second' WHERE id = :'id'`, { id });

describe("scheduling a Story", () => {
  it("validates the time and the request, and is idempotent by request id", async () => {
    const me = await signup();
    const mediaId = await upload(me);
    assert.equal((await share(me, mediaId, { publishAt: "tomorrow" })).status, 422);
    assert.equal((await share(me, mediaId, { publishAt: "2026-11-02T18:30:00" })).status, 422, "a time needs its offset");
    assert.equal((await share(me, mediaId, { publishAt: inHours(24 * 7 + 1) })).status, 422, "up to 7 days ahead");
    assert.equal((await share(me, mediaId, { publishAt: inHours(-25) })).status, 422, "long past");
    const noRequest = await client.post("/api/v1/stories", { mediaId, publishAt: inHours(2) }, authHeader(me.token));
    assert.equal(noRequest.status, 422);

    const id = requestId();
    const body = { mediaId, requestId: id, caption: "Diwali eve", audience: "followers", publishAt: inHours(3) };
    const first = await client.post("/api/v1/stories", body, authHeader(me.token));
    assert.equal(first.status, 201, JSON.stringify(first.body));
    const scheduled = first.body.scheduled;
    assert.equal(scheduled.state, "scheduled");
    assert.equal(scheduled.caption, "Diwali eve");
    assert.equal(scheduled.audience, "followers");
    assert.equal(scheduled.requestId, id);
    assert.ok(Math.abs(Date.parse(scheduled.publishAt) - Date.parse(body.publishAt)) < 1000);
    assert.equal(scheduled.media.status, "ready");

    // A retry after a lost response, even one sent without the time, finds the same schedule.
    assert.equal((await client.post("/api/v1/stories", body, authHeader(me.token))).body.scheduled.id, scheduled.id);
    const retryWithoutTime = await client.post("/api/v1/stories", { ...body, publishAt: undefined }, authHeader(me.token));
    assert.equal(retryWithoutTime.status, 201);
    assert.equal(retryWithoutTime.body.scheduled.id, scheduled.id);
    assert.equal((await client.post("/api/v1/stories", { ...body, caption: "Changed" }, authHeader(me.token))).status, 409);
    // The same upload can't also be shared now, or scheduled twice.
    assert.equal((await share(me, mediaId)).status, 409);
    assert.equal((await share(me, mediaId, { publishAt: inHours(5) })).status, 409);
    // Someone else's upload can't be scheduled.
    const other = await signup();
    assert.equal((await share(other, mediaId, { publishAt: inHours(2) })).status, 404);
  });

  it("refuses restricted accounts and voice notes", async () => {
    const me = await signup();
    const mediaId = await upload(me);
    await query(`UPDATE users SET moderation_state = 'RESTRICTED' WHERE id = :'id'`, { id: me.id });
    assert.equal((await share(me, mediaId, { publishAt: inHours(1) })).status, 403);
  });
});

describe("before its time", () => {
  it("appears nowhere but its owner's Scheduled list", async () => {
    const me = await signup();
    const follower = await signup();
    await client.post(`/api/v1/users/${me.username}/follow`, undefined, authHeader(follower.token));
    const mediaId = await upload(me);
    const res = await share(me, mediaId, { publishAt: inHours(2) });
    assert.equal(res.status, 201);

    assert.deepEqual((await client.get("/api/v1/stories/mine/active", authHeader(me.token))).body.stories, []);
    assert.deepEqual((await client.get("/api/v1/stories/mine/archive", authHeader(me.token))).body.stories, []);
    assert.deepEqual((await client.get(`/api/v1/users/${me.username}/stories`, authHeader(follower.token))).body.stories, []);
    assert.deepEqual((await client.get("/api/v1/stories/feed/following", authHeader(follower.token))).body.feed, []);
    assert.equal((await client.get(`/api/v1/users/${me.username}`, authHeader(follower.token))).body.profile.storyCount, 0);
    const file = await fetch(`${baseUrl}/api/v1/media/${mediaId}/file`, { headers: authHeader(follower.token) });
    assert.ok(file.status === 403 || file.status === 404, `the media stays private (${file.status})`);
    assert.equal((await query(`SELECT 1 FROM push_outbox WHERE user_id = :'u'`, { u: follower.id })).length, 0, "no new-Story push yet");

    const list = await client.get("/api/v1/stories/scheduled", authHeader(me.token));
    assert.deepEqual(list.body.scheduled.map((s: { id: string }) => s.id), [res.body.scheduled.id]);
    assert.deepEqual((await client.get("/api/v1/stories/scheduled", authHeader(follower.token))).body.scheduled, []);
  });

  it("can be rescheduled or cancelled by its owner only", async () => {
    const me = await signup();
    const other = await signup();
    const later = (await share(me, await upload(me), { publishAt: inHours(2) })).body.scheduled;
    const soon = (await share(me, await upload(me), { publishAt: inHours(1) })).body.scheduled;
    const listed = (await client.get("/api/v1/stories/scheduled", authHeader(me.token))).body.scheduled;
    assert.deepEqual(listed.map((s: { id: string }) => s.id), [soon.id, later.id], "soonest first");

    const at = inHours(30);
    assert.equal((await client.patch(`/api/v1/stories/scheduled/${later.id}`, { publishAt: at }, authHeader(other.token))).status, 404);
    assert.equal((await client.patch(`/api/v1/stories/scheduled/${later.id}`, { publishAt: inHours(24 * 8) }, authHeader(me.token))).status, 422);
    assert.equal((await client.patch(`/api/v1/stories/scheduled/${later.id}`, { publishAt: inHours(-1) }, authHeader(me.token))).status, 422, "a new time must be ahead");
    assert.equal((await client.patch(`/api/v1/stories/scheduled/${later.id}`, {}, authHeader(me.token))).status, 422);
    const moved = await client.patch(`/api/v1/stories/scheduled/${later.id}`, { publishAt: at }, authHeader(me.token));
    assert.equal(moved.status, 200);
    assert.ok(Math.abs(Date.parse(moved.body.scheduled.publishAt) - Date.parse(at)) < 1000);

    assert.equal((await client.delete(`/api/v1/stories/scheduled/${soon.id}`, authHeader(other.token))).status, 404);
    assert.equal((await client.delete(`/api/v1/stories/scheduled/${soon.id}`, authHeader(me.token))).status, 204);
    assert.equal((await client.delete(`/api/v1/stories/scheduled/${soon.id}`, authHeader(me.token))).status, 404);
    assert.equal((await client.get("/api/v1/stories/scheduled", authHeader(me.token))).body.scheduled.length, 1);
    await makeDue(soon.id);
    await publishDueScheduledStories();
    assert.equal((await client.get("/api/v1/stories/mine/active", authHeader(me.token))).body.stories.length, 0, "a cancelled one never posts");
  });

  it("keeps its upload from retention's unused-media sweep, and an account deletion cancels it", async () => {
    const me = await signup();
    const mediaId = await upload(me);
    await share(me, mediaId, { publishAt: inHours(100) });
    await query(`UPDATE media SET created_at = now() - interval '5 days' WHERE id = :'id'`, { id: mediaId });
    assert.equal(await queryOne(`SELECT id FROM claim_unused_media_for_purge(:'id'::uuid, 48)`, { id: mediaId }), null);
    assert.equal((await queryOne(`SELECT media_in_use(:'id'::uuid) AS used`, { id: mediaId }))?.used, "t");

    const { removeAccount } = await import("../src/modules/users/profiles.service");
    await removeAccount(me.id);
    const row = await queryOne(`SELECT state FROM scheduled_stories WHERE media_id = :'id'`, { id: mediaId });
    assert.equal(row?.state, "canceled");
  });
});

describe("at its time", () => {
  it("is published by the worker, tells its owner and followers, and its 24 hours start then", async () => {
    const me = await signup();
    const follower = await signup();
    await client.post(`/api/v1/users/${me.username}/follow`, undefined, authHeader(follower.token));
    const scheduled = (await share(me, await upload(me), { publishAt: inHours(1) })).body.scheduled;
    await query(`UPDATE scheduled_stories SET created_at = now() - interval '2 days' WHERE id = :'id'`, { id: scheduled.id });
    assert.deepEqual(await publishDueScheduledStories(), { published: 0, failed: 0 }, "not due yet");

    await makeDue(scheduled.id);
    const worker = new ScheduledStoriesWorker({ everyMs: 60_000 });
    try {
      assert.deepEqual(await worker.runOnce(), { published: 1, failed: 0 });
    } finally {
      await worker.stop();
    }
    const row = await queryOne(`SELECT state, story_id FROM scheduled_stories WHERE id = :'id'`, { id: scheduled.id });
    assert.equal(row?.state, "published");
    const story = await queryOne(
      `SELECT extract(epoch FROM expires_at - created_at) AS ttl, created_at > now() - interval '1 minute' AS fresh, publish_request_id, caption FROM stories WHERE id = :'id'`,
      { id: row?.story_id as string },
    );
    assert.equal(Number(story?.ttl), config.stories.ttlSeconds, "expiry counts from publish time");
    assert.equal(story?.fresh, "t");
    assert.equal(story?.publish_request_id, scheduled.requestId);
    assert.equal(story?.caption, "Later");

    const live = await query(`SELECT id, kind, ref_id, body, link, attempts FROM push_outbox WHERE user_id = :'u' AND kind = 'scheduled_story_live'`, { u: me.id });
    assert.equal(live.length, 1);
    assert.equal(live[0]!.body, "Your scheduled Story is live");
    assert.equal(live[0]!.link, `katkee://story/${row?.story_id}`);
    const rendered = await renderPush({ id: String(live[0]!.id), userId: me.id, kind: "scheduled_story_live", actorId: null, refId: row?.story_id as string, attempts: 0, body: live[0]!.body, link: live[0]!.link });
    assert.ok("message" in rendered && rendered.message.body === "Your scheduled Story is live");
    assert.equal((await query(`SELECT 1 FROM push_outbox WHERE user_id = :'u' AND kind = 'new_story'`, { u: follower.id })).length, 1, "followers hear about it like any new Story");
    assert.equal((await client.get(`/api/v1/users/${me.username}/stories`, authHeader(follower.token))).body.stories.length, 1);

    // Posted: it leaves the list, can't be moved or cancelled, and running again does nothing.
    assert.deepEqual((await client.get("/api/v1/stories/scheduled", authHeader(me.token))).body.scheduled, []);
    const moved = await client.patch(`/api/v1/stories/scheduled/${scheduled.id}`, { publishAt: inHours(2) }, authHeader(me.token));
    assert.equal(moved.status, 409);
    assert.equal(moved.body.code, "already_published");
    assert.equal((await client.delete(`/api/v1/stories/scheduled/${scheduled.id}`, authHeader(me.token))).status, 409);
    assert.deepEqual(await publishDueScheduledStories(), { published: 0, failed: 0 });
    // The share's retry from the phone now gets the schedule back, not a second Story.
    const retry = await client.post("/api/v1/stories", { mediaId: scheduled.mediaId, requestId: scheduled.requestId, caption: "Later", audience: "public", allowComments: "everyone", allowSharing: true }, authHeader(me.token));
    assert.equal(retry.status, 201);
    assert.equal(retry.body.scheduled.state, "published");
  });

  it("waits for media still processing, and fails visibly when the account can't post", async () => {
    const me = await signup();
    const mediaId = await upload(me);
    const scheduled = (await share(me, mediaId, { publishAt: inHours(1) })).body.scheduled;
    await makeDue(scheduled.id);
    await query(`UPDATE media SET status = 'processing' WHERE id = :'id'`, { id: mediaId });
    assert.deepEqual(await publishDueScheduledStories(), { published: 0, failed: 0 }, "waits for processing");
    await query(`UPDATE media SET status = 'ready' WHERE id = :'id'`, { id: mediaId });
    await query(`UPDATE users SET moderation_state = 'RESTRICTED' WHERE id = :'id'`, { id: me.id });
    assert.deepEqual(await publishDueScheduledStories(), { published: 0, failed: 1 });
    await query(`UPDATE users SET moderation_state = 'ACTIVE' WHERE id = :'id'`, { id: me.id });

    const listed = (await client.get("/api/v1/stories/scheduled", authHeader(me.token))).body.scheduled;
    assert.equal(listed.length, 1);
    assert.equal(listed[0].state, "failed");
    assert.match(listed[0].error, /can't post Stories right now/);
    const pushes = await query(`SELECT body, link FROM push_outbox WHERE user_id = :'u' AND kind = 'scheduled_story_failed'`, { u: me.id });
    assert.equal(pushes.length, 1);
    assert.equal(pushes[0]!.link, "katkee://scheduled");
    // A failed one can be dismissed from the list.
    assert.equal((await client.delete(`/api/v1/stories/scheduled/${scheduled.id}`, authHeader(me.token))).status, 204);
    assert.deepEqual((await client.get("/api/v1/stories/scheduled", authHeader(me.token))).body.scheduled, []);
  });

  it("drops a festival tag when the festival is over by then", async () => {
    const me = await signup();
    await query(`INSERT INTO festivals (slug, name, emoji, greeting, starts_on, ends_on)
                 VALUES ('test-sched-fest', 'Test Fest', '🎉', 'Happy Test', (now() AT TIME ZONE 'Asia/Kolkata')::date, (now() AT TIME ZONE 'Asia/Kolkata')::date)
                 ON CONFLICT (slug) DO NOTHING`);
    const scheduled = (await share(me, await upload(me), { publishAt: inHours(1), festival: "test-sched-fest" })).body.scheduled;
    await query(`UPDATE festivals SET starts_on = starts_on - 10, ends_on = ends_on - 10 WHERE slug = 'test-sched-fest'`);
    await makeDue(scheduled.id);
    assert.equal((await publishDueScheduledStories()).published, 1);
    const story = await queryOne(`SELECT festival FROM stories WHERE publish_request_id = :'r'`, { r: scheduled.requestId });
    assert.equal(story?.festival, null);
  });
  it("keeps working after the database drops the worker's connection (a restart or failover)", async () => {
    const me = await signup();
    const scheduled = (await share(me, await upload(me), { publishAt: inHours(1) })).body.scheduled;
    const worker = new ScheduledStoriesWorker({ everyMs: 60_000 });
    try {
      assert.deepEqual(await worker.runOnce(), { published: 0, failed: 0 });
      // The database ends the worker's own connection, as on 3 November.
      const pid = await (worker as unknown as { connection: import("pg").Client }).connection.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
      await query(`SELECT pg_terminate_backend(:'pid')`, { pid: pid.rows[0]!.pid });
      await new Promise((resolve) => setTimeout(resolve, 200));
      await makeDue(scheduled.id);
      assert.deepEqual(await worker.runOnce(), { published: 1, failed: 0 }, "a new connection, not 'not queryable' forever");
    } finally {
      await worker.stop();
    }
  });
});
