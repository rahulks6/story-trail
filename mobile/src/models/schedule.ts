/**
 * Scheduling a Story (backend stories/scheduled.ts): a time on the phone's own clock and
 * calendar, at least a few minutes ahead and at most 7 days.
 */

/** Long enough that the upload can finish first on a slow connection. */
export const MIN_SCHEDULE_LEAD_MS = 10 * 60 * 1000;
/** The server's limit. */
export const MAX_SCHEDULE_AHEAD_MS = 7 * 24 * 3600 * 1000;
/** Minutes offered in the picker. */
export const MINUTE_STEP = 5;

function startOfDay(at: Date): Date {
  return new Date(at.getFullYear(), at.getMonth(), at.getDate());
}

/** Today and the 7 days after it, each at local midnight: the days a time can fall on. */
export function scheduleDays(now: Date = new Date()): Date[] {
  const first = startOfDay(now);
  return Array.from({ length: 8 }, (_, i) => new Date(first.getFullYear(), first.getMonth(), first.getDate() + i));
}

/** That day at hour:minute on the phone's clock (daylight-saving changes included). */
export function atTime(day: Date, hour: number, minute: number): Date {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute);
}

/** Why a time can't be chosen, in words for people; null when it's fine. */
export function scheduleProblem(at: Date, now: Date = new Date()): string | null {
  if (at.getTime() < now.getTime() + MIN_SCHEDULE_LEAD_MS) return "Choose a time at least 10 minutes from now.";
  if (at.getTime() > now.getTime() + MAX_SCHEDULE_AHEAD_MS) return "Stories can be scheduled up to 7 days ahead.";
  return null;
}

/** A good first suggestion: the next whole hour that's at least an hour away. */
export function defaultScheduleTime(now: Date = new Date()): Date {
  const next = new Date(now.getTime() + 60 * 60 * 1000);
  next.setMinutes(0, 0, 0);
  if (next.getTime() < now.getTime() + 60 * 60 * 1000) next.setHours(next.getHours() + 1);
  return next;
}

/** "Today", "Tomorrow" or "Sat, 1 Nov". */
export function dayName(day: Date, now: Date = new Date()): string {
  const diff = Math.round((startOfDay(day).getTime() - startOfDay(now).getTime()) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  return day.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}

/** "8:30 PM" (or "20:30" on a 24-hour phone). */
export function timeText(at: Date): string {
  return at.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/** "Today at 8:30 PM", "Tomorrow at 9:00 AM", "Sat, 1 Nov at 6:15 PM". */
export function scheduleText(at: Date, now: Date = new Date()): string {
  return `${dayName(at, now)} at ${timeText(at)}`;
}
