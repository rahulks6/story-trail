/**
 * Types derived from the English catalogue, so a key missing from hi.ts or mr.ts, a mistyped
 * key in t(), or a missing {placeholder} value fails the typecheck.
 */
import type { en } from "./en";

/** A plural entry: Intl.PluralRules categories; "one" and "other" are what en, hi and mr use. */
export interface PluralForms {
  readonly zero?: string;
  readonly one?: string;
  readonly two?: string;
  readonly few?: string;
  readonly many?: string;
  readonly other: string;
}

type English = typeof en;
export type MessageKey = keyof English;

/** A translation: every English key, as a string (or plural forms where English has them). */
export type Catalogue = { readonly [K in MessageKey]: English[K] extends string ? string : PluralForms };

/** "{name} liked {what}" -> "name" | "what". */
type Placeholders<S> = S extends `${string}{${infer Name}}${infer Rest}` ? Name | Placeholders<Rest> : never;

/** The params a key takes (distributes over a union of keys, e.g. t(short ? "a" : "b", ...)). */
export type ParamsOf<K extends MessageKey> = K extends MessageKey
  ? English[K] extends string
    ? Placeholders<English[K]>
    : English[K] extends { readonly other: infer O } ? Placeholders<O> | "count" : never
  : never;
