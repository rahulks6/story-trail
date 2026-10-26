/**
 * The first character of a name, for a photo's stand-in: a whole emoji or letter, never half of
 * one (`charAt(0)` splits an emoji's surrogate pair and shows "�"). Empty for an empty name.
 */
export function initialOf(text: string): string {
  const first = Array.from(text.trim())[0] ?? "";
  return first.toUpperCase();
}
