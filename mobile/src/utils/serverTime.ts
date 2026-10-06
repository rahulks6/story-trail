/**
 * Milliseconds since the epoch for a timestamp from the API, or NaN.
 *
 * The API returns Postgres text timestamps ("2026-10-05 16:49:38.646456+00") and
 * JSON-built ones ("2026-10-05T16:49:38.646456+00:00"). Neither is guaranteed to parse
 * with every JavaScript engine's Date.parse (Hermes follows the ECMAScript format
 * strictly), so normalize to "2026-10-05T16:49:38.646+00:00" first.
 */
export function serverTimeMs(value: string | null | undefined): number {
  if (!value) return NaN;
  const match = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)(?:\.(\d+))?(Z|[+-]\d{2}(?::?\d{2})?)?$/.exec(value.trim());
  if (!match) return Date.parse(value);
  const [, date, time, fraction = "", zone = "Z"] = match;
  const millis = (fraction + "000").slice(0, 3);
  const offset = zone === "Z" ? "Z" : zone.length === 3 ? `${zone}:00` : zone.includes(":") ? zone : `${zone.slice(0, 3)}:${zone.slice(3)}`;
  return Date.parse(`${date}T${time!.length === 5 ? `${time}:00` : time}.${millis}${offset}`);
}

/** A Date for an API timestamp, or null when it can't be read (never an "Invalid Date" on screen). */
export function serverDate(value: string | null | undefined): Date | null {
  const ms = serverTimeMs(value);
  return Number.isFinite(ms) ? new Date(ms) : null;
}

/** How long ago an API timestamp was: "just now", "5m ago", "3h ago", "2d ago", "3w ago" ("" if unreadable). */
export function timeAgo(value: string | null | undefined, now: number = Date.now()): string {
  const then = serverTimeMs(value);
  if (!Number.isFinite(then)) return "";
  // A phone clock running behind the server must not show negative ages.
  const mins = Math.floor(Math.max(0, now - then) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days < 7 ? `${days}d ago` : `${Math.floor(days / 7)}w ago`;
}
