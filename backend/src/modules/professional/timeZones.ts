import { query } from "../../db/psql";

/**
 * The time zones PostgreSQL knows (pg_timezone_names), read once per process: the dashboard
 * turns times into the owner's days and hours in SQL, so a zone the phone knows but the database
 * doesn't would fail the query. Reading the view walks the zone files, so it isn't done per
 * request.
 */
let known: Promise<Set<string>> | null = null;

const SHAPE = /^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+){0,2}$/;

export async function knownTimeZone(name: string): Promise<boolean> {
  if (name.length > 64 || !SHAPE.test(name)) return false;
  known ??= query(`SELECT name FROM pg_timezone_names`)
    .then((rows) => new Set(rows.map((r) => r.name as string)))
    .catch((error: unknown) => {
      known = null; // asked again next time
      throw error;
    });
  return (await known).has(name);
}
