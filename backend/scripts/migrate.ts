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

  // Production (infra/): the API and worker connect as this role, not as the schema owner.
  const runtimeUser = process.env.DB_RUNTIME_USER;
  if (runtimeUser) {
    grantRuntimeRole(runtimeUser, process.env.DB_RUNTIME_PASSWORD ?? "");
    console.log(`Runtime role ${runtimeUser}: login and grants applied.`);
  }
}

main();
