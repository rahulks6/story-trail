/**
 * The languages the app can be used in (mobile/src/i18n): English, Hindi, Marathi, Spanish,
 * Portuguese, Indonesian, French, German and Arabic. Each account
 * keeps the one its phone last sent (users.locale, migration 0070), so pushes and emails reach the
 * person in it; English when there's none yet.
 */
export const LOCALES = ["en", "hi", "mr", "es", "pt", "id", "fr", "de", "ar"] as const;
export type Locale = (typeof LOCALES)[number];

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/** A stored or sent locale, or English for anything else (older rows, a missing value). */
export function asLocale(value: unknown): Locale {
  return isLocale(value) ? value : "en";
}

const COUNT_LOCALES: Record<Locale, string> = {
  en: "en-US", hi: "en-IN", mr: "en-IN", es: "es-419", pt: "pt-BR", id: "id-ID", fr: "fr-FR", de: "de-DE", ar: "ar-u-nu-latn",
};

/** Counts as each language groups them, always in Latin digits: 1,000 / 1,00,000 in hi and mr, 1.000 in de. */
export function formatCount(n: number, locale: Locale): string {
  return new Intl.NumberFormat(COUNT_LOCALES[locale], { maximumFractionDigits: 0 }).format(n);
}
