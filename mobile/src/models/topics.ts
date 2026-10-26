/**
 * What people pick as interests and a Story's optional topic. The server keeps the canonical
 * list (backend/src/shared/topics.ts); this copy must stay identical, which
 * verification/topics.cjs checks.
 */
export const TOPICS = [
  "Festivals", "Food", "Travel", "Music", "Bollywood", "Cricket", "Fashion", "Dance",
  "Devotional", "Fitness", "Movies", "Photography", "Art", "Comedy", "Gaming", "Tech",
  "Books", "Nature", "Football", "Cars", "Pets", "Startups",
];

export function isTopic(value: unknown): value is string {
  return typeof value === "string" && TOPICS.includes(value);
}
