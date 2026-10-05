import { queryOne } from "../db/psql";
import { HttpError } from "../http/errors";

/**
 * Fixed-window limit shared by every API instance (PostgreSQL-backed), for low-volume,
 * high-value endpoints: sign-in, password reset, admin sign-in. The per-process
 * in-memory limiter in http/rateLimiter.ts still guards general traffic.
 * Returns the seconds until the window resets when the limit is exceeded, otherwise 0.
 */
export async function hitSharedLimit(key: string, max: number, windowSeconds: number): Promise<number> {
  const row = await queryOne(`SELECT consume_rate_limit(:'key', :'max', :'window') AS wait`, {
    key: key.slice(0, 200),
    max,
    window: windowSeconds,
  });
  return Number(row?.wait ?? 0);
}

/** Throws a 429 with a human retry hint once the shared limit for `key` is exhausted. */
export async function enforceSharedLimit(key: string, max: number, windowSeconds: number, message = "Too many attempts."): Promise<void> {
  const wait = await hitSharedLimit(key, max, windowSeconds);
  if (wait > 0) {
    const minutes = Math.ceil(wait / 60);
    throw new HttpError(429, `${message} Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`);
  }
}
