import { ValidationError } from "../auth/dto";
import type { UpdateProfileInput } from "./profiles.service";
import { USERNAME_RE } from "../../shared/validation";

const MAX_BIO_LENGTH = 150;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseUpdateProfileInput(body: unknown): UpdateProfileInput {
  const errors: Record<string, string> = {};
  const b = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  const result: UpdateProfileInput = {};

  if (b.username !== undefined) {
    const username = typeof b.username === "string" ? b.username.trim().toLowerCase() : "";
    // The full username rules apply when the name changes (profiles.service.ts), so a name
    // chosen before those rules can still be saved unchanged with other edits.
    if (!USERNAME_RE.test(username)) {
      errors.username = "Username must be 3-30 characters using lowercase letters, numbers, dots or underscores.";
    } else {
      result.username = username;
    }
  }

  if (b.displayName !== undefined) {
    if (typeof b.displayName !== "string" || b.displayName.trim().length < 1 || b.displayName.trim().length > 60) {
      errors.displayName = "Display name must be 1-60 characters.";
    } else {
      result.displayName = b.displayName.trim();
    }
  }

  if (b.bio !== undefined) {
    if (typeof b.bio !== "string" || b.bio.length > MAX_BIO_LENGTH) {
      errors.bio = `Bio must be at most ${MAX_BIO_LENGTH} characters.`;
    } else {
      result.bio = b.bio;
    }
  }

  if (b.isPrivate !== undefined) {
    if (typeof b.isPrivate !== "boolean") {
      errors.isPrivate = "isPrivate must be a boolean.";
    } else {
      result.isPrivate = b.isPrivate;
    }
  }

  if (b.interests !== undefined) {
    if (!Array.isArray(b.interests) || b.interests.length > 5 || b.interests.some((value) => typeof value !== "string" || value.trim().length < 1 || value.trim().length > 30)) {
      errors.interests = "Choose up to 5 interests, each 1-30 characters.";
    } else {
      result.interests = b.interests.map((value) => (value as string).trim()).filter((value, index, values) => values.indexOf(value) === index);
    }
  }

  if (b.avatarMediaId !== undefined) {
    if (b.avatarMediaId !== null && (typeof b.avatarMediaId !== "string" || !UUID_RE.test(b.avatarMediaId))) {
      errors.avatarMediaId = "Invalid avatar.";
    } else {
      result.avatarMediaId = b.avatarMediaId as string | null;
    }
  }

  if (Object.keys(errors).length > 0) throw new ValidationError(errors);
  return result;
}

export function parseSearchQuery(q: string | undefined): string {
  const term = (q ?? "").trim();
  if (term.length < 1 || term.length > 60) {
    throw new ValidationError({ q: "q must be 1-60 characters." });
  }
  return term;
}

/** People search covers everyone by default, or only people the searcher follows. */
export function parseSearchScope(scope: string | undefined): "all" | "following" {
  if (scope === undefined || scope === "all" || scope === "following") return scope ?? "all";
  throw new ValidationError({ scope: "scope must be all or following." });
}

export function parseSuggestionLimit(raw: string | undefined): number {
  if (raw === undefined) return 20;
  const limit = Number(raw);
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new ValidationError({ limit: "limit must be 1-50." });
  return limit;
}

export function parseDeleteAccountInput(body: unknown): { password: string } {
  const b = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  const password = typeof b.password === "string" ? b.password : "";
  if (!password) throw new ValidationError({ password: "password is required to confirm account deletion." });
  return { password };
}
