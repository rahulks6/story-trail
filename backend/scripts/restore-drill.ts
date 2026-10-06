/**
 * Backup and restore drill: proves that a logical backup of the database restores to an
 * identical database the app can run on (docs/BACKUP_AND_RESTORE.md).
 *
 *   node dist/scripts/restore-drill.js <new-database> [--keep] [--report report.json]
 *
 * PG* settings choose the server and the source database (PGDATABASE), as for migrations. The
 * role needs CREATEDB (on RDS, the owner role). Nothing existing is changed: the target must be
 * a new database name, and only a database this drill created is ever dropped.
 *
 * 1. pg_dump: custom format, one consistent snapshot, without owners or grants.
 * 2. createdb and pg_restore in one transaction, so a damaged backup restores nothing.
 * 3. The migration runner against the restore. It finds nothing to apply, because
 *    schema_migrations came back too. With DB_RUNTIME_USER set it re-applies the runtime role's
 *    grants, which a dump leaves out.
 * 4. Fingerprints of both databases, compared:
 *    - schema: extensions, columns, constraints, indexes, triggers, functions and sequences;
 *    - data: row count and checksum per table.
 * 5. A report with sizes, timings and differences. Any difference fails the drill and keeps
 *    the restore for inspection.
 */
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { database } from "../src/config/database";

const DATABASE_NAME = /^[a-z_][a-z0-9_]{0,62}$/;

/** Where and as whom: createdb and dropdb take only this. */
function server(): string[] {
  return ["-h", database.host, "-p", String(database.port), "-U", database.user];
}

function connection(db: string): string[] {
  return [...server(), "-d", db];
}

function run(tool: string, args: string[]): string {
  return execFileSync(tool, args, { env: { ...process.env, PGPASSWORD: database.password }, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
}

function sql(db: string, statement: string): string {
  return run("psql", [...connection(db), "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-c", statement]).trim();
}

const major = (version: string) => Number(/(\d+)(?:\.\d+)?/.exec(version)?.[1] ?? 0);
const elapsed = (start: bigint) => Number((process.hrtime.bigint() - start) / 1_000_000n);

export interface Fingerprint {
  schema: Record<string, unknown>;
  /** Table → "rows:checksum". */
  data: Record<string, string>;
}

/** What the database holds: its schema, and a row count and checksum per table. */
export function fingerprint(db: string): Fingerprint {
  const schema = JSON.parse(sql(db, `SELECT json_build_object(
    'extensions', (SELECT json_object_agg(extname, extversion ORDER BY extname) FROM pg_extension),
    'columns', (SELECT json_agg(format('%s.%s %s %s %s', table_name, column_name, data_type, is_nullable, coalesce(column_default, ''))
                ORDER BY table_name, ordinal_position) FROM information_schema.columns WHERE table_schema = 'public'),
    'constraints', (SELECT json_agg(format('%s %s %s', conrelid::regclass, conname, pg_get_constraintdef(oid)) ORDER BY conrelid::regclass::text, conname)
                    FROM pg_constraint WHERE connamespace = 'public'::regnamespace),
    'indexes', (SELECT json_agg(indexdef ORDER BY indexname) FROM pg_indexes WHERE schemaname = 'public'),
    'triggers', (SELECT json_agg(format('%s %s', tgrelid::regclass, pg_get_triggerdef(oid)) ORDER BY tgrelid::regclass::text, tgname)
                 FROM pg_trigger WHERE NOT tgisinternal),
    'functions', (SELECT json_agg(format('%s %s', p.proname, md5(pg_get_functiondef(p.oid))) ORDER BY p.proname, md5(pg_get_functiondef(p.oid)))
                  FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.prokind IN ('f', 'p')
                  AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')),
    'sequences', (SELECT json_object_agg(sequencename, coalesce(last_value, 0) ORDER BY sequencename) FROM pg_sequences WHERE schemaname = 'public')
  )`)) as Record<string, unknown>;
  const tables = sql(db, "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename").split("\n").filter(Boolean);
  const data: Record<string, string> = {};
  if (tables.length) {
    for (const table of tables) if (!DATABASE_NAME.test(table)) throw new Error(`Unexpected table name ${JSON.stringify(table)}`);
    // Order-independent: the checksum of the sorted row checksums.
    const rows = sql(db, tables.map((table) =>
      `SELECT '${table}' || '=' || count(*) || ':' || md5(coalesce(string_agg(md5(t::text), '' ORDER BY md5(t::text)), '')) FROM public."${table}" t`).join(" UNION ALL "));
    for (const line of rows.split("\n")) {
      const [table, value] = line.split("=");
      data[table!] = value!;
    }
  }
  return { schema, data };
}

/** Everything that differs between two fingerprints; empty when the restore is identical. */
export function compareFingerprints(source: Fingerprint, target: Fingerprint): string[] {
  const differences: string[] = [];
  for (const key of new Set([...Object.keys(source.schema), ...Object.keys(target.schema)])) {
    const a = JSON.stringify(source.schema[key] ?? null), b = JSON.stringify(target.schema[key] ?? null);
    if (a === b) continue;
    const listA = (source.schema[key] ?? []) as unknown, listB = (target.schema[key] ?? []) as unknown;
    if (Array.isArray(listA) && Array.isArray(listB)) {
      const missing = listA.filter((x) => !listB.includes(x)).slice(0, 5), extra = listB.filter((x) => !listA.includes(x)).slice(0, 5);
      differences.push(`schema ${key}: missing ${JSON.stringify(missing)}, unexpected ${JSON.stringify(extra)}`);
    } else {
      differences.push(`schema ${key}: ${a} != ${b}`);
    }
  }
  for (const table of new Set([...Object.keys(source.data), ...Object.keys(target.data)])) {
    if (source.data[table] !== target.data[table]) differences.push(`data ${table}: ${source.data[table] ?? "absent"} != ${target.data[table] ?? "absent"}`);
  }
  return differences;
}

/** pg_dump in custom format (compressed, restorable selectively), as one consistent snapshot. */
export function dumpDatabase(db: string, file: string): { bytes: number; sha256: string; ms: number } {
  const start = process.hrtime.bigint();
  run("pg_dump", [...connection(db), "--format=custom", "--no-owner", "--no-privileges", "--file", file]);
  const bytes = fs.statSync(file).size;
  const sha256 = createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  return { bytes, sha256, ms: elapsed(start) };
}

/** Restores into a new database, all or nothing. A failed restore leaves no database behind. */
export function restoreDatabase(file: string, target: string): { ms: number } {
  if (!DATABASE_NAME.test(target)) throw new Error("The target must be a new database name (lowercase letters, digits, _).");
  const start = process.hrtime.bigint();
  run("createdb", [...server(), target]);
  try {
    run("pg_restore", [...connection(target), "--exit-on-error", "--single-transaction", "--no-owner", "--no-privileges", file]);
  } catch (error) {
    run("dropdb", [...server(), target]);
    const detail = error instanceof Error && "stderr" in error ? String((error as { stderr: unknown }).stderr).trim() : String(error);
    throw new Error(`Restore failed, nothing was restored: ${detail}`);
  }
  return { ms: elapsed(start) };
}

export interface DrillReport {
  ok: boolean;
  startedAt: string;
  server: string;
  tools: string;
  source: string;
  target: string;
  dump?: { bytes: number; sha256: string; ms: number };
  restore?: { ms: number };
  migrations?: string;
  verify?: { ms: number; tables: number; rows: number };
  differences: string[];
  kept: boolean;
  error?: string;
}

export function runDrill(options: { target: string; keep?: boolean; dumpFile?: string }): DrillReport {
  const source = database.database;
  const report: DrillReport = { ok: false, startedAt: new Date().toISOString(), server: "", tools: "", source, target: options.target, differences: [], kept: false };
  if (options.target === source) throw new Error("The target must not be the source database.");
  const dumpFile = options.dumpFile ?? path.join(fs.mkdtempSync(path.join(os.tmpdir(), "katkee-drill-")), `${source}.dump`);
  let created = false;
  try {
    report.server = sql(source, "SHOW server_version");
    report.tools = run("pg_dump", ["--version"]).trim();
    // pg_dump refuses a newer server; say so before starting.
    if (major(report.tools.replace(/^\D+/, "")) < major(report.server)) throw new Error(`${report.tools} cannot dump PostgreSQL ${report.server}: use pg_dump ${major(report.server)} or newer.`);
    report.dump = dumpDatabase(source, dumpFile);
    report.restore = restoreDatabase(dumpFile, options.target);
    created = true;
    const migrate = spawnSync(process.execPath, [path.join(__dirname, "migrate.js")], {
      cwd: path.resolve(__dirname, "../.."), env: { ...process.env, PGDATABASE: options.target }, encoding: "utf8",
    });
    if (migrate.status !== 0) throw new Error(`Migrations failed on the restore: ${migrate.stderr.trim()}`);
    report.migrations = migrate.stdout.trim().split("\n").filter((l) => !l.startsWith("skip")).join(" ");
    const start = process.hrtime.bigint();
    const before = fingerprint(source), after = fingerprint(options.target);
    report.differences = compareFingerprints(before, after);
    report.verify = {
      ms: elapsed(start),
      tables: Object.keys(after.data).length,
      rows: Object.values(after.data).reduce((sum, v) => sum + Number(v.split(":")[0]), 0),
    };
    report.ok = report.differences.length === 0;
  } catch (error) {
    report.error = error instanceof Error ? error.message : String(error);
  } finally {
    // Keep a restore that differs, for inspection; otherwise only when asked.
    report.kept = created && (options.keep === true || !report.ok);
    if (created && !report.kept) run("dropdb", [...server(), options.target]);
    if (!options.dumpFile && !options.keep) fs.rmSync(path.dirname(dumpFile), { recursive: true, force: true });
  }
  return report;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const target = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--report");
  const reportPath = args.includes("--report") ? args[args.indexOf("--report") + 1] : undefined;
  if (!target) {
    console.error("Usage: node dist/scripts/restore-drill.js <new-database> [--keep] [--report report.json]");
    process.exit(2);
  }
  const report = runDrill({ target, keep: args.includes("--keep") });
  const text = `${JSON.stringify(report, null, 2)}\n`;
  if (reportPath) fs.writeFileSync(reportPath, text);
  process.stdout.write(text);
  process.exitCode = report.ok ? 0 : 1;
}
