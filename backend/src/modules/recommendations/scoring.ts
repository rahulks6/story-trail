/**
 * Pure scoring math for Phase 6's ranking (spec sections 7-11). There is
 * no trained model here and no training data to train one on — this is a
 * deterministic, documented heuristic over real counted signals, exactly
 * what spec section 7 calls "configurable starting weights, NOT
 * hard-coded permanent truth." Every function is pure and independently
 * testable; recommendation.service.ts is the only place that calls them
 * with real repository data.
 */

/**
 * Bayesian smoothing (spec section 11): pulls a rate with few observations
 * toward `priorRate` so one lucky (or unlucky) early viewer can't send a
 * new creator's score to an extreme. `priorWeight` is "how many
 * observations the prior is worth" — higher means new creators lean on
 * the platform-wide average longer before their own data takes over.
 */
export function bayesianSmooth(observedSuccesses: number, observedTotal: number, priorRate: number, priorWeight: number): number {
  return (observedSuccesses + priorRate * priorWeight) / (observedTotal + priorWeight);
}

/**
 * Freshness (spec section 10): 1.0 for a just-published Story, decaying
 * linearly to a floor as it approaches its own expiry — a Story about to
 * expire shouldn't rank alongside one just posted, but it should never
 * hit zero and vanish from scoring before it actually expires (expiry
 * itself is what removes it from candidates, in recommendation.repository.ts).
 */
export function freshness(createdAt: Date, expiresAt: Date, now: Date = new Date()): number {
  const totalMs = expiresAt.getTime() - createdAt.getTime();
  if (totalMs <= 0) return FRESHNESS_FLOOR;
  const elapsedMs = now.getTime() - createdAt.getTime();
  const remainingFraction = 1 - Math.min(Math.max(elapsedMs / totalMs, 0), 1);
  return FRESHNESS_FLOOR + (1 - FRESHNESS_FLOOR) * remainingFraction;
}
const FRESHNESS_FLOOR = 0.3;

/**
 * Exploration multiplier (spec section 11's progressive distribution —
 * "do not publicly promise those numbers," so these thresholds are
 * internal tuning constants, not a claim to surface anywhere). A creator
 * with very few lifetime impressions gets a strong boost so they have a
 * real chance to be seen at all; the boost fades as they accumulate a
 * track record, converging to no boost (1.0) rather than ever penalizing
 * established creators.
 */
export function explorationMultiplier(lifetimeImpressions: number): number {
  if (lifetimeImpressions < 20) return 3.0;
  if (lifetimeImpressions < 100) return 2.0;
  if (lifetimeImpressions < 500) return 1.3;
  if (lifetimeImpressions < 2000) return 1.1;
  return 1.0;
}

export interface AffinitySignals {
  isFollowing: boolean;
  profileVisits: number;
  meaningfulReplies: number; // comments — spec's "meaningful reply"
  distinctEngagementDays: number; // spec section 9: did they come back on a different day
  qualifiedViews: number;
  storyCompletions: number;
  sequenceContinuations: number;
  impressions: number; // denominator for the rate-based signals below
}

/**
 * Viewer→creator affinity (spec section 7's initial weights, section 10's
 * FinalScore component). Each signal is converted to a 0..1 rate (bounded
 * by impressions, i.e. opportunities to have shown that signal) and
 * combined by the spec's own starting percentages. `isFollowing` and
 * repeat visits are treated as strong standalone boosts on top, per
 * sections 8-9 ("voluntary repeat creator visit = extremely strong
 * positive"; follow is "very strong positive").
 */
export function creatorAffinity(signals: AffinitySignals): number {
  const opportunities = Math.max(signals.impressions, 1);
  const qualifiedWatchRate = Math.min(signals.qualifiedViews / opportunities, 1);
  const completionRate = Math.min(signals.storyCompletions / opportunities, 1);
  const sequenceRate = Math.min(signals.sequenceContinuations / opportunities, 1);
  const profileVisitRate = Math.min(signals.profileVisits / opportunities, 1);
  const replyRate = Math.min(signals.meaningfulReplies / opportunities, 1);
  const repeatVisitRate = Math.min(signals.distinctEngagementDays / 7, 1); // "came back on a different day" up to once a day over a week

  const weighted =
    0.1 * qualifiedWatchRate +
    0.1 * completionRate +
    0.1 * sequenceRate +
    0.1 * profileVisitRate +
    0.2 * (signals.isFollowing ? 1 : 0) +
    0.2 * replyRate +
    0.2 * repeatVisitRate;

  // Floor above zero: even a stranger's public Story should be rankable,
  // just low — a hard zero would make FinalScore's multiplication collapse
  // the whole candidate regardless of how good the Story itself is.
  return Math.max(weighted, 0.05);
}

export interface StoryQualitySignals {
  likeCount: number;
  commentCount: number;
  shareCount: number;
  viewCount: number;
}

/**
 * Story-level quality (spec section 10), independent of who's looking —
 * a weighted, view-count-normalized engagement rate, Bayesian-smoothed so
 * a Story with 2 views and 1 like doesn't outscore one with 500 views and
 * 80 likes. Weights follow spec section 8's relative signal strength
 * (share > comment > like).
 */
export function storyQuality(signals: StoryQualitySignals): number {
  const engagementScore = signals.likeCount * 1 + signals.commentCount * 2 + signals.shareCount * 3;
  const maxPossiblePerView = 3; // a view that also shared is the strongest single-view outcome
  const rate = engagementScore / Math.max(signals.viewCount, 1) / maxPossiblePerView;
  const smoothed = bayesianSmooth(rate * signals.viewCount, signals.viewCount, 0.05, 10);
  return Math.min(Math.max(smoothed, 0.05), 1);
}

/**
 * Learned interests (topic-affinity.repository.ts). What a viewer does with a Story moves
 * their score for the Story's topics (its own topic, or its owner's profile interests when it
 * has none) by these amounts; impressions and plain navigation move nothing. Creator-level
 * signals (a profile visit, a quick skip, "Not interested") use the creator's topics.
 */
export const TOPIC_SIGNALS = {
  qualified_view: 0.5,
  story_complete: 1,
  story_replay: 1,
  profile_visit: 1,
  like: 1,
  comment: 2,
  share: 2,
  more_like_this: 4,
  quick_skip: -1,
  not_interested: -3,
} as const;
export type TopicSignal = keyof typeof TOPIC_SIGNALS;

/** A watch shorter than this counts as a quick skip of that Story. */
export const QUICK_SKIP_MS = 1000;
/** How far one topic can move in a day, all signals together, so a burst can't take over Home. */
export const TOPIC_DAILY_CAP = 10;
export const TOPIC_HALF_LIFE_DAYS = 14;
/** Stored scores stay within these bounds. */
export const TOPIC_SCORE_MIN = -20;
export const TOPIC_SCORE_MAX = 100;

/** A learned score as it is now: it halves every 14 days since it was last updated. */
export function decayedTopicScore(score: number, updatedAt: Date, now: Date = new Date()): number {
  const days = Math.max(now.getTime() - updatedAt.getTime(), 0) / 86_400_000;
  return score * Math.pow(0.5, days / TOPIC_HALF_LIFE_DAYS);
}

/** The interests a viewer chose (a fixed +1 each, never decaying) and their learned scores, already decayed. */
export interface TopicProfile {
  chosen: readonly string[];
  learned: ReadonlyMap<string, number>;
}

/** Only the viewer's strongest topics count; the rest weigh nothing. */
const TOP_TOPICS = 8;
/** A viewer with only a few weak signals doesn't get full weight on them: scores are divided by at least this. */
const NORMALIZE_FLOOR = 2;

/**
 * Each topic's weight for this viewer, -1..1: chosen interests (+1 each) plus learned scores;
 * the strongest few positive ones divided by the strongest (or the floor), and disliked
 * (negative) topics divided the same way down to -1.
 */
export function topicWeights(profile: TopicProfile): Map<string, number> {
  const combined = new Map<string, number>();
  for (const topic of profile.chosen) combined.set(topic, (combined.get(topic) ?? 0) + 1);
  for (const [topic, score] of profile.learned) combined.set(topic, (combined.get(topic) ?? 0) + score);
  const positive = [...combined].filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, TOP_TOPICS);
  const negative = [...combined].filter(([, s]) => s < 0);
  const top = Math.max(positive[0]?.[1] ?? 0, NORMALIZE_FLOOR);
  const bottom = Math.max(...negative.map(([, s]) => -s), NORMALIZE_FLOOR);
  return new Map([...positive.map(([t, s]) => [t, s / top] as const), ...negative.map(([t, s]) => [t, s / bottom] as const)]);
}

/** New people: a Story on the viewer's strongest topic ranks up to 2.2x, one on a disliked topic down to 0.8x. */
const DISCOVERY_RANGE = { up: 1.2, down: 0.2 };
/** People you follow: closeness comes first, so interest moves them far less (0.9-1.3x). */
const FOLLOWED_RANGE = { up: 0.3, down: 0.1 };

/**
 * How well a creator's Stories match what the viewer likes, as a multiplier on their score.
 * The best-matching topic counts (a topic the viewer has no weight for counts as 0, so only
 * Stories whose every topic is disliked rank lower); with no topics it is 1.
 */
export function interestMatch(weights: ReadonlyMap<string, number>, topics: readonly string[], following: boolean): number {
  if (topics.length === 0) return 1;
  const best = Math.max(...topics.map((t) => weights.get(t) ?? 0));
  const range = following ? FOLLOWED_RANGE : DISCOVERY_RANGE;
  return best >= 0 ? 1 + range.up * Math.min(best, 1) : 1 + range.down * Math.max(best, -1);
}

/** How a learned score is shown in Settings (never the score itself); weak ones aren't shown. */
export function topicStrength(score: number): "high" | "medium" | null {
  if (score >= 5) return "high";
  if (score >= 1.5) return "medium";
  return null;
}
