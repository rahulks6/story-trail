/**
 * The topics people pick as interests and a Story can carry (one, optional). The server keeps
 * the canonical list; the app's copy (mobile/src/models/topics.ts) must be identical, which
 * verification/topics.cjs checks. Profile interests stay free text for older apps; only the
 * ones that name a topic here count as topics for ranking.
 */
export const TOPICS = [
  "Festivals", "Food", "Travel", "Music", "Bollywood", "Cricket", "Fashion", "Dance",
  "Devotional", "Fitness", "Movies", "Photography", "Art", "Comedy", "Gaming", "Tech",
  "Books", "Nature", "Football", "Cars", "Pets", "Startups",
] as const;

export type Topic = (typeof TOPICS)[number];

const BY_KEY = new Map<string, Topic>(TOPICS.map((t) => [t.toLowerCase(), t]));

/** The topic a value names, whatever its case and surrounding spaces; null when it names none. */
export function canonicalTopic(value: unknown): Topic | null {
  return typeof value === "string" ? BY_KEY.get(value.trim().toLowerCase()) ?? null : null;
}

/** The topics among a person's profile interests, in their order, each once. */
export function topicsOf(interests: readonly string[]): Topic[] {
  return [...new Set(interests.map(canonicalTopic).filter((t): t is Topic => t !== null))];
}

/** The list as a JSON parameter for SQL that maps free-text interests onto topics. */
export const TOPICS_JSON = JSON.stringify(TOPICS);

/**
 * Topics Katkee never learns from what someone watches: inferring them could reveal a special
 * category of personal data (religion, under GDPR and India's DPDP Act). They still count when
 * a person picks them as an interest, and creators can still tag a Story with them.
 */
export const NEVER_LEARNED: readonly Topic[] = ["Devotional"];
export const NEVER_LEARNED_JSON = JSON.stringify(NEVER_LEARNED);
