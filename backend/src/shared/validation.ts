import { HttpError } from "../http/errors";

export const USERNAME_RE = /^[a-z0-9_.]{3,30}$/;
export const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function parseUsernameParam(value: string | undefined): string {
  const username = (value ?? "").trim().toLowerCase();
  if (!USERNAME_RE.test(username)) {
    throw new HttpError(400, "Invalid username.");
  }
  return username;
}

/** A substring pattern for ILIKE that treats %, _ and \ in user input literally. */
export function containsPattern(term: string): string {
  return `%${escapeLike(term)}%`;
}

/** `term` with %, _ and \ escaped, for building other ILIKE patterns (prefix, word start). */
export function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (c) => `\\${c}`);
}
