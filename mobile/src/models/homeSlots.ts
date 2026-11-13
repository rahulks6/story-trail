/**
 * Home shows one Story at a time, mixed across people: everyone's first Story in the feed's own
 * (ranked) order, then everyone's second, and so on, so nobody's five Stories come in a row.
 * More of the feed (a next page) is added after what's there, never reshuffling what's on screen.
 */
export interface HomeSlot {
  username: string;
  /** "" when the feed didn't list the person's Stories: the viewer shows their first. */
  storyId: string;
}

interface FeedPerson {
  owner: { username: string };
  stories: Array<{ id: string }>;
}

/** The people's Stories, taking turns: round 1 is each person's first Story, round 2 their second. */
export function takeTurns(entries: readonly FeedPerson[]): HomeSlot[] {
  const slots: HomeSlot[] = [];
  // A person listed without their Stories still gets one place (their first Story).
  const lists = entries.map((e) => (e.stories.length ? e.stories.map((s) => s.id) : [""]));
  const longest = Math.max(0, ...lists.map((l) => l.length));
  for (let round = 0; round < longest; round++) {
    entries.forEach((entry, i) => {
      const id = lists[i]![round];
      if (id !== undefined) slots.push({ username: entry.owner.username, storyId: id });
    });
  }
  // Never the same person twice in a row (the last rounds may hold only one person): those wait
  // behind someone else where they can.
  for (let i = 1; i < slots.length; i++) {
    if (slots[i]!.username !== slots[i - 1]!.username) continue;
    const swap = slots.findIndex((s, j) => j > i && s.username !== slots[i - 1]!.username);
    if (swap > i) [slots[i], slots[swap]] = [slots[swap]!, slots[i]!];
  }
  return slots;
}

/**
 * The slots for a feed, keeping `previous` (built from `previousFeed`) when the feed only grew at
 * the end, so the Story on screen keeps its place.
 */
export function extendSlots<T extends FeedPerson>(feed: readonly T[], previousFeed: readonly T[] | null, previous: HomeSlot[]): HomeSlot[] {
  const grew = !!previousFeed && previousFeed.length > 0 && feed.length >= previousFeed.length && previousFeed.every((e, i) => e === feed[i]);
  if (!grew) return takeTurns(feed);
  return [...previous, ...takeTurns(feed.slice(previousFeed!.length))];
}
