/**
 * Minimal migration runner: applies every .sql file in migrations/ that
 * hasn't run yet, in filename order, inside a transaction each. Tracks
 * applied migrations in a `schema_migrations` table.
 *
 * Deliberately hand-rolled instead of using a migration framework package
 * (Prisma/node-pg-migrate) because this sandbox cannot install npm
 * dependencies — see the note in package.json. It runs psql directly
 * (unlike src/db/psql.ts, migrations are trusted, static, developer-owned
 * SQL files, so there's no parameter-injection surface to guard here).
 */
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
// Database settings only: migrations need no app secrets or provider settings.
import { database } from "../src/config/database";
import { grantRuntimeRole } from "./runtime-role";

// Resolved from cwd (this package's root), not __dirname — matching
// config/database.ts's and media/storage.ts's own reasoning: __dirname points
// into dist/scripts/ once compiled, and migrations/*.sql is never copied
// there (tsc only compiles .ts files), so an __dirname-relative path
// silently broke `npm run migrate:prod` the first time anyone actually
// ran the compiled build instead of ts-node.
const MIGRATIONS_DIR = path.resolve(process.cwd(), "migrations");

function psqlExec(sql: string): string {
  return execFileSync(
    "psql",
    [
      "-h",
      database.host,
      "-p",
      String(database.port),
      "-U",
      database.user,
      "-d",
      database.database,
      "-X",
      "-q",
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      sql,
    ],
    { env: { ...process.env, PGPASSWORD: database.password }, encoding: "utf8" },
  );
}

function psqlExecFile(filePath: string, version: string): void {
  if (!/^[a-zA-Z0-9_]+$/.test(version)) throw new Error("Invalid migration filename");
  execFileSync(
    "psql",
    [
      "-h",
      database.host,
      "-p",
      String(database.port),
      "-U",
      database.user,
      "-d",
      database.database,
      "-X",
      "-q",
      "-v",
      "ON_ERROR_STOP=1",
      "-1", // wrap the whole file in a single transaction
      "-f",
      filePath,
      "-c",
      `INSERT INTO schema_migrations (version) VALUES ('${version}');`,
    ],
    { env: { ...process.env, PGPASSWORD: database.password }, stdio: "inherit" },
  );
}

function ensureMigrationsTable(): void {
  psqlExec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}

function appliedVersions(): Set<string> {
  const out = psqlExec("SELECT version FROM schema_migrations ORDER BY version;");
  return new Set(
    out
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && l !== "version" && !l.startsWith("(") && !/^-+$/.test(l)),
  );
}

function markApplied(version: string): void {
  psqlExec(`INSERT INTO schema_migrations (version) VALUES ('${version}');`);
}

function main(): void {
  ensureMigrationsTable();
  const applied = appliedVersions();
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  let ranAny = false;
  for (const file of files) {
    const version = file.replace(/\.sql$/, "");
    if (applied.has(version)) {
      console.log(`skip  ${version} (already applied)`);
      continue;
    }
    console.log(`apply ${version}`);
    psqlExecFile(path.join(MIGRATIONS_DIR, file), version);
    ranAny = true;
  }

  console.log(ranAny ? "Migrations complete." : "Nothing to do — schema is up to date.");
  syncMusicCatalogue();

  // Production (infra/): the API and worker connect as this role, not as the schema owner.
  const runtimeUser = process.env.DB_RUNTIME_USER;
  if (runtimeUser) {
    grantRuntimeRole(runtimeUser, process.env.DB_RUNTIME_PASSWORD ?? "");
    console.log(`Runtime role ${runtimeUser}: login and grants applied.`);
  }
}

/**
 * Katkee's songs (migrations/music/catalogue.json) are brought into music_tracks on every
 * migrate: new ones added, changed ones updated, and ones taken out of the file hidden from the
 * picker (Stories that already use them keep playing). The audio files are uploaded to the
 * media bucket separately, at each track's storageKey.
 */
function syncMusicCatalogue(): void {
  const file = path.join(MIGRATIONS_DIR, "music", "catalogue.json");
  if (!fs.existsSync(file)) return;
  const tracks = JSON.parse(fs.readFileSync(file, "utf8")) as unknown[];
  if (!Array.isArray(tracks)) throw new Error("music/catalogue.json must be a list");
  const json = JSON.stringify(tracks);
  const tag = "catalogue_" + Math.random().toString(36).slice(2);
  if (json.includes(tag)) throw new Error("Catalogue quoting clash");
  psqlExec(`
    WITH c AS (
      SELECT * FROM jsonb_to_recordset($${tag}$${json}$${tag}$::jsonb)
        AS x(id uuid, title text, artist text, mood text, "durationMs" integer, "storageKey" text, "mimeType" text, "byteSize" bigint,
             license text, "licenseUrl" text, attribution text, "sourceUrl" text)),
    up AS (
      INSERT INTO music_tracks (id, title, artist, mood, duration_ms, storage_key, mime_type, byte_size, license, license_url, attribution, source_url, active)
      SELECT id, title, artist, coalesce(mood, ''), "durationMs", "storageKey", coalesce("mimeType", 'audio/mpeg'), "byteSize", license, "licenseUrl",
             attribution, coalesce("sourceUrl", ''), true FROM c
      ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, artist = EXCLUDED.artist, mood = EXCLUDED.mood, duration_ms = EXCLUDED.duration_ms,
        storage_key = EXCLUDED.storage_key, mime_type = EXCLUDED.mime_type, byte_size = EXCLUDED.byte_size, license = EXCLUDED.license,
        license_url = EXCLUDED.license_url, attribution = EXCLUDED.attribution, source_url = EXCLUDED.source_url, active = true
      RETURNING id)
    UPDATE music_tracks SET active = false WHERE id NOT IN (SELECT id FROM c) AND active;
  `);
  console.log(`Music catalogue: ${tracks.length} tracks.`);
}

main();
