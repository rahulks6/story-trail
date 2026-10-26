// The pure parts of Phase 9 (reach and Home's order): area cells, stage decisions, and Home's
// stable ranked mix.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { AREA_CELL_RE, cellsAround, decodeGeohash, encodeGeohash } from "../src/modules/recommendations/geohash";
import { DEFAULT_REACH, decideReach, reachSettings, stageEngagement, type StageStats } from "../src/modules/recommendations/reach";
import { diversifyTopics, FOLLOWED_SHARE, MAX_TOPIC_RUN, mixFeed, rankOrder } from "../src/modules/recommendations/feed-mix";

const none: StageStats = { impressions: 0, completions: 0, likes: 0, comments: 0, shares: 0, profileVisits: 0, follows: 0, notInterested: 0, quickSkips: 0 };
const minutes = (n: number) => n * 60_000;

describe("area cells", () => {
  it("encode and decode the standard way", () => {
    // The worked example from the geohash specification.
    assert.equal(encodeGeohash(57.64911, 10.40744, 11), "u4pruydqqvj");
    assert.equal(encodeGeohash(57.64911, 10.40744, 4), "u4pr");
    for (const [lat, lng] of [[12.9716, 77.5946], [28.7041, 77.1025], [-33.8688, 151.2093], [40.7128, -74.006]] as const) {
      const cell = encodeGeohash(lat, lng, 4);
      assert.match(cell, AREA_CELL_RE);
      const box = decodeGeohash(cell);
      assert.ok(Math.abs(box.latitude - lat) <= box.latitudeError && Math.abs(box.longitude - lng) <= box.longitudeError, cell);
    }
  });

  it("list a cell and the eight around it, across the date line, and fewer at the poles", () => {
    const around = cellsAround("u4pr");
    assert.equal(around.length, 9);
    assert.ok(around.includes("u4pr"));
    const centre = decodeGeohash("u4pr");
    for (const cell of around) {
      const box = decodeGeohash(cell);
      assert.ok(Math.abs(box.latitude - centre.latitude) <= centre.latitudeError * 2 + 1e-9, cell);
      assert.ok(Math.abs(box.longitude - centre.longitude) <= centre.longitudeError * 2 + 1e-9, cell);
    }
    const east = encodeGeohash(0.1, 179.9, 4);
    assert.ok(cellsAround(east).some((cell) => decodeGeohash(cell).longitude < 0), "wraps to the other side of 180°");
    assert.equal(cellsAround(encodeGeohash(89.99, 0, 4)).length, 6, "nothing above the North Pole");
    assert.equal(cellsAround("u4p").length, 9, "works for the 3-character wider area too");
  });
});

describe("reach stages", () => {
  const start = new Date("2026-10-07T00:00:00Z");
  const at = (n: number) => new Date(start.getTime() + minutes(n));
  const state = { stage: 1 as const, held: false, stageStartedAt: start };

  it("keep testing until the stage's audience is used up or patience runs out", () => {
    const d = decideReach(state, { ...none, impressions: 20, likes: 20 }, at(30));
    assert.deepEqual([d.stage, d.held, d.reason], [1, false, null]);
  });

  it("move up when the people who saw it engaged, and start counting the new stage from zero time", () => {
    const d = decideReach(state, { ...none, impressions: 50, completions: 40, likes: 15, follows: 3 }, at(30));
    assert.deepEqual([d.stage, d.held, d.reason], [2, false, "engaged"]);
    assert.equal(d.stageStartedAt.getTime(), at(30).getTime());
  });

  it("hold when they didn't, and stop there", () => {
    const d = decideReach(state, { ...none, impressions: 50, completions: 3, quickSkips: 30 }, at(30));
    assert.deepEqual([d.stage, d.held, d.reason], [1, true, "low_engagement"]);
    const again = decideReach({ ...state, held: true }, { ...none, impressions: 500, follows: 500 }, at(600));
    assert.deepEqual([again.stage, again.held, again.reason], [1, true, null]);
  });

  it("judge on what it has once patience runs out with enough viewers", () => {
    const good = decideReach(state, { ...none, impressions: 12, completions: 10, likes: 6 }, at(121));
    assert.deepEqual([good.stage, good.reason], [2, "engaged"]);
    const poor = decideReach(state, { ...none, impressions: 12, notInterested: 2 }, at(121));
    assert.deepEqual([poor.held, poor.reason], [true, "low_engagement"]);
  });

  it("widen when too few people nearby saw it to tell, so quiet areas still find an audience", () => {
    const d = decideReach(state, { ...none, impressions: 3, likes: 3 }, at(121));
    assert.deepEqual([d.stage, d.held, d.reason], [2, false, "small_audience"]);
    const lastTest = decideReach({ ...state, stage: 3 }, none, at(121));
    assert.deepEqual([lastTest.stage, lastTest.reason], [4, "small_audience"]);
    assert.deepEqual(decideReach({ ...state, stage: 4 }, none, at(10_000)).stage, 4, "everyone is as far as it goes");
  });

  it("asks more of each wider stage", () => {
    assert.ok(DEFAULT_REACH.thresholds[0] < DEFAULT_REACH.thresholds[1] && DEFAULT_REACH.thresholds[1] < DEFAULT_REACH.thresholds[2]);
    assert.ok(DEFAULT_REACH.caps[0] < DEFAULT_REACH.caps[1] && DEFAULT_REACH.caps[1] < DEFAULT_REACH.caps[2]);
    // The same engagement that clears stage 1 may not clear stage 3 (about 0.33).
    const stats = { ...none, impressions: 2000, completions: 1500, likes: 200 };
    assert.equal(decideReach(state, stats, at(1)).reason, "engaged");
    assert.equal(decideReach({ ...state, stage: 3 }, stats, at(1)).reason, "low_engagement");
  });

  it("smooth engagement so a handful of viewers can't decide it", () => {
    assert.equal(stageEngagement(none), 0.25);
    assert.ok(stageEngagement({ ...none, impressions: 1, follows: 1 }) < 0.4, "one follow from one viewer is not a hit");
    assert.ok(stageEngagement({ ...none, impressions: 100, follows: 60 }) > 0.5);
    assert.ok(stageEngagement({ ...none, impressions: 100, notInterested: 40 }) < 0, "not interested counts against");
  });

  it("read tuning overrides and refuse ones that can't be right", () => {
    assert.deepEqual(reachSettings(""), DEFAULT_REACH);
    assert.deepEqual(reachSettings('{"caps":[3,5,8],"patienceMinutes":30}'), { ...DEFAULT_REACH, caps: [3, 5, 8], patienceMinutes: 30 });
    for (const bad of ["{", '{"caps":[1,2]}', '{"thresholds":[0.3,-1,0.4]}', '{"minSample":["1",2,3]}', '{"patienceMinutes":0}']) {
      assert.throws(() => reachSettings(bad), /REACH_CONFIG_JSON/, bad);
    }
  });
});

describe("Home's mix", () => {
  const followed = Array.from({ length: 30 }, (_, i) => `f${i}`);
  const fresh = Array.from({ length: 30 }, (_, i) => `n${i}`);

  it("starts with someone you follow, keeps everyone exactly once, and is 3 followed to 2 new in a fixed pattern", () => {
    assert.equal(FOLLOWED_SHARE, 0.6);
    const mixed = mixFeed(followed, fresh);
    assert.equal(new Set(mixed).size, 60);
    assert.equal(mixed.slice(0, 10).map((id) => id[0]).join(""), "ffnfnffnfn");
    for (let block = 0; block < 10; block++) {
      const five = mixed.slice(block * 5, block * 5 + 5);
      assert.equal(five.filter((id) => id.startsWith("f")).length, 3, five.join());
    }
    assert.deepEqual(mixed.filter((id) => id.startsWith("f")), followed, "each list keeps its ranked order");
    assert.deepEqual(mixed.filter((id) => id.startsWith("n")), fresh);
    assert.deepEqual(mixFeed(followed, fresh), mixed, "the same lists, the same Home");
  });

  it("never shows more than one new person in a row while people you follow are left", () => {
    const mixed = mixFeed(followed.slice(0, 10), fresh);
    let inARow = 0, followedSeen = 0;
    for (const id of mixed) {
      if (id.startsWith("f")) { followedSeen++; inARow = 0; } else if (followedSeen < 10) { inARow++; assert.ok(inARow <= 1); }
    }
  });

  it("falls back to whichever list remains", () => {
    assert.deepEqual(mixFeed([], ["a", "b"]), ["a", "b"]);
    assert.deepEqual(mixFeed(["a", "b"], []), ["a", "b"]);
    assert.deepEqual(mixFeed(["a", "b", "c", "d"], ["x"]), ["a", "b", "x", "c", "d"]);
  });
});

describe("Home's ranked order", () => {
  const item = (id: string, score: number, newestAt = "2026-10-26T10:00:00.000Z") => ({ owner: { id }, score, newestAt });

  it("puts the best score first, the same way every time, whatever order the candidates came in", () => {
    const items = [item("c", 0.2), item("a", 0.9), item("d", 0.05), item("b", 0.5)];
    const order = rankOrder(items).map((i) => i.owner.id);
    assert.deepEqual(order, ["a", "b", "c", "d"]);
    for (let i = 0; i < 20; i++) {
      const shuffled = [...items].sort((x, y) => ((x.owner.id.charCodeAt(0) * (i + 3)) % 7) - ((y.owner.id.charCodeAt(0) * (i + 3)) % 7));
      assert.deepEqual(rankOrder(shuffled).map((x) => x.owner.id), order);
    }
  });

  it("breaks equal scores by the newest Story, then by owner id", () => {
    const order = rankOrder([item("z", 0.5, "2026-10-26T09:00:00.000Z"), item("y", 0.5, "2026-10-26T11:00:00.000Z"), item("b", 0.5, "2026-10-26T09:00:00.000Z")]);
    assert.deepEqual(order.map((i) => i.owner.id), ["y", "b", "z"]);
  });

  it("doesn't swap neighbours over a tiny drift in score", () => {
    const before = rankOrder([item("a", 0.495, "2026-10-26T09:00:00.000Z"), item("b", 0.496, "2026-10-26T11:00:00.000Z")]).map((i) => i.owner.id);
    const after = rankOrder([item("a", 0.497, "2026-10-26T09:00:00.000Z"), item("b", 0.495, "2026-10-26T11:00:00.000Z")]).map((i) => i.owner.id);
    assert.deepEqual(before, after);
    assert.deepEqual(rankOrder([item("a", 0.5), item("b", 0.6)]).map((i) => i.owner.id), ["b", "a"], "a real difference still counts");
  });

  it("keeps your own Stories (an infinite score) first", () => {
    assert.equal(rankOrder([item("x", 3), item("me", Infinity), item("y", 9)])[0]!.owner.id, "me");
  });

  it("allows at most three new people in a row on one topic while another topic is waiting", () => {
    assert.equal(MAX_TOPIC_RUN, 3);
    const topics = ["Food", "Food", "Food", "Food", "Food", "Travel", "Food", null, "Music"];
    const items = topics.map((topic, i) => ({ id: `n${i}`, topic }));
    const out = diversifyTopics(items, (i) => i.topic);
    assert.deepEqual(out.map((i) => i.id), ["n0", "n1", "n2", "n5", "n3", "n4", "n6", "n7", "n8"]);
    assert.equal(new Set(out).size, items.length, "nobody lost or repeated");
    const only = diversifyTopics([{ topic: "Food" }, { topic: "Food" }, { topic: "Food" }, { topic: "Food" }], (i) => i.topic);
    assert.equal(only.length, 4, "with nothing else waiting, the run continues");
    const untagged = [{ id: 1, topic: null }, { id: 2, topic: null }, { id: 3, topic: null }, { id: 4, topic: null }, { id: 5, topic: "Art" }];
    assert.deepEqual(diversifyTopics(untagged, (i) => i.topic).map((i) => i.id), [1, 2, 3, 4, 5], "no topic is no run");
  });
});
