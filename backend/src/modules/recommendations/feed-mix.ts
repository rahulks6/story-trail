/**
 * Home's order (Phase 9): a different shuffle on every refresh, mixing people you follow with
 * new people. Pure, with the random source passed in so tests can fix it.
 */

/**
 * Each five places hold three people you follow and two new people, arranged at random, so
 * Home is 60% people you follow (while any are left) without a fixed pattern.
 */
const BLOCK: readonly boolean[] = [true, true, true, false, false];
export const FOLLOWED_SHARE = BLOCK.filter(Boolean).length / BLOCK.length;
/** Never more than this many new people in a row while people you follow are left. */
const MAX_NEW_IN_A_ROW = 2;

/**
 * A random order that still favours better items: each item's chance of coming earlier grows
 * with its weight (Efraimidis-Spirakis sampling), so the order changes every time without
 * burying what is most likely to be good.
 */
export function weightedShuffle<T>(items: readonly T[], weight: (item: T) => number, random: () => number): T[] {
  return items
    .map((item) => ({ item, key: Math.log(Math.max(random(), Number.MIN_VALUE)) / Math.max(weight(item), 1e-9) }))
    .sort((a, b) => b.key - a.key)
    .map((entry) => entry.item);
}

/** A random arrangement of the next five places; the first place of all is someone you follow. */
function nextBlock(random: () => number, isFirst: boolean, newAtEnd: number): boolean[] {
  for (;;) {
    const block = [...BLOCK];
    for (let i = block.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [block[i], block[j]] = [block[j]!, block[i]!];
    }
    const leadingNew = block.indexOf(true);
    if (isFirst && leadingNew !== 0) continue;
    if (newAtEnd + leadingNew > MAX_NEW_IN_A_ROW) continue;
    return block;
  }
}

/**
 * Interleaves people you follow with new people, 3 to 2 in every five places, starting with
 * someone you follow when there is anyone. When either list runs out, the rest of the other
 * follows.
 */
export function mixFeed<T>(followed: readonly T[], discovery: readonly T[], random: () => number): T[] {
  const out: T[] = [];
  let f = 0, d = 0, newInARow = 0, block: boolean[] = [];
  // Blocks apply only while both lists have someone left, so their rules can always be met.
  while (f < followed.length && d < discovery.length) {
    if (block.length === 0) block = nextBlock(random, out.length === 0, newInARow);
    if (block.shift()) {
      out.push(followed[f++]!);
      newInARow = 0;
    } else {
      out.push(discovery[d++]!);
      newInARow++;
    }
  }
  return [...out, ...followed.slice(f), ...discovery.slice(d)];
}
