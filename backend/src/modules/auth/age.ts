/**
 * Katkee is for people 18 and older (Terms of Service section 2). India's Digital Personal Data
 * Protection Act 2023 treats everyone under 18 as a child, so the minimum age is fixed here, not
 * configurable, and the app, the Terms and the Privacy Policy say the same thing
 * (verification/minimum-age.cjs checks they agree).
 *
 * Every new account gives a date of birth: sign-up with an email address and finishing sign-up
 * with Google or a phone number. Someone under 18 is refused before anything about them is stored.
 */
export const MINIMUM_AGE = 18;

/** India Standard Time is UTC+05:30 all year: a birthday counts from midnight in India. */
const INDIA_UTC_OFFSET_MS = 330 * 60_000;

export const BIRTH_DATE_MESSAGES = {
  required: "Enter your date of birth.",
  invalid: "Enter a valid date of birth.",
  tooYoung: `Katkee is only for people ${MINIMUM_AGE} and older.`,
} as const;

/** Today's date in India, as YYYY-MM-DD. */
export function todayInIndia(now: number = Date.now()): string {
  return new Date(now + INDIA_UTC_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * Whole years from `birthDate` to `today` (both YYYY-MM-DD). Someone born on 29 February turns a
 * year older on 1 March in years without one.
 */
export function ageOn(birthDate: string, today: string): number {
  const [by, bm, bd] = birthDate.split("-").map(Number) as [number, number, number];
  const [ty, tm, td] = today.split("-").map(Number) as [number, number, number];
  return ty - by - (tm < bm || (tm === bm && td < bd) ? 1 : 0);
}

/**
 * Why a date of birth (YYYY-MM-DD) can't be accepted, or null when it is a real date on or after
 * 1 January 1900, not in the future, and the person is at least MINIMUM_AGE today in India.
 */
export function birthDateProblem(value: unknown, now: number = Date.now()): string | null {
  if (value === undefined || value === null || value === "") return BIRTH_DATE_MESSAGES.required;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return BIRTH_DATE_MESSAGES.invalid;
  const [y, m, d] = value.split("-").map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  const real = y >= 1900 && date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
  const today = todayInIndia(now);
  if (!real || value > today) return BIRTH_DATE_MESSAGES.invalid;
  return ageOn(value, today) < MINIMUM_AGE ? BIRTH_DATE_MESSAGES.tooYoung : null;
}
