/**
 * How a public Story earns reach beyond its owner's followers (Phase 9; spec sections 9 and
 * 43). Pure decisions; the repository supplies the counts and the worker stores the result.
 *
 * Stages: 1 nearby, 2 wider area, 3 the same time zone, 4 everyone. Each Story starts at stage
 * 1. Only people who didn't follow the owner when they saw it count, because followers would
 * engage anyway. When a stage's test audience is used up (or the patience time has passed with
 * enough viewers), the Story moves up if those viewers engaged well, and otherwise stays where
 * it is ("held") and stops reaching new people. If too few people nearby saw it to tell, it
 * widens anyway, so a Story in a quiet area still finds an audience. These numbers are internal
 * tuning constants (REACH_CONFIG_JSON), never promised to creators.
 */
export type ReachStage = 1 | 2 | 3 | 4;

export interface ReachSettings {
  /** Viewers who don't follow the owner that each testing stage (1-3) may reach. */
  caps: [number, number, number];
  /** Engagement needed to move up from stages 1-3. */
  thresholds: [number, number, number];
  /** Fewest viewers a stage needs before it can be judged. */
  minSample: [number, number, number];
  /** After this long in a stage, judge it with what it has, or widen if too few saw it. */
  patienceMinutes: number;
}

export const DEFAULT_REACH: ReachSettings = {
  caps: [50, 300, 2000],
  thresholds: [0.3, 0.35, 0.4],
  minSample: [10, 40, 150],
  patienceMinutes: 120,
};

/** What the people who saw a Story at its current stage did, each counted once per person. */
export interface StageStats {
  impressions: number;
  completions: number;
  likes: number;
  comments: number;
  shares: number;
  profileVisits: number;
  follows: number;
  notInterested: number;
  quickSkips: number;
}

const PRIOR = 0.25;
const PRIOR_WEIGHT = 10;

/**
 * Engagement per viewer, smoothed toward a neutral prior so a handful of viewers can't decide
 * it. A follow is the strongest sign; "not interested" counts against.
 */
export function stageEngagement(s: StageStats): number {
  const points = 0.4 * s.completions + 0.3 * s.likes + 0.6 * s.comments + 0.6 * s.shares
    + 0.4 * s.profileVisits + 1.0 * s.follows - 1.0 * s.notInterested - 0.3 * s.quickSkips;
  return (points + PRIOR * PRIOR_WEIGHT) / (Math.max(s.impressions, 0) + PRIOR_WEIGHT);
}

export interface ReachState {
  stage: ReachStage;
  held: boolean;
  stageStartedAt: Date;
}

export interface ReachDecision extends ReachState {
  /** Why the stage changed this time, or null when nothing changed. */
  reason: "engaged" | "low_engagement" | "small_audience" | null;
  score: number;
}

export function decideReach(state: ReachState, stats: StageStats, now: Date, settings: ReachSettings = DEFAULT_REACH): ReachDecision {
  const score = stageEngagement(stats);
  if (state.stage === 4 || state.held) return { ...state, reason: null, score };
  const index = state.stage - 1;
  const cap = settings.caps[index]!, threshold = settings.thresholds[index]!, minSample = settings.minSample[index]!;
  const patient = now.getTime() - state.stageStartedAt.getTime() >= settings.patienceMinutes * 60_000;
  const next = (state.stage + 1) as ReachStage;
  if (stats.impressions >= cap || (patient && stats.impressions >= minSample)) {
    return score >= threshold
      ? { stage: next, held: false, stageStartedAt: now, reason: "engaged", score }
      : { ...state, held: true, reason: "low_engagement", score };
  }
  if (patient) return { stage: next, held: false, stageStartedAt: now, reason: "small_audience", score };
  return { ...state, reason: null, score };
}

/** The tuning constants, with any REACH_CONFIG_JSON overrides that are well-formed. */
export function reachSettings(json: string): ReachSettings {
  if (!json) return DEFAULT_REACH;
  let parsed: Partial<Record<keyof ReachSettings, unknown>>;
  try {
    parsed = JSON.parse(json) as typeof parsed;
  } catch {
    throw new Error("REACH_CONFIG_JSON is not valid JSON.");
  }
  const triple = (key: "caps" | "thresholds" | "minSample") => {
    const value = parsed[key];
    if (value === undefined) return DEFAULT_REACH[key];
    if (!Array.isArray(value) || value.length !== 3 || !value.every((n) => typeof n === "number" && Number.isFinite(n) && n >= 0)) {
      throw new Error(`REACH_CONFIG_JSON.${key} must be three non-negative numbers.`);
    }
    return value as [number, number, number];
  };
  const patience = parsed.patienceMinutes ?? DEFAULT_REACH.patienceMinutes;
  if (typeof patience !== "number" || !Number.isFinite(patience) || patience <= 0) {
    throw new Error("REACH_CONFIG_JSON.patienceMinutes must be a positive number.");
  }
  return { caps: triple("caps"), thresholds: triple("thresholds"), minSample: triple("minSample"), patienceMinutes: patience };
}
