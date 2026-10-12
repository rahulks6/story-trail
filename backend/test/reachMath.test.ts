// The pure parts of Phase 9 (reach and Home's mix): area cells, stage decisions and the
// shuffled mix, checked with a fixed random source so every run is the same.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { AREA_CELL_RE, cellsAround, decodeGeohash, encodeGeohash } from "../src/modules/recommendations/geohash";
import { DEFAULT_REACH, decideReach, reachSettings, stageEngagement, type StageStats } from "../src/modules/recommendations/reach";
import { FOLLOWED_SHARE, mixFeed, weightedShuffle } from "../src/modules/recommendations/feed-mix";

/** A seeded random source (mulberry32). */
function seeded(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

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

  it("starts with someone you follow, keeps everyone exactly once, and is 60% people you follow in every five", () => {
    assert.equal(FOLLOWED_SHARE, 0.6);
    const random = seeded(7);
    const arrangements = new Set<string>();
    for (let run = 0; run < 200; run++) {
      const mixed = mixFeed(followed, fresh, random);
      assert.equal(mixed[0]!.startsWith("f"), true);
      assert.equal(new Set(mixed).size, 60);
      for (let block = 0; block < 10; block++) {
        const five = mixed.slice(block * 5, block * 5 + 5);
        assert.equal(five.filter((id) => id.startsWith("f")).length, 3, five.join());
      }
      arrangements.add(mixed.slice(0, 10).map((id) => id[0]).join(""));
    }
    assert.ok(arrangements.size >= 8, "the arrangement varies");
  });

  it("never shows more than two new people in a row while people you follow are left", () => {
    const random = seeded(11);
    for (let run = 0; run < 200; run++) {
      const mixed = mixFeed(followed.slice(0, 10), fresh, random);
      let inARow = 0, followedSeen = 0;
      for (const id of mixed) {
        if (id.startsWith("f")) { followedSeen++; inARow = 0; } else if (followedSeen < 10) { inARow++; assert.ok(inARow <= 2); }
      }
    }
  });

  it("falls back to whichever list remains", () => {
    assert.deepEqual(mixFeed([], ["a", "b"], seeded(1)), ["a", "b"]);
    assert.deepEqual(mixFeed(["a", "b"], [], seeded(1)), ["a", "b"]);
  });

  it("shuffles differently each time while favouring better scores", () => {
    const random = seeded(3);
    const items = [{ id: "best", w: 10 }, { id: "ok", w: 2 }, { id: "low", w: 1 }];
    const orders = new Set<string>();
    let bestFirst = 0;
    for (let run = 0; run < 1000; run++) {
      const order = weightedShuffle(items, (i) => i.w, random).map((i) => i.id);
      orders.add(order.join());
      if (order[0] === "best") bestFirst++;
    }
    assert.ok(orders.size >= 4, "orders vary");
    assert.ok(bestFirst > 700 && bestFirst < 950, `best first ${bestFirst}/1000`);
    assert.deepEqual(weightedShuffle(items, (i) => i.w, seeded(5)), weightedShuffle(items, (i) => i.w, seeded(5)), "same seed, same order");
  });
});
