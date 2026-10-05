/** Existing text-row query contract, now served by a bounded PostgreSQL pool.
 * DB_DRIVER=psql retains the previous CLI adapter for recovery/diagnostics.
 * Migrations continue to use their dedicated transactional runner. */
import { Pool, escapeLiteral } from "pg";
import { execFile } from "node:child_process";
import { config } from "../config/env";

const FIELD_SEP = "\u0001";
const RECORD_SEP = "\u0002";
const NULL_TOKEN = "\u0003KATKEE_NULL\u0003";
const FORBIDDEN_CHARS = [FIELD_SEP, RECORD_SEP, "\u0003"];

export type SqlValue = string | number | boolean | null;
export type SqlParams = Record<string, SqlValue>;
export type Row = Record<string, string | null>;

export class DatabaseError extends Error {
  constructor(
    message: string,
    public readonly detail: string,
  ) {
    super(message);
    this.name = "DatabaseError";
  }
}

function toParamString(value: SqlValue): string {
  if (value === null) return "";
  const str = typeof value === "boolean" ? String(value) : String(value);
  for (const forbidden of FORBIDDEN_CHARS) {
    if (str.includes(forbidden)) {
      throw new Error("Query parameter contains a reserved control character");
    }
  }
  return str;
}

function parseOutput(stdout: string): Row[] {
  // Windows text-mode stdout inserts a CR before every LF, including field data.
  if (process.platform === "win32") stdout = stdout.replace(/\r\n/g, "\n");
  const trimmed = stdout.replace(/\r?\n$/, "");
  if (trimmed.length === 0) return [];
  const records = trimmed.split(RECORD_SEP);
  const header = (records[0] ?? "").split(FIELD_SEP);
  const rows: Row[] = [];
  for (let i = 1; i < records.length; i++) {
    const values = (records[i] ?? "").split(FIELD_SEP);
    const row: Row = {};
    header.forEach((col, idx) => {
      const raw = values[idx] ?? "";
      row[col] = raw === NULL_TOKEN ? null : raw;
    });
    rows.push(row);
  }
  return rows;
}

/**
 * Run one static SQL statement (or a single-statement CTE) against Postgres
 * and return its rows as strings (Postgres text output) — callers cast to
 * the types they expect. `sql` must be a literal written in source, never
 * built from request input; pass values through `params` and reference them
 * in `sql` as `:'name'` so psql SQL-quotes them for you.
 */
async function queryViaCli(sql: string, params: SqlParams = {}): Promise<Row[]> {
  const args: string[] = [
    "-h",
    config.db.host,
    "-p",
    String(config.db.port),
    "-U",
    config.db.user,
    "-d",
    config.db.database,
    "-X",
    "-q",
    "-A",
    "-F",
    FIELD_SEP,
    "-R",
    RECORD_SEP,
    "-v",
    "ON_ERROR_STOP=1",
    "-P",
    `null=${NULL_TOKEN}`,
    "-P",
    "footer=off",
  ];

  // Windows psql's argv conversion can lose characters outside the ANSI code
  // page. Send escaped psql variables through UTF-8 stdin instead. SQL still
  // references :'name', so psql performs SQL quoting just as before.
  const bindings = Object.entries(params).map(([key, value]) => {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key)) throw new Error("Invalid SQL parameter name");
    const escaped = toParamString(value).replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\r/g, "\\r").replace(/\n/g, "\\n");
    return `\\set ${key} '${escaped}'\n`;
  }).join("");

  return new Promise<Row[]>((resolve, reject) => {
    const child = execFile(
      "psql",
      args,
      { env: { ...process.env, PGPASSWORD: config.db.password, PGCLIENTENCODING: "UTF8" }, maxBuffer: 32 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          reject(new DatabaseError("Database query failed", stderr.trim() || error.message));
          return;
        }
        try {
          resolve(parseOutput(stdout));
        } catch (parseError) {
          reject(new DatabaseError("Failed to parse database response", String(parseError)));
        }
      },
    );
    child.stdin?.write(bindings + (sql.endsWith(";") ? sql : `${sql};`));
    child.stdin?.end();
  });
}

let pool: Pool | undefined;
function connectionPool(): Pool {
 if (!pool) {
  pool = new Pool({ ...config.db, max: 10, connectionTimeoutMillis: 5000, idleTimeoutMillis: 30000, statement_timeout: 10000, allowExitOnIdle: true,
   types: { getTypeParser: () => (value: string) => value } });
  pool.on('error', () => console.warn(JSON.stringify({event:'database_connection_error'})));
 }
 return pool;
}
export async function query(sql: string, params: SqlParams = {}): Promise<Row[]> {
 if(process.env.DB_DRIVER === 'psql') return queryViaCli(sql,params);
 // Retain SQL's unknown-literal inference used by existing UUID/enum/JSON queries.
 // The driver, not hand-built quotes, escapes every value; SQL is developer-owned.
 const compiled=sql.replace(/:'([a-zA-Z_][a-zA-Z0-9_]*)'/g, (_match,name:string) => {
  if(!Object.prototype.hasOwnProperty.call(params,name)) throw new Error('Missing SQL parameter');
  return escapeLiteral(toParamString(params[name]!));
 });
 try { const result=await connectionPool().query<Row>(compiled); return result.rows; }
 catch(error) { throw new DatabaseError('Database query failed',error instanceof Error?error.message:'Database unavailable'); }
}
export async function closeDatabase(): Promise<void> { const existing=pool;pool=undefined;await existing?.end(); }

export async function queryOne(sql: string, params: SqlParams = {}): Promise<Row | null> {
  const rows = await query(sql, params);
  return rows[0] ?? null;
}

/**
 * A `null` param is sent to psql as an empty string (there's no way to pass
 * a bare SQL NULL through `-v`), so a plain `:'name'` would insert/compare
 * against `''` instead of NULL. Wrap any parameter that can legitimately be
 * null with `nullable("name")` in the SQL text instead of `:'name'` — it
 * collapses an empty string to SQL NULL via NULLIF, which is safe here
 * because none of this schema's nullable text columns treat "" and NULL as
 * meaningfully different values.
 */
export function nullable(paramName: string, castType?: string): string {
  const cast = castType ? `::${castType}` : "";
  return `NULLIF(:'${paramName}', '')${cast}`;
}
