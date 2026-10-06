/**
 * The runtime database role: what the API and worker connect as in production (infra/), instead
 * of the role that owns the schema.
 *
 *   DB_RUNTIME_USER=katkee_app DB_RUNTIME_PASSWORD=... node dist/scripts/migrate.js
 *
 * After the migrations, the runner (connected as the schema owner) creates or updates the role:
 * - it logs in with the given password, sent to the server only as a SCRAM-SHA-256 verifier;
 * - it reads and writes rows in the app's tables and uses their sequences, and nothing else. It
 *   owns nothing, so it cannot alter or drop tables, disable triggers or create objects;
 * - the audit history is insert-only for it, on top of the triggers that reject changes (0020).
 * Re-running is safe: grants and password are applied again, and tables created by later
 * migrations get the same grants by default.
 */
import { createHash, createHmac, pbkdf2Sync, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { database } from "../src/config/database";

const ROLE_NAME = /^[a-z_][a-z0-9_]{0,62}$/;
// Printable ASCII, so the verifier needs no SASLprep normalisation; long enough to be a real secret.
const PASSWORD = /^[\x21-\x7e]{32,}$/;

/** Tables the runtime role may add rows to but never change or remove. */
export const APPEND_ONLY_TABLES = ["admin_audit", "moderation_actions"];

/** The SCRAM-SHA-256 verifier PostgreSQL stores for a password (RFC 5802 and 7677). */
export function scramVerifier(password: string, salt: Buffer = randomBytes(16), iterations = 4096): string {
  const salted = pbkdf2Sync(password, salt, iterations, 32, "sha256");
  const clientKey = createHmac("sha256", salted).update("Client Key").digest();
  const storedKey = createHash("sha256").update(clientKey).digest();
  const serverKey = createHmac("sha256", salted).update("Server Key").digest();
  return `SCRAM-SHA-256$${iterations}:${salt.toString("base64")}$${storedKey.toString("base64")}:${serverKey.toString("base64")}`;
}

/**
 * The psql script, fed on standard input (nothing secret on a command line). Values travel as
 * session settings because psql does not substitute variables inside a DO block.
 */
export function runtimeRoleScript(role: string, verifier: string): string {
  return `\\set ON_ERROR_STOP on
\\set role '${role}'
\\set verifier '${verifier}'
\\set append_only '${APPEND_ONLY_TABLES.join(",")}'
SELECT set_config('katkee.runtime_role', :'role', false), set_config('katkee.runtime_verifier', :'verifier', false),
       set_config('katkee.append_only', :'append_only', false) \\gset ignored_
DO $$
DECLARE
  r text := current_setting('katkee.runtime_role');
  t text;
BEGIN
  IF r = current_user THEN
    RAISE EXCEPTION 'DB_RUNTIME_USER (%) must not be the role that runs migrations.', r;
  END IF;
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = r AND (rolsuper OR rolcreaterole OR rolcreatedb OR rolreplication OR rolbypassrls)) THEN
    RAISE EXCEPTION 'Runtime role % has administrative attributes; it must be a plain login role.', r;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = r) THEN
    EXECUTE format('CREATE ROLE %I LOGIN', r);
  END IF;
  EXECUTE format('ALTER ROLE %I WITH LOGIN PASSWORD %L', r, current_setting('katkee.runtime_verifier'));
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO %I', current_database(), r);
  EXECUTE format('GRANT USAGE ON SCHEMA public TO %I', r);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO %I', r);
  EXECUTE format('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO %I', r);
  EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO %I', r);
  EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO %I', r);
  FOREACH t IN ARRAY string_to_array(current_setting('katkee.append_only'), ',') LOOP
    EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON TABLE %I FROM %I', t, r);
  END LOOP;
END
$$;
`;
}

/** Refuses a role name or password the script can't use safely. */
export function validateRuntimeCredentials(role: string, password: string): void {
  if (!ROLE_NAME.test(role)) throw new Error("DB_RUNTIME_USER must be a lowercase PostgreSQL role name.");
  if (!PASSWORD.test(password)) throw new Error("DB_RUNTIME_PASSWORD must be at least 32 printable ASCII characters without spaces.");
}

/** Creates or updates the runtime role in the configured database (as the connected owner). */
export function grantRuntimeRole(role: string, password: string): void {
  validateRuntimeCredentials(role, password);
  execFileSync(
    "psql",
    ["-h", database.host, "-p", String(database.port), "-U", database.user, "-d", database.database, "-X", "-q", "-f", "-"],
    { env: { ...process.env, PGPASSWORD: database.password }, input: runtimeRoleScript(role, scramVerifier(password)), stdio: ["pipe", "inherit", "inherit"] },
  );
}
