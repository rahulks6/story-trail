import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  bayesianSmooth, creatorAffinity, decayedTopicScore, explorationMultiplier, freshness, interestMatch, storyQuality,
  TOPIC_HALF_LIFE_DAYS, TOPIC_SIGNALS, topicStrength, topicWeights,
} from "../src/modules/recommendations/scoring";

describe("bayesianSmooth", () => {
  it("pulls a small sample toward the prior", () => {
    // 1 success out of 1 observation would naively be a 100% rate — smoothing must pull it well below that.
    const smoothed = bayesianSmooth(1, 1, 0.1, 10);
    assert.ok(smoothed < 0.3, `expected a heavily-smoothed low rate, got ${smoothed}`);
    assert.ok(smoothed > 0.1, "should still be pulled up somewhat by the one real success");
  });

  it("converges to the true rate as observations grow", () => {
    const smoothed = bayesianSmooth(500, 1000, 0.1, 10);
    assert.ok(Math.abs(smoothed - 0.5) < 0.02, `expected close to the observed 0.5 rate, got ${smoothed}`);
  });

  it("returns exactly the prior with zero observations", () => {
    assert.equal(bayesianSmooth(0, 0, 0.2, 10), 0.2);
  });
});

describe("freshness", () => {
  it("is 1.0 for a Story published this instant", () => {
    const now = new Date("2026-01-01T12:00:00Z");
    const createdAt = new Date("2026-01-01T12:00:00Z");
    const expiresAt = new Date("2026-01-02T12:00:00Z");
    assert.equal(freshness(createdAt, expiresAt, now), 1);
  });

  it("decays toward the floor as expiry approaches, never reaching zero", () => {
    const createdAt = new Date("2026-01-01T00:00:00Z");
    const expiresAt = new Date("2026-01-02T00:00:00Z");
    const almostExpired = new Date("2026-01-01T23:59:00Z");
    const score = freshness(createdAt, expiresAt, almostExpired);
    assert.ok(score > 0, "must never hit zero — expiry itself removes the Story from candidates");
    assert.ok(score < 0.35, `expected close to the floor, got ${score}`);
  });

  it("is monotonically decreasing over time", () => {
    const createdAt = new Date("2026-01-01T00:00:00Z");
    const expiresAt = new Date("2026-01-02T00:00:00Z");
    const early = freshness(createdAt, expiresAt, new Date("2026-01-01T02:00:00Z"));
    const later = freshness(createdAt, expiresAt, new Date("2026-01-01T20:00:00Z"));
    assert.ok(early > later, "a newer Story must score higher than an older one from the same creator");
  });
});

describe("explorationMultiplier", () => {
  it("gives brand-new creators the strongest boost, fading to 1.0 as they accumulate impressions", () => {
    const brandNew = explorationMultiplier(0);
    const emerging = explorationMultiplier(50);
    const established = explorationMultiplier(1000);
    const veryEstablished = explorationMultiplier(50000);
    assert.ok(brandNew > emerging, "brand-new must be boosted more than emerging");
    assert.ok(emerging > established, "emerging must be boosted more than established");
    assert.ok(established >= veryEstablished, "the multiplier must never keep growing without bound");
    assert.equal(veryEstablished, 1, "a very established creator gets no exploration boost at all");
  });
});

describe("creatorAffinity", () => {
  const base = {
    isFollowing: false,
    profileVisits: 0,
    meaningfulReplies: 0,
    distinctEngagementDays: 0,
    qualifiedViews: 0,
    storyCompletions: 0,
    sequenceContinuations: 0,
    impressions: 10,
  };

  it("a follower scores meaningfully higher than a stranger with identical other signals", () => {
    const stranger = creatorAffinity(base);
    const follower = creatorAffinity({ ...base, isFollowing: true });
    assert.ok(follower > stranger);
    assert.ok(follower - stranger >= 0.15, "isFollowing should be worth close to its full 0.2 weight");
  });

  it("returning on multiple distinct days scores higher than a single burst of engagement", () => {
    const oneDay = creatorAffinity({ ...base, distinctEngagementDays: 1 });
    const sevenDays = creatorAffinity({ ...base, distinctEngagementDays: 7 });
    assert.ok(sevenDays > oneDay, "spec section 9: a follow/engagement is worth more if the viewer keeps coming back");
  });

  it("never returns exactly zero, even with no positive signal at all", () => {
    assert.ok(creatorAffinity(base) > 0);
  });

  it("meaningful replies increase the score", () => {
    const noReplies = creatorAffinity(base);
    const withReplies = creatorAffinity({ ...base, meaningfulReplies: 5 });
    assert.ok(withReplies > noReplies);
  });
});

describe("storyQuality", () => {
  it("a highly-engaged Story scores higher than a barely-engaged one at the same view count", () => {
    const dull = storyQuality({ likeCount: 1, commentCount: 0, shareCount: 0, viewCount: 100 });
    const popular = storyQuality({ likeCount: 40, commentCount: 15, shareCount: 5, viewCount: 100 });
    assert.ok(popular > dull);
  });

  it("smooths a tiny sample instead of trusting a lucky early ratio", () => {
    const tinySampleHighRatio = storyQuality({ likeCount: 1, commentCount: 0, shareCount: 0, viewCount: 1 });
    const largeSampleSameRatio = storyQuality({ likeCount: 100, commentCount: 0, shareCount: 0, viewCount: 100 });
    assert.ok(
      tinySampleHighRatio < largeSampleSameRatio,
      "1 view / 1 like must not outscore 100 views / 100 likes despite an identical raw ratio",
    );
  });

  it("stays within [0.05, 1] regardless of extreme input", () => {
    const zero = storyQuality({ likeCount: 0, commentCount: 0, shareCount: 0, viewCount: 0 });
    const huge = storyQuality({ likeCount: 100000, commentCount: 100000, shareCount: 100000, viewCount: 1 });
    assert.ok(zero >= 0.05 && zero <= 1);
    assert.ok(huge >= 0.05 && huge <= 1);
  });
});

describe("learned interests", () => {
  const day = 86_400_000;

  it("halve every 14 days since they were last updated", () => {
    const at = new Date("2026-10-01T00:00:00Z");
    assert.equal(decayedTopicScore(8, at, at), 8);
    assert.ok(Math.abs(decayedTopicScore(8, at, new Date(at.getTime() + 14 * day)) - 4) < 1e-9);
    assert.ok(Math.abs(decayedTopicScore(8, at, new Date(at.getTime() + 28 * day)) - 2) < 1e-9);
    assert.ok(Math.abs(decayedTopicScore(-4, at, new Date(at.getTime() + 14 * day)) + 2) < 1e-9, "dislikes fade too");
    assert.equal(decayedTopicScore(8, at, new Date(at.getTime() - day)), 8, "a clock behind never grows a score");
    assert.equal(TOPIC_HALF_LIFE_DAYS, 14);
  });

  it("weigh chosen interests as a small fixed prior and learned ones by how strong they are", () => {
    const chosenOnly = topicWeights({ chosen: ["Food", "Travel"], learned: new Map() });
    assert.equal(chosenOnly.get("Food"), 0.5, "one chosen interest alone isn't full weight");
    const learned = topicWeights({ chosen: ["Food"], learned: new Map([["Cricket", 9], ["Food", 1], ["Pets", -6]]) });
    assert.equal(learned.get("Cricket"), 1, "the strongest topic is 1");
    assert.ok(Math.abs(learned.get("Food")! - 2 / 9) < 1e-9, "prior plus learned, divided by the strongest");
    assert.equal(learned.get("Pets"), -1);
    assert.equal(learned.has("Art"), false);
    const many = topicWeights({ chosen: [], learned: new Map(Array.from({ length: 12 }, (_, i) => [`T${i}`, 12 - i] as [string, number])) });
    assert.equal([...many.values()].filter((w) => w > 0).length, 8, "only the strongest eight count");
  });

  it("match a Story's topics within the old range for new people, and much less for people you follow", () => {
    const weights = topicWeights({ chosen: [], learned: new Map([["Cricket", 10], ["Food", 5], ["Pets", -10]]) });
    assert.ok(Math.abs(interestMatch(weights, ["Cricket"], false) - 2.2) < 1e-9);
    assert.ok(Math.abs(interestMatch(weights, ["Food"], false) - 1.6) < 1e-9);
    assert.equal(interestMatch(weights, ["Art"], false), 1, "a topic the viewer has no weight for changes nothing");
    assert.equal(interestMatch(weights, [], false), 1, "nor does a Story without topics");
    assert.ok(Math.abs(interestMatch(weights, ["Pets"], false) - 0.8) < 1e-9, "a disliked topic ranks a little lower");
    assert.equal(interestMatch(weights, ["Pets", "Art"], false), 1, "unless something else about it is neutral");
    assert.equal(interestMatch(weights, ["Pets", "Cricket"], false), interestMatch(weights, ["Cricket"], false), "the best topic counts");
    assert.ok(Math.abs(interestMatch(weights, ["Cricket"], true) - 1.3) < 1e-9, "closeness comes first for people you follow");
    assert.ok(interestMatch(weights, ["Pets"], true) >= 0.9);
  });

  it("never let interest outweigh following someone", () => {
    const base = { isFollowing: false, profileVisits: 0, meaningfulReplies: 0, distinctEngagementDays: 0, qualifiedViews: 0, storyCompletions: 0, sequenceContinuations: 0, impressions: 10 };
    const weights = topicWeights({ chosen: [], learned: new Map([["Cricket", 10], ["Food", 1]]) });
    const followedOffTopic = creatorAffinity({ ...base, isFollowing: true, distinctEngagementDays: 3 }) * interestMatch(weights, ["Food"], true);
    const followedOnTopic = creatorAffinity({ ...base, isFollowing: true }) * interestMatch(weights, ["Cricket"], true);
    assert.ok(followedOffTopic > followedOnTopic, "someone you're close to stays ahead of a closer topic match");
  });

  it("move a topic by fixed, documented amounts", () => {
    assert.ok(TOPIC_SIGNALS.more_like_this > TOPIC_SIGNALS.comment && TOPIC_SIGNALS.comment > TOPIC_SIGNALS.like && TOPIC_SIGNALS.like > 0);
    assert.equal(TOPIC_SIGNALS.comment, TOPIC_SIGNALS.share);
    assert.ok(TOPIC_SIGNALS.not_interested < TOPIC_SIGNALS.quick_skip && TOPIC_SIGNALS.quick_skip < 0);
  });

  it("show as high or medium, never as a score, and not at all when weak", () => {
    assert.equal(topicStrength(12), "high");
    assert.equal(topicStrength(2), "medium");
    assert.equal(topicStrength(0.5), null);
    assert.equal(topicStrength(-3), null);
  });
});
