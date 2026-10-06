import { config } from "../../config/env";
import { query } from "../../db/psql";
import { HttpError } from "../../http/errors";
import { platformOf } from "./activity";

/**
 * Events only the app can observe. Everything else (Stories, views, likes, comments, shares,
 * follows, DMs, Highlights, reports, ad events) is counted from the rows those features
 * already write, so it is never sent twice.
 */
export const ANALYTICS_EVENTS = [
  "app_session_started", "app_crash", "story_created", "highlight_viewed",
  "profile_viewed", "search_performed", "upload_succeeded", "upload_failed",
] as const;
export type AnalyticsEventName = (typeof ANALYTICS_EVENTS)[number];

type PropertyRule =
  | { kind: "boolean" }
  | { kind: "int"; min: number; max: number }
  | { kind: "enum"; values: readonly string[] };

const MEDIA_KIND: PropertyRule = { kind: "enum", values: ["photo", "video"] };
const ATTEMPTS: PropertyRule = { kind: "int", min: 1, max: 100 };

/**
 * The only properties ever stored: booleans, bounded numbers and fixed choices. No ids of
 * other people or content, no text, no URLs. Unknown keys and invalid values are dropped.
 */
const PROPERTIES: Record<AnalyticsEventName, Record<string, PropertyRule>> = {
  app_session_started: { coldStart: { kind: "boolean" } },
  app_crash: { fatal: { kind: "boolean" } },
  story_created: { mediaKind: MEDIA_KIND, source: { kind: "enum", values: ["camera", "library"] } },
  highlight_viewed: {},
  profile_viewed: {},
  search_performed: {},
  upload_succeeded: { mediaKind: MEDIA_KIND, attempts: ATTEMPTS, durationMs: { kind: "int", min: 0, max: 3_600_000 } },
  upload_failed: {
    mediaKind: MEDIA_KIND,
    stage: { kind: "enum", values: ["upload", "processing", "publish"] },
    reason: { kind: "enum", values: ["network", "server", "rejected", "timeout", "unknown"] },
    attempts: ATTEMPTS,
  },
};

export const MAX_EVENTS_PER_BATCH = 50;
/** The app keeps unsent events for up to a week (offline); older ones are refused. */
const MAX_AGE_MS = 7 * 24 * 3600 * 1000;
/** Clocks drift; a time slightly in the future is treated as now, further out is refused. */
const MAX_FUTURE_MS = 10 * 60 * 1000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VERSION_RE = /^[0-9A-Za-z.+-]{1,32}$/;

interface CleanEvent {
  id: string;
  name: AnalyticsEventName;
  session_id: string | null;
  properties: Record<string, boolean | number | string>;
  occurred_at: string;
}

function cleanProperties(name: AnalyticsEventName, value: unknown): CleanEvent["properties"] {
  const out: CleanEvent["properties"] = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return out;
  for (const [key, rule] of Object.entries(PROPERTIES[name])) {
    const v = (value as Record<string, unknown>)[key];
    if (rule.kind === "boolean" && typeof v === "boolean") out[key] = v;
    else if (rule.kind === "int" && typeof v === "number" && Number.isInteger(v) && v >= rule.min && v <= rule.max) out[key] = v;
    else if (rule.kind === "enum" && typeof v === "string" && rule.values.includes(v)) out[key] = v;
  }
  return out;
}

/** One event, or null when it can't be stored (bad id, unknown name, missing or out-of-range time). */
export function cleanEvent(value: unknown, now: number = Date.now()): CleanEvent | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const e = value as Record<string, unknown>;
  if (typeof e.id !== "string" || !UUID_RE.test(e.id)) return null;
  if (typeof e.name !== "string" || !(ANALYTICS_EVENTS as readonly string[]).includes(e.name)) return null;
  const name = e.name as AnalyticsEventName;
  const at = typeof e.occurredAt === "string" && e.occurredAt.length <= 40 ? Date.parse(e.occurredAt) : NaN;
  if (!Number.isFinite(at) || at < now - MAX_AGE_MS || at > now + MAX_FUTURE_MS) return null;
  const session = typeof e.sessionId === "string" && UUID_RE.test(e.sessionId) ? e.sessionId.toLowerCase() : null;
  return {
    id: e.id.toLowerCase(),
    name,
    session_id: session,
    properties: cleanProperties(name, e.properties),
    occurred_at: new Date(Math.min(at, now)).toISOString(),
  };
}

export interface IngestResult {
  accepted: number;
  duplicates: number;
  rejected: number;
}

/**
 * Stores a batch from the app. Idempotent: every event carries the app's stable id, so a
 * batch retried after a lost response is not counted twice. Each event also marks the person
 * active on the day it happened (events queued offline count for that day).
 */
export async function ingestEvents(userId: string, input: unknown, platformHeader: unknown, now: number = Date.now()): Promise<IngestResult> {
  const body = input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : null;
  const list = body?.events;
  if (!Array.isArray(list) || list.length === 0 || list.length > MAX_EVENTS_PER_BATCH) {
    throw new HttpError(422, `Send between 1 and ${MAX_EVENTS_PER_BATCH} events.`);
  }
  const events = new Map<string, CleanEvent>();
  let rejected = 0;
  for (const raw of list) {
    const event = cleanEvent(raw, now);
    if (!event) rejected++;
    else if (!events.has(event.id)) events.set(event.id, event);
  }
  if (!config.analytics.enabled || events.size === 0) return { accepted: 0, duplicates: 0, rejected };

  const platform = platformOf(body?.platform ?? platformHeader);
  const appVersion = typeof body?.appVersion === "string" && VERSION_RE.test(body.appVersion) ? body.appVersion : "";
  const rows = await query(
    `WITH input AS (
       SELECT * FROM jsonb_to_recordset(:'events'::jsonb)
         AS e(id uuid, name text, session_id uuid, properties jsonb, occurred_at timestamptz)),
     saved AS (
       INSERT INTO analytics_events (id, user_id, name, platform, session_id, app_version, properties, occurred_at)
       SELECT id, :'user', name, :'platform', session_id, NULLIF(:'version', ''), properties, occurred_at FROM input
       ON CONFLICT (id) DO NOTHING
       RETURNING 1),
     active AS (
       INSERT INTO analytics_active_days (day, platform, user_id)
       SELECT DISTINCT (occurred_at AT TIME ZONE :'tz')::date, :'platform', :'user'::uuid FROM input
       ON CONFLICT DO NOTHING)
     SELECT count(*) AS n FROM saved`,
    { events: JSON.stringify([...events.values()]), user: userId, platform, version: appVersion, tz: config.analytics.timeZone },
  );
  const accepted = Number(rows[0]?.n ?? 0);
  return { accepted, duplicates: events.size - accepted, rejected };
}
