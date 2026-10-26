// Home ordered by interests: a Story's topic, what Home learns a viewer likes from what they do
// with Stories (decaying, capped per day), "Show more like this", Settings > Your interests, and
// that none of it reaches anyone else or outlives the account.
import "./env";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { buildApp } from "../src/app";
import { query, queryOne } from "../src/db/psql";
import { getRankedHomeFeed } from "../src/modules/recommendations/recommendation.service";
import { TOPIC_DAILY_CAP } from "../src/modules/recommendations/scoring";
import { buildTestPng } from "./fixtures";
import { authHeader, makeClient, uniqueUser } from "./helpers";

const server = buildApp();
let baseUrl: string;
let client: ReturnType<typeof makeClient>;

before(async () => {
  await new Promise<void>((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  client = makeClient(baseUrl);
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

interface Person { id: string; username: string; password: string; auth: Record<string, string> }

async function person(interests?: string[]): Promise<Person> {
  const input = uniqueUser();
  const res = await client.post("/api/v1/auth/signup", input);
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const who = { id: res.body.user.id, username: input.username, password: input.password, auth: authHeader(res.body.tokens.accessToken) };
  if (interests) assert.equal((await client.patch("/api/v1/users/me", { interests }, who.auth)).status, 200);
  return who;
}

async function photo(owner: Person): Promise<string> {
  const upload = await fetch(`${baseUrl}/api/v1/media/photos`, { method: "POST", headers: { "Content-Type": "image/png", ...owner.auth }, body: buildTestPng(4, 4) });
  return ((await upload.json()) as { media: { id: string } }).media.id;
}

async function publish(owner: Person, extra: Record<string, unknown> = {}): Promise<{ status: number; body: any }> {
  return client.post("/api/v1/stories", { mediaId: await photo(owner), caption: "", audience: "public", allowComments: "everyone", allowSharing: true, ...extra }, owner.auth);
}
async function story(owner: Person, topic?: string): Promise<string> {
  const res = await publish(owner, topic ? { topic } : {});
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.story.id as string;
}

const event = (who: Person, body: Record<string, unknown>) => client.post("/api/v1/events", body, who.auth);
async function scores(who: Person): Promise<Record<string, number>> {
  const rows = await query(`SELECT topic, score FROM viewer_topic_affinity WHERE viewer_id = :'id'`, { id: who.id });
  // Rounded: what was stored decays a little between two requests.
  return Object.fromEntries(rows.map((r) => [r.topic as string, Math.round(Number(r.score) * 1000) / 1000]));
}

describe("a Story's topic", () => {
  it("is one topic from the list, stored by its listed name, and optional", async () => {
    const owner = await person();
    const tagged = await publish(owner, { topic: " food " });
    assert.equal(tagged.status, 201, JSON.stringify(tagged.body));
    assert.equal(tagged.body.story.topic, "Food");
    const plain = await publish(owner);
    assert.equal(plain.body.story.topic, null, "older apps send no topic");
    assert.equal((await publish(owner, { topic: null })).body.story.topic, null);
    for (const bad of ["Knitting", 7, ["Food"], "Food, Travel"]) {
      const res = await publish(owner, { topic: bad });
      assert.equal(res.status, 422, JSON.stringify(bad));
      assert.ok(res.body.fields.topic);
    }
    const read = await client.get(`/api/v1/stories/${tagged.body.story.id}`, (await person()).auth);
    assert.equal(read.body.story.topic, "Food");
  });

  it("is kept when a publish goes through its request id (the outbox's path)", async () => {
    const owner = await person();
    const requestId = `req_${Date.now().toString(36)}_topic_check`;
    const res = await publish(owner, { topic: "Cricket", requestId });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.story.topic, "Cricket");
    assert.equal((await queryOne(`SELECT topic FROM stories WHERE id = :'id'`, { id: res.body.story.id }))?.topic, "Cricket");
  });
});

describe("learned interests", () => {
  it("grow from watching to the end, likes, comments and shares, on the Story's topic", async () => {
    const owner = await person(["Travel"]);
    const viewer = await person();
    const food = await story(owner, "Food");
    assert.equal((await event(viewer, { eventType: "story_impression", storyId: food, creatorId: owner.id })).status, 204);
    assert.deepEqual(await scores(viewer), {}, "an impression teaches nothing");
    await event(viewer, { eventType: "story_complete", storyId: food, creatorId: owner.id });
    await client.post(`/api/v1/stories/${food}/like`, undefined, viewer.auth);
    await client.post(`/api/v1/stories/${food}/comments`, { body: "Looks great" }, viewer.auth);
    await client.post(`/api/v1/stories/${food}/share`, undefined, viewer.auth);
    assert.deepEqual(await scores(viewer), { Food: 6 }, "complete 1 + like 1 + comment 2 + share 2, and not the owner's other interests");
  });

  it("use the owner's interests for a Story without a topic, and the creator's topics for creator-level signals", async () => {
    const owner = await person(["Pets", "gardening", "art"]);
    const viewer = await person();
    const untagged = await story(owner);
    await event(viewer, { eventType: "story_replay", storyId: untagged });
    assert.deepEqual(await scores(viewer), { Art: 1, Pets: 1 }, "free-text interests that aren't topics are ignored");
    await story(owner, "Dance");
    await event(viewer, { eventType: "not_interested", creatorId: owner.id });
    assert.deepEqual(await scores(viewer), { Art: -2, Pets: -2, Dance: -3 });
  });

  it("drop for a quick skip, and never come from your own Stories", async () => {
    const owner = await person();
    const viewer = await person();
    const s = await story(owner, "Gaming");
    await event(viewer, { eventType: "watch_duration", storyId: s, valueMs: 400 });
    await event(viewer, { eventType: "watch_duration", storyId: s, valueMs: 8000 });
    assert.deepEqual(await scores(viewer), { Gaming: -1 });
    await event(owner, { eventType: "story_complete", storyId: s });
    await event(owner, { eventType: "more_like_this", storyId: s });
    await client.post(`/api/v1/stories/${s}/like`, undefined, owner.auth);
    assert.deepEqual(await scores(owner), {});
  });

  it("never learn Devotional (it could reveal religion); picking it yourself still counts", async () => {
    const owner = await person(["Devotional", "Music"]);
    const viewer = await person();
    const prayer = await story(owner, "Devotional");
    await event(viewer, { eventType: "story_complete", storyId: prayer, creatorId: owner.id });
    await client.post(`/api/v1/stories/${prayer}/like`, undefined, viewer.auth);
    const untagged = await story(owner);
    await event(viewer, { eventType: "story_complete", storyId: untagged, creatorId: owner.id });
    assert.deepEqual(await scores(viewer), { Music: 1 }, "the owner's Music is learned from the untagged Story; Devotional never is");
  });

  it("can move a topic only so far in a day", async () => {
    const owner = await person();
    const viewer = await person();
    const s = await story(owner, "Cars");
    for (let i = 0; i < 6; i++) assert.equal((await event(viewer, { eventType: "more_like_this", storyId: s })).status, 204);
    assert.deepEqual(await scores(viewer), { Cars: TOPIC_DAILY_CAP });
    // Tomorrow (as far as the row knows) there's room again, on top of the decayed score.
    await query(`UPDATE viewer_topic_affinity SET day = current_date - 1, updated_at = now() - interval '14 days' WHERE viewer_id = :'id'`, { id: viewer.id });
    await event(viewer, { eventType: "more_like_this", storyId: s });
    const { Cars } = await scores(viewer);
    assert.ok(Math.abs(Cars! - (TOPIC_DAILY_CAP / 2 + 4)) < 0.01, `decayed by half, then +4: ${Cars}`);
  });
});

describe("Show more like this", () => {
  it("needs a Story the viewer can see, and records who made it", async () => {
    const owner = await person();
    const viewer = await person();
    assert.equal((await event(viewer, { eventType: "more_like_this" })).status, 422);
    const s = await story(owner, "Music");
    assert.equal((await event(viewer, { eventType: "more_like_this", storyId: s })).status, 204);
    const row = await queryOne(`SELECT creator_id FROM recommendation_events WHERE viewer_id = :'v' AND event_type = 'more_like_this'`, { v: viewer.id });
    assert.equal(row?.creator_id, owner.id);
    assert.deepEqual(await scores(viewer), { Music: 4 });
    const hidden = (await publish(owner, { audience: "followers" })).body.story.id;
    assert.ok([403, 404].includes((await event(viewer, { eventType: "more_like_this", storyId: hidden })).status));
    assert.deepEqual(await scores(viewer), { Music: 4 }, "nothing learned from a Story you can't see");
  });
});

describe("Your interests", () => {
  it("shows what you chose and the strongest topics learned, as high or medium only", async () => {
    const owner = await person();
    const viewer = await person(["Books", "Knitting"]);
    for (const [topic, times] of [["Cricket", 3], ["Food", 1], ["Nature", 0]] as const) {
      const s = await story(owner, topic);
      for (let i = 0; i < times; i++) await event(viewer, { eventType: "more_like_this", storyId: s });
      if (times === 0) await event(viewer, { eventType: "story_replay", storyId: s });
    }
    const res = await client.get("/api/v1/me/interests", viewer.auth);
    assert.equal(res.status, 200);
    assert.equal((await fetch(`${baseUrl}/api/v1/me/interests`, { headers: viewer.auth })).headers.get("cache-control"), "no-store");
    assert.deepEqual(res.body, { chosen: ["Books", "Knitting"], learned: [{ topic: "Cricket", strength: "high" }, { topic: "Food", strength: "medium" }] });
    assert.equal((await client.get("/api/v1/me/interests")).status, 401);
  });

  it("removes a learned topic: back to 0, kept out for 30 days, and out of Home's ranking", async () => {
    const owner = await person();
    const viewer = await person();
    const s = await story(owner, "Fitness");
    await event(viewer, { eventType: "more_like_this", storyId: s });
    assert.equal((await client.delete("/api/v1/me/interests/learned/fitness", viewer.auth)).status, 204);
    assert.deepEqual((await client.get("/api/v1/me/interests", viewer.auth)).body.learned, []);
    await event(viewer, { eventType: "more_like_this", storyId: s });
    await client.post(`/api/v1/stories/${s}/like`, undefined, viewer.auth);
    assert.deepEqual(await scores(viewer), { Fitness: 0 }, "nothing learned while it's out");
    const pinned = await queryOne(`SELECT pinned_out_until > now() + interval '29 days' AS ok FROM viewer_topic_affinity WHERE viewer_id = :'id'`, { id: viewer.id });
    assert.equal(pinned?.ok, "t");
    assert.equal((await client.delete("/api/v1/me/interests/learned/Knitting", viewer.auth)).status, 404);
  });

  it("is never in anyone else's responses", async () => {
    const owner = await person();
    const viewer = await person(["Books"]);
    const other = await person();
    // A followers-only Story: the only place the topic can show up for `other` is the viewer's learned interests.
    await client.post(`/api/v1/users/${owner.username}/follow`, undefined, viewer.auth);
    const s = (await publish(owner, { topic: "Startups", audience: "followers" })).body.story.id;
    for (let i = 0; i < 2; i++) assert.equal((await event(viewer, { eventType: "more_like_this", storyId: s })).status, 204);
    assert.deepEqual(await scores(viewer), { Startups: 8 });
    await story(viewer);
    await client.post(`/api/v1/users/${viewer.username}/follow`, undefined, other.auth);
    const seen = [
      await client.get(`/api/v1/users/${viewer.username}`, other.auth),
      await client.get("/api/v1/stories/feed/home", other.auth),
      await client.get("/api/v1/stories/feed/home?limit=5", other.auth),
      await client.get(`/api/v1/users/${viewer.username}/stories`, other.auth),
      await client.get(`/api/v1/search/users?q=${viewer.username}`, other.auth),
      await client.get("/api/v1/me/interests", other.auth),
    ];
    for (const res of seen) {
      assert.ok(res.status < 400, `${res.status} ${JSON.stringify(res.body)}`);
      const text = JSON.stringify(res.body);
      assert.ok(!text.includes("Startups") && !/strength|learned"\s*:\s*\[\{/.test(text), text.slice(0, 300));
    }
    assert.deepEqual((await client.get("/api/v1/me/interests", other.auth)).body, { chosen: [], learned: [] });
    const mine = await client.get("/api/v1/auth/me", viewer.auth);
    assert.equal(mine.status, 200);
    assert.ok(!JSON.stringify(mine.body).includes("Startups"), "not even in your own profile: only Settings shows it");
  });

  it("goes with the account the moment the account is deleted", async () => {
    const owner = await person();
    const viewer = await person();
    await event(viewer, { eventType: "more_like_this", storyId: await story(owner, "Comedy") });
    assert.ok(Object.keys(await scores(viewer)).length > 0);
    const res = await client.deleteWithBody("/api/v1/users/me", { password: viewer.password }, viewer.auth);
    assert.equal(res.status, 204, JSON.stringify(res.body));
    assert.deepEqual(await scores(viewer), {});
  });
});

describe("Home by interest", () => {
  it("puts a new person on a topic you've shown you like ahead of others, and keeps that order", async () => {
    const viewer = await person();
    const [liked, neutral, other] = [await person(), await person(), await person()];
    const likedStory = await story(liked, "Photography");
    await story(neutral, "Football");
    await story(other);
    // What the viewer did on another Story on the same topic.
    const elsewhere = await story(await person(), "Photography");
    await event(viewer, { eventType: "more_like_this", storyId: elsewhere });
    await client.post(`/api/v1/stories/${elsewhere}/like`, undefined, viewer.auth);
    const order = (await getRankedHomeFeed(viewer.id)).map((e) => e.owner.id);
    assert.ok(order.includes(liked.id) && order.includes(neutral.id) && order.includes(other.id));
    assert.ok(order.indexOf(liked.id) < order.indexOf(neutral.id) && order.indexOf(liked.id) < order.indexOf(other.id), "the topic you like first");
    assert.deepEqual((await getRankedHomeFeed(viewer.id)).map((e) => e.owner.id), order, "a refresh with nothing new changes nothing");
    assert.ok(likedStory);
  });
});
