/**
 * Date of birth at sign-up. Katkee is for people 18 and older: the server decides
 * (backend/src/modules/auth/age.ts) and these mirror its rule and messages so most problems show
 * before a round trip. verification/minimum-age.cjs checks the two agree.
 *
 * People type DD/MM/YYYY, the way dates are written in India; the API takes YYYY-MM-DD.
 */
export const MINIMUM_AGE = 18;

export const BIRTH_DATE_MESSAGES = {
  required: "Enter your date of birth.",
  invalid: "Enter a valid date of birth.",
  tooYoung: `Katkee is only for people ${MINIMUM_AGE} and older.`,
} as const;

/** India Standard Time is UTC+05:30 all year: a birthday counts from midnight in India. */
const INDIA_UTC_OFFSET_MS = 330 * 60_000;

/** Today's date in India, as YYYY-MM-DD. */
export function todayInIndia(now: number = Date.now()): string {
  return new Date(now + INDIA_UTC_OFFSET_MS).toISOString().slice(0, 10);
}

/** Keeps up to eight digits and adds the slashes as they type: "15051995" → "15/05/1995". */
export function formatBirthDateInput(text: string): string {
  const digits = text.replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

/** "15/05/1995" → "1995-05-15"; null until all eight digits are there. */
export function birthDateToIso(display: string): string | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(display);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : null;
}

/** Same rule as the server: a real date from 1900 to today, and at least MINIMUM_AGE today in India. */
export function birthDateProblem(iso: string | null, now: number = Date.now()): string | undefined {
  if (!iso) return BIRTH_DATE_MESSAGES.required;
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  const real = y >= 1900 && date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
  const today = todayInIndia(now);
  if (!real || iso > today) return BIRTH_DATE_MESSAGES.invalid;
  const [ty, tm, td] = today.split("-").map(Number) as [number, number, number];
  const age = ty - y - (tm < m || (tm === m && td < d) ? 1 : 0);
  return age < MINIMUM_AGE ? BIRTH_DATE_MESSAGES.tooYoung : undefined;
}

/**
 * What to show under the field: nothing while they're still typing, then the problem with the
 * finished date, if any.
 */
export function birthDateFieldProblem(display: string, now: number = Date.now()): string | undefined {
  if (display.replace(/\D/g, "").length < 8) return undefined;
  return birthDateProblem(birthDateToIso(display), now);
}
