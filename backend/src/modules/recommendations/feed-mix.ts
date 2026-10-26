/**
 * Home's order: a stable ranked list, best match first, mixing people you follow with new
 * people. No randomness: the same Stories and signals give the same order on every refresh.
 * Pure, so tests can check it directly.
 */

/**
 * Each five places hold three people you follow and two new people, always in this order
 * (followed, followed, new, followed, new), so Home is 60% people you follow while any are left
 * and starts with someone you follow.
 */
const BLOCK: readonly boolean[] = [true, true, false, true, false];
export const FOLLOWED_SHARE = BLOCK.filter(Boolean).length / BLOCK.length;
/** A new person's run of one topic is broken after this many in a row when another topic is waiting. */
export const MAX_TOPIC_RUN = 3;

/**
 * Scores within about 2% of each other count as equal, so tiny drifts (a Story getting a few
 * minutes older) don't swap neighbours between refreshes; equal scores fall back to the
 * newest Story, then the owner's id.
 */
function scoreBucket(score: number): number {
  if (score === Infinity) return Infinity;
  return Math.round(Math.log(Math.max(score, 1e-9)) * 50);
}

export interface Rankable {
  owner: { id: string };
  score: number;
  /** ISO time of the creator's newest Story. */
  newestAt: string;
}

/** Best first; deterministic for equal scores. */
export function rankOrder<T extends Rankable>(items: readonly T[]): T[] {
  return [...items].sort(
    (a, b) =>
      scoreBucket(b.score) - scoreBucket(a.score) ||
      (a.newestAt < b.newestAt ? 1 : a.newestAt > b.newestAt ? -1 : 0) ||
      (a.owner.id < b.owner.id ? -1 : a.owner.id > b.owner.id ? 1 : 0),
  );
}

/**
 * Keeps the ranked order but never puts more than MAX_TOPIC_RUN items with the same primary
 * topic in a row while an item on another topic (or none) is still waiting: the best such item
 * moves up. Items without a topic never form a run.
 */
export function diversifyTopics<T>(ranked: readonly T[], topicOf: (item: T) => string | null): T[] {
  const left = [...ranked];
  const out: T[] = [];
  while (left.length > 0) {
    const last = out.slice(-MAX_TOPIC_RUN).map(topicOf);
    const run = last.length === MAX_TOPIC_RUN && last[0] !== null && last.every((t) => t === last[0]) ? last[0] : null;
    let pick = 0;
    if (run !== null && topicOf(left[0]!) === run) {
      const other = left.findIndex((item) => topicOf(item) !== run);
      if (other >= 0) pick = other;
    }
    out.push(left.splice(pick, 1)[0]!);
  }
  return out;
}

/**
 * Interleaves people you follow with new people in the fixed pattern above, each list in its
 * own ranked order. When either list runs out, the rest of the other follows.
 */
export function mixFeed<T>(followed: readonly T[], discovery: readonly T[]): T[] {
  const out: T[] = [];
  let f = 0, d = 0, place = 0;
  while (f < followed.length && d < discovery.length) {
    out.push(BLOCK[place++ % BLOCK.length] ? followed[f++]! : discovery[d++]!);
  }
  return [...out, ...followed.slice(f), ...discovery.slice(d)];
}
