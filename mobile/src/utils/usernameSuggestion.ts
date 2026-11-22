/**
 * Usernames as the server takes them (backend shared/validation.ts USERNAME_RE): 3-30 lowercase
 * letters, numbers, dots and underscores, no dot at either end or two in a row.
 */

/** What someone typed, as a username: no spaces (keyboards add one after a suggested word), lowercase. */
export function cleanUsernameInput(text: string): string {
  return text.replace(/\s+/g, "").toLowerCase();
}

/**
 * A first suggestion from the name Google or Apple shares ("Rahul Sharma" -> "rahul.sharma"),
 * so finishing sign-up is mostly one tap. Only Latin letters and digits are kept; "" when too
 * little is left (a name in Devanagari, say): the field then stays empty for them to fill.
 */
export function usernameFromName(name: string): string {
  const parts = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  let base = "";
  for (const part of parts) {
    const next = base ? `${base}.${part}` : part;
    if (next.length > 24) break;
    base = next;
  }
  if (!base && parts[0]) base = parts[0].slice(0, 24);
  return base.length >= 3 ? base : "";
}

/** The suggestion with a few digits, for when the plain one is taken. */
export function withDigits(base: string, random: () => number = Math.random): string {
  const digits = String(Math.floor(random() * 900) + 100);
  return `${base.slice(0, 30 - digits.length)}${digits}`;
}
