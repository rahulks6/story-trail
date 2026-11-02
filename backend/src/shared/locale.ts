/**
 * The languages the app can be used in (mobile/src/i18n): English, Hindi and Marathi. Each account
 * keeps the one its phone last sent (users.locale, migration 0070), so pushes and emails reach the
 * person in it; English when there's none yet.
 */
export const LOCALES = ["en", "hi", "mr"] as const;
export type Locale = (typeof LOCALES)[number];

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/** A stored or sent locale, or English for anything else (older rows, a missing value). */
export function asLocale(value: unknown): Locale {
  return isLocale(value) ? value : "en";
}

/** Counts as each language groups them, always in Latin digits: 1,000 / 1,00,000 in hi and mr. */
export function formatCount(n: number, locale: Locale): string {
  return new Intl.NumberFormat(locale === "en" ? "en-US" : "en-IN", { maximumFractionDigits: 0 }).format(n);
}
