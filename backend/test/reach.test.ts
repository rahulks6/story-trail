// Phase 9: public Stories earn reach beyond followers, nearest people first, and Home mixes
// people you follow with new people. Small test audiences (3, 5, 8) let a handful of viewers
// move a Story through its stages. Everything goes through the real API and database; the
// evaluator is called directly instead of waiting for the worker's next round.
process.env.REACH_CONFIG_JSON = JSON.stringify({ caps: [3, 5, 8], minSample: [2, 2, 2], thresholds: [0.3, 0.35, 0.4], patienceMinutes: 120 });

import "./env";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { buildApp } from "../src/app";
import { query, queryOne } from "../src/db/psql";
import { cellsAround, encodeGeohash } from "../src/modules/recommendations/geohash";
import { evaluateReachBatch, listDiscoveryCandidates } from "../src/modules/recommendations/reach.repository";
import { reachSettings } from "../src/modules/recommendations/reach";
import { getRankedHomeFeed } from "../src/modules/recommendations/recommendation.service";
import { buildTestPng } from "./fixtures";
import { authHeader, makeClient, uniqueUser } from "./helpers";

const settings = reachSettings(process.env.REACH_CONFIG_JSON!);
/** The server stores each time zone under the runtime's canonical name. */
const zone = (name: string) => new Intl.DateTimeFormat("en-US", { timeZone: name }).resolvedOptions().timeZone;
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

interface Person { id: string; username: string; auth: Record<string, string> }

async function person(): Promise<Person> {
  const input = uniqueUser();
  const res = await client.post("/api/v1/auth/signup", input);
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return { id: res.body.user.id, username: input.username, auth: authHeader(res.body.tokens.accessToken) };
}

async function setArea(who: Person, cell: string | null, timeZone: string | null): Promise<void> {
  const res = await client.put("/api/v1/users/me/area", { cell, timeZone }, who.auth);
  assert.equal(res.status, 200, JSON.stringify(res.body));
}

async function publish(owner: Person, audience: "public" | "followers" = "public"): Promise<string> {
  const upload = await fetch(`${baseUrl}/api/v1/media/photos`, { method: "POST", headers: { "Content-Type": "image/png", ...owner.auth }, body: buildTestPng(4, 4) });
  const media = (await upload.json()) as { media: { id: string } };
  const res = await client.post("/api/v1/stories", { mediaId: media.media.id, caption: "", audience, allowComments: "everyone", allowSharing: true }, owner.auth);
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.story.id as string;
}

const view = async (who: Person, story: string) => assert.equal((await client.post(`/api/v1/stories/${story}/view`, undefined, who.auth)).status, 204);
const like = async (who: Person, story: string) => assert.ok([200, 201, 204].includes((await client.post(`/api/v1/stories/${story}/like`, undefined, who.auth)).status));
const follow = async (who: Person, target: Person) => assert.equal((await client.post(`/api/v1/users/${target.username}/follow`, undefined, who.auth)).status, 200);
const completed = async (who: Person, story: string, creator: Person) =>
  assert.ok([200, 202, 204].includes((await client.post("/api/v1/events", { eventType: "story_complete", storyId: story, creatorId: creator.id }, who.auth)).status));

async function homeOwners(who: Person): Promise<string[]> {
  const res = await client.get("/api/v1/stories/feed/home?limit=50", who.auth);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body.feed.map((e: { owner: { id: string } }) => e.owner.id);
}
const sees = async (who: Person, creator: Person) => (await homeOwners(who)).includes(creator.id);

async function setStage(story: string, stage: number, options: { held?: boolean; impressions?: number } = {}): Promise<void> {
  await query(
    `INSERT INTO story_reach (story_id, stage, held, stage_started_at, stage_impressions)
     VALUES (:'story', :'stage', :'held', now(), :'impressions')
     ON CONFLICT (story_id) DO UPDATE SET stage = EXCLUDED.stage, held = EXCLUDED.held, stage_impressions = EXCLUDED.stage_impressions`,
    { story, stage, held: options.held ?? false, impressions: options.impressions ?? 0 },
  );
}

/** A seeded random source (mulberry32). */
function seeded(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const reachRow = (story: string) =>
  queryOne(`SELECT stage, held, stage_impressions, stage_score, reason FROM story_reach WHERE story_id = :'story'`, { story });

// Bengaluru, a cell next to it, a cell in the same wider area, Delhi (same time zone, far) and Berlin.
const home = encodeGeohash(12.9716, 77.5946, 4);
const nextDoor = cellsAround(home).find((cell) => cell !== home)!;
const widerArea = [..."0123456789bcdefghjkmnpqrstuvwxyz"].map((c) => home.slice(0, 3) + c).find((cell) => !cellsAround(home).includes(cell))!;
const delhi = encodeGeohash(28.7041, 77.1025, 4);
const berlin = encodeGeohash(52.52, 13.405, 4);

describe("approximate area", () => {
  it("keeps only a coarse cell and a time zone, readable only by its owner", async () => {
    const me = await person();
    const put = await fetch(`${baseUrl}/api/v1/users/me/area`, {
      method: "PUT", headers: { "Content-Type": "application/json", ...me.auth }, body: JSON.stringify({ cell: home, timeZone: "Asia/Kolkata" }),
    });
    assert.equal(put.status, 200);
    assert.equal(put.headers.get("cache-control"), "no-store");
    const body = (await put.json()) as { area: { cell: string; timeZone: string } };
    assert.deepEqual([body.area.cell, body.area.timeZone], [home, zone("Asia/Kolkata")]);
    assert.equal((await client.get("/api/v1/users/me/area", me.auth)).body.area.cell, home);

    const cleared = await client.put("/api/v1/users/me/area", { cell: null }, me.auth);
    assert.deepEqual([cleared.body.area.cell, cleared.body.area.timeZone], [null, zone("Asia/Kolkata")], "turning nearby off keeps the time zone");
    const alias = await client.put("/api/v1/users/me/area", { timeZone: "Asia/Calcutta" }, me.auth);
    assert.equal(alias.body.area.timeZone, zone("Asia/Kolkata"), "both names of one zone are stored the same way");

    for (const bad of [{ cell: home.toUpperCase() }, { cell: home.slice(0, 3) }, { cell: `${home.slice(0, 3)}a` }, { cell: 1234 }, { timeZone: "Mars/Olympus" }, { timeZone: "" }, {}]) {
      assert.equal((await client.put("/api/v1/users/me/area", bad, me.auth)).status, 422, JSON.stringify(bad));
    }
    assert.equal((await client.delete("/api/v1/users/me/area", me.auth)).status, 204);
    assert.equal((await client.get("/api/v1/users/me/area", me.auth)).body.area, null);
    assert.equal((await client.get("/api/v1/users/me/area")).status, 401);
  });

  it("goes with the account the moment the account is deleted", async () => {
    const me = await person();
    await setArea(me, home, "Asia/Kolkata");
    const res = await client.deleteWithBody("/api/v1/users/me", { password: "correcthorsebattery" }, me.auth);
    assert.equal(res.status, 204, JSON.stringify(res.body));
    assert.equal((await queryOne(`SELECT count(*) AS n FROM user_areas WHERE user_id = :'id'`, { id: me.id }))?.n, "0");
  });

  it("never appears in a profile, search, suggestions or Home", async () => {
    const creator = await person();
    const other = await person();
    await setArea(creator, home, "Asia/Kolkata");
    await publish(creator);
    await follow(other, creator);
    const views = [
      await client.get(`/api/v1/users/${creator.username}`, other.auth),
      await client.get(`/api/v1/search/users?q=${creator.username}`, other.auth),
      await client.get("/api/v1/search/suggestions", other.auth),
      await client.get("/api/v1/stories/feed/home", other.auth),
      await client.get("/api/v1/auth/me", creator.auth),
    ];
    for (const res of views) {
      assert.equal(res.status, 200);
      const text = JSON.stringify(res.body);
      assert.ok(!text.includes(`"${home}"`) && !text.includes(zone("Asia/Kolkata")) && !text.includes("Asia/Kolkata"), text.slice(0, 200));
    }
  });
});

describe("staged reach", () => {
  it("a new public Story reaches people nearby first, then the wider area, the time zone and everyone", async () => {
    const creator = await person();
    await setArea(creator, home, "Asia/Kolkata");
    const story = await publish(creator);
    const viewers = {
      nearby: await person(), wider: await person(), farSameZone: await person(),
      noCellSameZone: await person(), noCellOtherZone: await person(), berlin: await person(), noArea: await person(),
    };
    await setArea(viewers.nearby, nextDoor, "Asia/Kolkata");
    await setArea(viewers.wider, widerArea, "Asia/Kolkata");
    await setArea(viewers.farSameZone, delhi, "Asia/Kolkata");
    await setArea(viewers.noCellSameZone, null, "Asia/Kolkata");
    await setArea(viewers.noCellOtherZone, null, "Europe/Berlin");
    await setArea(viewers.berlin, berlin, "Europe/Berlin");
    const followerInBerlin = await person();
    await setArea(followerInBerlin, berlin, "Europe/Berlin");
    await follow(followerInBerlin, creator);

    const expected: Record<number, Array<keyof typeof viewers>> = {
      1: ["nearby", "noCellSameZone", "noArea"],
      2: ["nearby", "wider", "noCellSameZone", "noArea"],
      3: ["nearby", "wider", "farSameZone", "noCellSameZone", "noArea"],
      4: ["nearby", "wider", "farSameZone", "noCellSameZone", "noCellOtherZone", "berlin", "noArea"],
    };
    for (const stage of [1, 2, 3, 4]) {
      if (stage > 1) await setStage(story, stage);
      for (const [name, who] of Object.entries(viewers)) {
        assert.equal(await sees(who, creator), expected[stage]!.includes(name as keyof typeof viewers), `stage ${stage}: ${name}`);
      }
      assert.equal(await sees(followerInBerlin, creator), true, `stage ${stage}: followers always see it`);
    }
  });

  it("a held Story or a used-up test audience reaches no new people, while followers still see it", async () => {
    const creator = await person();
    const story = await publish(creator);
    const [stranger, fan] = [await person(), await person()];
    await follow(fan, creator);
    await setStage(story, 1, { held: true });
    assert.equal(await sees(stranger, creator), false, "held");
    assert.equal(await sees(fan, creator), true);
    await setStage(story, 1, { impressions: settings.caps[0] });
    assert.equal(await sees(stranger, creator), false, "test audience used up");
    await setStage(story, 1, { impressions: settings.caps[0] - 1 });
    assert.equal(await sees(stranger, creator), true, "room left in the test audience");
  });

  it("never gives reach to private accounts, followers-only Stories, restricted accounts or blocked people", async () => {
    const stranger = await person();
    const privateCreator = await person();
    await client.patch("/api/v1/users/me", { isPrivate: true }, privateCreator.auth);
    await setStage(await publish(privateCreator), 4);
    const followersOnly = await person();
    await setStage(await publish(followersOnly, "followers"), 4);
    const restricted = await person();
    await setStage(await publish(restricted), 4);
    await query(`UPDATE users SET moderation_state = 'RESTRICTED' WHERE id = :'id'`, { id: restricted.id });
    const blocker = await person();
    await setStage(await publish(blocker), 4);
    assert.equal((await client.post(`/api/v1/users/${stranger.username}/block`, undefined, blocker.auth)).status, 204);

    const owners = await homeOwners(stranger);
    // Both layers: the reach query never offers them, and Home never shows them.
    const offered = (await listDiscoveryCandidates(stranger.id, settings, 10_000)).map((c) => c.ownerId);
    for (const [name, p] of Object.entries({ privateCreator, followersOnly, restricted, blocker })) {
      assert.ok(!owners.includes(p.id), name);
      assert.ok(!offered.includes(p.id), `${name} (reach query)`);
    }
    const fan = await person();
    await follow(fan, restricted);
    assert.equal(await sees(fan, restricted), true, "a restricted account's followers still see its Stories");
  });
});

describe("the reach evaluator", () => {
  it("moves a Story up when people who don't follow its owner engage, counting each person once", async () => {
    const creator = await person();
    const story = await publish(creator);
    const [a, b, c, follower] = [await person(), await person(), await person(), await person()];
    await follow(follower, creator);
    await view(follower, story); // a follower's view doesn't count
    for (const p of [a, b, c]) await view(p, story);
    await like(a, story);
    await like(b, story);
    await completed(a, story, creator);
    await completed(a, story, creator); // the same person twice counts once
    await completed(b, story, creator);
    await follow(c, creator); // following after seeing it counts for it
    const elsewhere = await person();
    const otherStory = await publish(elsewhere);
    await view(c, otherStory);
    await completed(c, otherStory, elsewhere); // what c did on someone else's Story doesn't count here
    await like(c, otherStory);
    await follow(b, elsewhere); // nor does following someone else

    await evaluateReachBatch(settings, 500);
    const row = await reachRow(story);
    assert.deepEqual([row?.stage, row?.held, row?.reason, row?.stage_impressions], ["2", "f", "engaged", "0"]);
    // 3 people: 2 completions, 2 likes, 1 follow -> (0.8 + 0.6 + 1.0 + 2.5) / 13.
    assert.ok(Math.abs(Number(row?.stage_score) - 4.9 / 13) < 1e-4, String(row?.stage_score));

    await evaluateReachBatch(settings, 500);
    const next = await reachRow(story);
    assert.deepEqual([next?.stage, next?.reason], ["2", "engaged"], "the new stage needs its own audience; the last reason stays");
  });

  it("holds a Story nobody engaged with, and widens one too few people nearby could see", async () => {
    const creator = await person();
    const quiet = await publish(creator);
    for (const p of [await person(), await person(), await person()]) await view(p, quiet);
    const lonely = await publish(creator);
    await view(await person(), lonely);
    await query(`UPDATE stories SET created_at = now() - interval '3 hours' WHERE id = :'id'`, { id: lonely });
    const fresh = await publish(creator);
    await view(await person(), fresh);

    await evaluateReachBatch(settings, 500);
    const [q, l, f] = [await reachRow(quiet), await reachRow(lonely), await reachRow(fresh)];
    assert.deepEqual([q?.stage, q?.held, q?.reason, q?.stage_impressions], ["1", "t", "low_engagement", "3"]);
    assert.deepEqual([l?.stage, l?.held, l?.reason], ["2", "f", "small_audience"]);
    assert.deepEqual([f?.stage, f?.held, f?.reason, f?.stage_impressions], ["1", "f", null, "1"], "still testing");
  });
});

describe("Home's mix", () => {
  it("tends to put new people nearby before new people further away", async () => {
    const viewer = await person();
    await setArea(viewer, home, "Asia/Kolkata");
    const near = await person();
    await setArea(near, nextDoor, "Asia/Kolkata");
    const far = await person();
    await setArea(far, delhi, "Asia/Kolkata");
    await setStage(await publish(near), 3);
    await setStage(await publish(far), 3);
    // A fixed random source and many loads: about 62% expected with the nearby boost (1.6
    // against 1), 50% without it; the bounds sit over 3 standard deviations from both.
    const random = seeded(2026);
    let nearFirst = 0;
    const runs = 800;
    for (let i = 0; i < runs; i++) {
      const order = (await getRankedHomeFeed(viewer.id, random)).map((e) => e.owner.id);
      assert.ok(order.includes(near.id) && order.includes(far.id));
      if (order.indexOf(near.id) < order.indexOf(far.id)) nearFirst++;
    }
    console.log(`# nearby first in ${nearFirst} of ${runs}`);
    assert.ok(nearFirst / runs > 0.56 && nearFirst / runs < 0.7, `nearby first in ${nearFirst} of ${runs}`);
  });

  it("starts with someone you follow, then 3 people you follow to 2 new people in every five, differently each time", async () => {
    const viewer = await person();
    for (let i = 0; i < 10; i++) {
      const followed = await person();
      await publish(followed);
      await follow(viewer, followed);
      await publish(await person());
    }
    await publish(viewer);
    const following = new Set((await query(`SELECT followee_id FROM follows WHERE follower_id = :'id'`, { id: viewer.id })).map((r) => r.followee_id as string));
    const orders = new Set<string>();
    for (let load = 0; load < 8; load++) {
      const owners = await homeOwners(viewer);
      assert.equal(owners[0], viewer.id, "your own Story first");
      const rest = owners.slice(1);
      assert.ok(following.has(rest[0]!), "then someone you follow");
      for (let block = 0; block < 3; block++) {
        const five = rest.slice(block * 5, block * 5 + 5);
        assert.equal(five.filter((id) => following.has(id)).length, 3, `load ${load}, places ${block * 5 + 1}-${block * 5 + 5}`);
      }
      orders.add(rest.join());
    }
    assert.ok(orders.size >= 2, "a different order on each refresh");
  });
});
