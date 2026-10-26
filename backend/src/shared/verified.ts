/**
 * The verified badge shows when an admin approved the account and it isn't on hold after a
 * rename (migration 0057). Every user summary the API returns carries it as `verified`, so the
 * condition lives here once. `alias` is the users table's alias in the query.
 */
export function verifiedSql(alias = ""): string {
  const p = alias ? `${alias}.` : "";
  return `(${p}verified_at IS NOT NULL AND ${p}verification_hold_at IS NULL)`;
}

/**
 * Tick-like characters nobody may put in a name, so a name can't imitate the badge: check
 * marks, ballot boxes with a check, the square root sign and their emoji forms (a variation
 * selector after one doesn't hide it).
 */
const CHECK_MARKS = /[√⍻☑✅✓✔\u{10102}\u{1F5F8}\u{1F5F9}\u{1FBB1}]/u;
export const CHECK_MARK_MESSAGE = "Names can't include check marks.";

export function hasCheckMark(name: string): boolean {
  return CHECK_MARKS.test(name);
}

/** A name from elsewhere (a Google account) with any check marks taken out. */
export function withoutCheckMarks(name: string): string {
  return name.replace(new RegExp(CHECK_MARKS.source + "[\\uFE0E\\uFE0F]?", "gu"), "").replace(/\s{2,}/g, " ").trim();
}
