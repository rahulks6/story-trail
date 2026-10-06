/**
 * Per-account action budgets, shared by every API instance (consume_rate_limit in
 * Postgres, migration 0028). They stop mass likes, comments, follows and DMs, and view
 * inflation, without getting in the way of normal use. Accounts under a day old get
 * tighter hourly budgets: that is where scripted sign-ups show up.
 */
import { config } from "../../config/env";
import { queryOne } from "../../db/psql";
import { HttpError } from "../../http/errors";

export type ActionKind = "like" | "comment" | "follow" | "message" | "conversation" | "view";

interface Budget {
  perMinute?: number;
  perHour: number;
  /** Hourly budget for accounts created in the last 24 hours. */
  newAccountPerHour?: number;
}

const DEFAULTS: Record<ActionKind, Budget> = {
  like: { perMinute: 60, perHour: 600, newAccountPerHour: 150 },
  comment: { perMinute: 10, perHour: 120, newAccountPerHour: 30 },
  follow: { perMinute: 20, perHour: 200, newAccountPerHour: 50 },
  message: { perMinute: 30, perHour: 400, newAccountPerHour: 100 },
  // Starting a conversation with someone new (cold DMs are the main spam route).
  conversation: { perHour: 40, newAccountPerHour: 10 },
  // Views beyond this are not counted (playback is never refused).
  view: { perMinute: 120, perHour: 2400 },
};

function loadBudgets(): Record<ActionKind, Budget> {
  if (!config.safety.limitsJson) return DEFAULTS;
  const overrides = JSON.parse(config.safety.limitsJson) as Partial<Record<ActionKind, Partial<Budget>>>;
  const merged = { ...DEFAULTS };
  for (const kind of Object.keys(DEFAULTS) as ActionKind[]) merged[kind] = { ...DEFAULTS[kind], ...(overrides[kind] ?? {}) };
  return merged;
}

const budgets = loadBudgets();

const MESSAGES: Record<ActionKind, string> = {
  like: "You're liking too fast",
  comment: "You're commenting too fast",
  follow: "You're following too many accounts too fast",
  message: "You're sending messages too fast",
  conversation: "You've started too many new conversations",
  view: "Too many views",
};

/**
 * Counts one action; returns how many seconds to wait when over budget (0 = allowed).
 * One round trip: the minute window, then the hour window sized by the account's age.
 */
export async function consumeAction(userId: string, kind: ActionKind): Promise<number> {
  const b = budgets[kind];
  const row = await queryOne(
    `WITH acct AS (SELECT created_at > now() - interval '24 hours' AS is_new FROM users WHERE id = :'user'),
          minute AS (SELECT CASE WHEN :'perMinute'::integer > 0 THEN consume_rate_limit('act:' || :'kind' || ':m:' || :'user', :'perMinute'::integer, 60) ELSE 0 END AS wait)
     SELECT (SELECT wait FROM minute) AS minute_wait,
            consume_rate_limit('act:' || :'kind' || ':h:' || :'user',
              CASE WHEN coalesce((SELECT is_new FROM acct), false) THEN :'newHour'::integer ELSE :'perHour'::integer END, 3600) AS hour_wait`,
    { user: userId, kind, perMinute: b.perMinute ?? 0, perHour: b.perHour, newHour: b.newAccountPerHour ?? b.perHour },
  );
  return Math.max(Number(row?.minute_wait ?? 0), Number(row?.hour_wait ?? 0));
}

/** Throws 429 (with a human message and Retry-After seconds) when over budget. */
export async function enforceAction(userId: string, kind: ActionKind): Promise<void> {
  const wait = await consumeAction(userId, kind);
  if (wait > 0) {
    const minutes = Math.ceil(wait / 60);
    throw new HttpError(429, `${MESSAGES[kind]}. Try again in ${minutes === 1 ? "a minute" : `${minutes} minutes`}.`, undefined, { "Retry-After": String(wait) });
  }
}
