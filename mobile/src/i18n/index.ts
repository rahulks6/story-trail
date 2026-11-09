/**
 * The app's languages: English (the source of truth, en.ts), Hindi, Marathi, Spanish, Portuguese,
 * Indonesian, French, German and Arabic (right to left). No library: a
 * typed catalogue, {name} interpolation, plurals by Intl.PluralRules (with the CLDR rules for
 * these three languages as a fallback, since Hermes may not ship PluralRules) and numbers in the
 * language's own grouping, always with Latin digits (what Indian apps show; see GLOSSARY.md).
 *
 * t() reads the current language, so it works anywhere: screens, alerts, toasts, helpers. A
 * language change re-renders what uses useLanguage(); the navigation tree is remounted on a
 * change (RootNavigator) so every screen, header and memoized row picks up the new text.
 */
import { useSyncExternalStore } from "react";
import { I18nManager, NativeModules, Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { en } from "./en";
import { hi } from "./hi";
import { mr } from "./mr";
import { es } from "./es";
import { pt } from "./pt";
import { id } from "./id";
import { fr } from "./fr";
import { de } from "./de";
import { ar } from "./ar";
import type { Catalogue, MessageKey, ParamsOf, PluralForms } from "./types";

export type { MessageKey } from "./types";

export const LANGUAGES = ["en", "es", "pt", "fr", "de", "id", "ar", "hi", "mr"] as const;
export type Language = (typeof LANGUAGES)[number];

/** Each language's name in its own script: what Settings > Language lists (never translated). */
export const LANGUAGE_NAMES: Record<Language, string> = {
  en: "English", es: "Español", pt: "Português", fr: "Français", de: "Deutsch", id: "Bahasa Indonesia", ar: "العربية", hi: "हिन्दी", mr: "मराठी",
};
/** Languages written right to left: the layout mirrors (start and end swap). */
export const RTL_LANGUAGES: readonly Language[] = ["ar"];

// en, hi and mr must be complete (typed Catalogue); a newer language is listed only once it is.
const CATALOGUES: Record<Language, Partial<Catalogue>> = { en, hi, mr, es, pt, id, fr, de, ar };
const ENGLISH_KEYS = Object.keys(en).length;

/** The languages whose translation is complete: what Settings offers and the phone's language can pick. */
export const READY_LANGUAGES: readonly Language[] = LANGUAGES.filter((language) => Object.keys(CATALOGUES[language]).length >= ENGLISH_KEYS);
/** BCP 47 tags for Intl: Indian conventions (1,00,000 grouping for hi/mr) with Latin digits. */
const LOCALE_TAGS: Record<Language, string> = {
  en: "en-US", hi: "hi-IN-u-nu-latn", mr: "mr-IN-u-nu-latn",
  es: "es-419", pt: "pt-BR", id: "id-ID", fr: "fr-FR", de: "de-DE", ar: "ar-u-nu-latn",
};
const STORAGE_KEY = "katkee.language.v1";

export function isLanguage(value: unknown): value is Language {
  return typeof value === "string" && (LANGUAGES as readonly string[]).includes(value);
}

/** The phone's language when it's one of ours (hi_IN, mr-IN, en-GB...), otherwise English. */
export function deviceLanguage(): Language {
  const candidates: unknown[] = [];
  try {
    if (Platform.OS === "ios") {
      const settings = NativeModules.SettingsManager?.settings;
      candidates.push(settings?.AppleLanguages?.[0], settings?.AppleLocale);
    } else {
      candidates.push(NativeModules.I18nManager?.localeIdentifier);
    }
  } catch {
    // Native modules missing (tests, web): fall through to Intl.
  }
  try {
    candidates.push(Intl.DateTimeFormat().resolvedOptions().locale);
  } catch {
    // No Intl: English.
  }
  for (const tag of candidates) {
    if (typeof tag !== "string" || !tag) continue;
    const code = tag.toLowerCase().split(/[-_]/)[0];
    return isLanguage(code) && READY_LANGUAGES.includes(code) ? code : "en";
  }
  return "en";
}

let current: Language = "en";
/** Whether the person picked a language in Settings (otherwise it follows the phone). */
let chosen = false;
const listeners = new Set<() => void>();

export function getLanguage(): Language {
  return current;
}

/** The Intl locale for dates and numbers in the current language. */
export function localeTag(language: Language = current): string {
  return LOCALE_TAGS[language];
}

/**
 * Arabic lays the app out right to left. Android and iOS apply a direction change when the app
 * next starts, so a switch to or from Arabic asks for a restart (needsRestartForDirection).
 */
function syncDirection(language: Language): void {
  const rtl = RTL_LANGUAGES.includes(language);
  try {
    I18nManager.allowRTL(rtl);
    I18nManager.forceRTL(rtl);
  } catch {
    // No native module (tests, web).
  }
}

/** True when the layout direction on screen isn't the language's yet (until the app restarts). */
export function needsRestartForDirection(language: Language = current): boolean {
  return !!I18nManager && I18nManager.isRTL !== RTL_LANGUAGES.includes(language);
}

function apply(language: Language): void {
  syncDirection(language);
  if (language === current) return;
  current = language;
  listeners.forEach((listener) => listener());
}

/**
 * Startup: the saved choice, or the phone's language. Resolves once the language is known; until
 * then text is English (the first frame is the splash).
 */
export async function initLanguage(): Promise<Language> {
  let saved: string | null = null;
  try {
    saved = await AsyncStorage.getItem(STORAGE_KEY);
  } catch {
    // Storage unavailable: follow the phone.
  }
  const usable = isLanguage(saved) && READY_LANGUAGES.includes(saved);
  chosen = usable;
  apply(usable ? (saved as Language) : deviceLanguage());
  return current;
}

/** Settings > Language: switch now and remember it on this phone. */
export async function setLanguage(language: Language): Promise<void> {
  chosen = true;
  apply(language);
  try {
    await AsyncStorage.setItem(STORAGE_KEY, language);
  } catch {
    // Still switched for this session.
  }
}

export function languageWasChosen(): boolean {
  return chosen;
}

export function subscribeLanguage(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The current language; the component re-renders when it changes. */
export function useLanguage(): Language {
  return useSyncExternalStore(subscribeLanguage, getLanguage, getLanguage);
}

/** t, bound to a re-render on language change: `const t = useT();` in a component. */
export function useT(): typeof t {
  useLanguage();
  return t;
}

const pluralRulesCache = new Map<Language, Intl.PluralRules | null>();
/** CLDR cardinal rules, for when Hermes has no Intl.PluralRules. */
function fallbackPlural(language: Language, n: number): Intl.LDMLPluralRule {
  const i = Math.floor(Math.abs(n));
  if (language === "hi") return i === 0 || n === 1 ? "one" : "other";
  if (language === "id") return "other";
  if (language === "fr") return i === 0 || i === 1 ? "one" : i !== 0 && i % 1_000_000 === 0 ? "many" : "other";
  if (language === "pt") return i === 0 || i === 1 ? "one" : i !== 0 && i % 1_000_000 === 0 ? "many" : "other";
  if (language === "es") return n === 1 ? "one" : i !== 0 && i % 1_000_000 === 0 ? "many" : "other";
  if (language === "ar") {
    const m = i % 100;
    return n === 0 ? "zero" : n === 1 ? "one" : n === 2 ? "two" : m >= 3 && m <= 10 ? "few" : m >= 11 && m <= 99 ? "many" : "other";
  }
  return n === 1 ? "one" : "other";
}

export function pluralCategory(n: number, language: Language = current): Intl.LDMLPluralRule {
  let rules = pluralRulesCache.get(language);
  if (rules === undefined) {
    try {
      rules = typeof Intl.PluralRules === "function" ? new Intl.PluralRules(LOCALE_TAGS[language]) : null;
    } catch {
      rules = null;
    }
    pluralRulesCache.set(language, rules);
  }
  return rules ? rules.select(n) : fallbackPlural(language, n);
}

const numberFormatCache = new Map<Language, Intl.NumberFormat | null>();
/** 1,234 / 12,345 (en) and 1,234 / 12,345 / 1,23,456 (hi, mr): whole numbers, Latin digits. */
export function formatNumber(n: number, language: Language = current): string {
  let format = numberFormatCache.get(language);
  if (format === undefined) {
    try {
      format = new Intl.NumberFormat(LOCALE_TAGS[language], { maximumFractionDigits: 0 });
    } catch {
      format = null;
    }
    numberFormatCache.set(language, format);
  }
  const whole = Math.floor(n);
  if (format) {
    // Some engines ignore -u-nu-latn; never show Devanagari digits next to typed Latin ones.
    return format.format(whole).replace(/[०-९]/g, (d) => String(d.charCodeAt(0) - 0x0966)).replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
  }
  return String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function interpolate(template: string, params: Record<string, unknown> | undefined): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    if (!(name in params)) return match;
    const value = params[name];
    // Counts read the way the language groups digits; other numbers (minutes, days) as typed.
    return name === "count" && typeof value === "number" ? formatNumber(value) : String(value);
  });
}

function lookup(language: Language, key: MessageKey): string | PluralForms | undefined {
  return (CATALOGUES[language] as Record<string, string | PluralForms | undefined>)[key];
}

/**
 * The text for `key` in the current language, with {placeholders} filled in. Plural entries pick
 * their form from params.count. A key missing from hi/mr (never shipped: tests check) falls back to
 * English rather than showing the key.
 */
export function t<K extends MessageKey>(key: K, ...[params]: ParamsOf<K> extends never ? [] : [Record<ParamsOf<K>, string | number>]): string {
  const entry = lookup(current, key) ?? lookup("en", key);
  if (entry === undefined) return key;
  if (typeof entry === "string") return interpolate(entry, params);
  const count = Number((params as Record<string, unknown> | undefined)?.count ?? 0);
  const form = entry[pluralCategory(count)] ?? entry.other;
  return interpolate(form, params);
}

/** For tests: switch without touching storage. */
export function setLanguageForTests(language: Language): void {
  chosen = false;
  apply(language);
}
