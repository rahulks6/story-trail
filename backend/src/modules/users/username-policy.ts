/**
 * The rules for choosing a username (spec section 23), in one place for every path that sets
 * one: sign-up, Google/phone onboarding, profile edits and the availability check.
 *
 * - Format: 3-30 lowercase letters, numbers, underscores and dots; not starting or ending with
 *   a dot, no two dots in a row. Names that existed before these rules stay valid.
 * - Reserved: words the app or staff could be mistaken for, and anything containing "katkee",
 *   including look-alikes ("k4tkee", "kat.kee", "katkeeee").
 * - Not allowed: profanity and slurs, after undoing common disguises (digits for letters,
 *   separators, stretched letters). Short words only count as a whole part of the name
 *   (between dots or underscores), stretched by two letters at most ("asss", "boooobs"), so
 *   "classic", "cockpit" or "therapist" stay allowed. Stretching never removes a letter:
 *   "nigeria" and "bob" don't match words with a double letter.
 * - No random 8-character hex suffix (what generated and test names use) can spell a blocked
 *   word; the tests check that property of the lists.
 *
 * Who holds a name, and the hold on recently released names, is the database's job
 * (migration 0037), so concurrent sign-ups and renames can't slip past it.
 */
import { USERNAME_RE } from "../../shared/validation";

export type UsernameProblem = { reason: "invalid" | "reserved" | "not_allowed"; message: string };

export const USERNAME_MESSAGES = {
  invalid: "Usernames are 3-30 characters: lowercase letters, numbers, underscores and dots (not at the start or end, and not two in a row).",
  reserved: "That username is reserved.",
  not_allowed: "That username isn't allowed. Try another.",
  taken: "That username is taken.",
  held: "That username was used recently by someone else. Try another.",
  available: "Available.",
  yours: "That's your username.",
} as const;

/** A word, letting each letter be stretched ("fuuuck") without letting any be dropped. */
const stretched = (word: string) => [...word].map((c) => `${c}+`).join("");
const whole = (words: readonly string[]) => new RegExp(`^(?:${words.map(stretched).join("|")})$`);
const anywhere = (words: readonly string[]) => new RegExp(words.map(stretched).join("|"));
/** A whole name or part that is the word stretched by at most two letters. */
const wholeShort = (words: readonly string[]) =>
  new RegExp(`^(?:${words.map((w) => `(?=.{${w.length},${w.length + 2}}$)${stretched(w)}`).join("|")})$`);

// Pages, features, staff and system words; matched against the whole name without separators,
// so "ad.min" and "aadmin" count.
const RESERVED_WORDS = [
  "admin", "administrator", "root", "system", "sysadmin", "superadmin", "staff", "team", "official", "verified",
  "support", "help", "helpdesk", "contact", "moderator", "moderators", "mod", "mods", "security", "safety", "trust",
  "abuse", "report", "reports", "legal", "privacy", "terms", "policy", "copyright", "billing", "payments", "ads",
  "advertising", "sponsored", "api", "www", "mail", "email", "noreply", "postmaster", "webmaster", "owner",
  "account", "accounts", "settings", "login", "logout", "signin", "signup", "register", "password", "profile",
  "home", "search", "explore", "create", "activity", "notifications", "messages", "inbox", "direct", "stories",
  "story", "highlights", "archive", "insights", "null", "undefined", "none", "nobody", "everyone", "anonymous",
] as const;

// Offensive anywhere in a name. Each contains a letter that hex digits and digit-for-letter
// swaps can't produce, so random suffixes like "test_fa55b2c1" never match.
const ANYWHERE_WORDS = [
  "fuck", "fck", "shit", "cunt", "bitch", "whore", "slut", "bastard", "wanker", "twat", "pussy", "porn",
  "nigger", "nigga", "faggot", "retard", "tranny", "chink", "dickhead", "motherf", "hitler",
  // Common Hindi and Hinglish abuse, transliterated.
  "chutiya", "chutia", "madarchod", "maderchod", "behenchod", "bhenchod", "bhosdi", "bhosad", "gandu", "harami",
] as const;

// Offensive only as a whole part of the name: inside longer words these are usually innocent
// ("classic", "cockpit", "grape", "therapist", "Pakistan", "Nazir").
const WHOLE_PART_WORDS = [
  "ass", "arse", "boob", "boobs", "tits", "dick", "cock", "cum", "sex", "xxx", "rape", "rapist", "fag", "hoe",
  "coon", "spic", "kike", "paki", "nazi", "lavda", "chod",
] as const;

/** The word lists, for tests that check properties of every entry. */
export const USERNAME_WORDS = { reserved: RESERVED_WORDS, brand: "katkee", anywhere: ANYWHERE_WORDS, wholePart: WHOLE_PART_WORDS } as const;

const RESERVED = whole(RESERVED_WORDS);
const BRAND = anywhere([USERNAME_WORDS.brand]);
const ANYWHERE = anywhere(ANYWHERE_WORDS);
const WHOLE_PART = wholeShort(WHOLE_PART_WORDS);

const DIGIT_LETTERS: Record<string, string> = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "8": "b" };
/** Lowercase, with digits read as the letters they imitate. */
export const normaliseUsername = (name: string) => name.toLowerCase().replace(/[0134578]/g, (d) => DIGIT_LETTERS[d]!);

export function cleanUsername(raw: unknown): string {
  return typeof raw === "string" ? raw.trim().toLowerCase() : "";
}

/** Why a name can't be chosen, or null when the rules allow it (availability is separate). */
export function usernameProblem(username: string): UsernameProblem | null {
  if (!USERNAME_RE.test(username) || username.startsWith(".") || username.endsWith(".") || username.includes("..")) {
    return { reason: "invalid", message: USERNAME_MESSAGES.invalid };
  }
  const text = normaliseUsername(username);
  const flat = text.replace(/[._]/g, "");
  if (RESERVED.test(flat) || BRAND.test(flat)) return { reason: "reserved", message: USERNAME_MESSAGES.reserved };
  if (ANYWHERE.test(flat) || WHOLE_PART.test(flat) || text.split(/[._]+/).some((part) => WHOLE_PART.test(part))) {
    return { reason: "not_allowed", message: USERNAME_MESSAGES.not_allowed };
  }
  return null;
}
