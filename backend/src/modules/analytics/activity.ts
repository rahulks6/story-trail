import { config } from "../../config/env";
import { query } from "../../db/psql";

export type AnalyticsPlatform = "android" | "ios" | "web" | "unknown";

/** The app sends X-Katkee-Platform on every request; anything else counts as "unknown". */
export function platformOf(value: unknown): AnalyticsPlatform {
  const raw = Array.isArray(value) ? value[0] : value;
  const platform = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  return platform === "android" || platform === "ios" || platform === "web" ? platform : "unknown";
}

const dayParts = new Intl.DateTimeFormat("en-US", {
  timeZone: config.analytics.timeZone, year: "numeric", month: "2-digit", day: "2-digit",
});

/** The analytics day (YYYY-MM-DD) of a moment, in ANALYTICS_TIME_ZONE. */
export function analyticsDay(at: Date = new Date()): string {
  const parts = Object.fromEntries(dayParts.formatToParts(at).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

// Who this process has already recorded today, so each person costs one insert per day and
// platform (per API instance), not one per request.
const recorded = new Set<string>();
let recordedDay = "";
const MAX_REMEMBERED = 200_000;

/**
 * Marks the person active today on this platform: the source of DAU/WAU/MAU, the platform
 * split and retention. Called for every authenticated request. It never throws and never
 * delays the request: the insert runs in the background and a failure only logs.
 */
export function noteActivity(userId: string, platformHeader: unknown, now: Date = new Date()): void {
  if (!config.analytics.enabled) return;
  const day = analyticsDay(now);
  if (day !== recordedDay) {
    recorded.clear();
    recordedDay = day;
  }
  const platform = platformOf(platformHeader);
  const key = `${userId}:${platform}`;
  if (recorded.has(key)) return;
  if (recorded.size >= MAX_REMEMBERED) recorded.clear();
  recorded.add(key);
  void query(
    `INSERT INTO analytics_active_days (day, platform, user_id) VALUES (:'day'::date, :'platform', :'user')
     ON CONFLICT DO NOTHING`,
    { day, platform, user: userId },
  ).catch((error: unknown) => {
    recorded.delete(key); // try again on their next request
    console.warn(JSON.stringify({ event: "analytics_activity_failed", message: error instanceof Error ? error.message : String(error) }));
  });
}

/** Test-only: forget what this process has recorded. */
export function resetActivityCache(): void {
  recorded.clear();
  recordedDay = "";
}
