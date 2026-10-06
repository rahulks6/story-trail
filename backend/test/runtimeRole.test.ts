// The production runtime database role (scripts/runtime-role.ts), created by the migration runner:
// the API and worker read and write rows, and cannot change the schema or rewrite audit history.
import "./env";
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import * as path from "node:path";
import { Client } from "pg";
import { query, queryOne } from "../src/db/psql";
import { runtimeRoleScript, scramVerifier } from "../scripts/runtime-role";

const role = `katkee_rt_${Date.now().toString(36)}`;
const newPassword = () => randomBytes(24).toString("hex");
const backendRoot = path.join(__dirname, "../..");

/** The real path: `node dist/scripts/migrate.js` with the runtime role settings. */
function migrate(env: Record<string, string>) {
  return spawnSync(process.execPath, ["dist/scripts/migrate.js"], { cwd: backendRoot, env: { ...process.env, ...env }, encoding: "utf8" });
}

/** A TCP connection as the runtime role, as the API makes in production. */
async function asRuntime<T>(password: string, work: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ host: "127.0.0.1", port: 5432, user: role, password, database: process.env.PGDATABASE, connectionTimeoutMillis: 5000 });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

after(async () => {
  await query(`DROP TABLE IF EXISTS katkee_rt_later`);
  if (await queryOne(`SELECT 1 AS found FROM pg_roles WHERE rolname = :'role'`, { role })) {
    await query(`DROP OWNED BY ${role}`);
    await query(`DROP ROLE ${role}`);
  }
});

describe("runtime database role", () => {
  let password = newPassword();

  it("is created by the migration runner as a plain login role", async () => {
    const result = migrate({ DB_RUNTIME_USER: role, DB_RUNTIME_PASSWORD: password });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, new RegExp(`Runtime role ${role}: login and grants applied`));
    assert.ok(!result.stdout.includes(password) && !result.stderr.includes(password), "the password is never printed");
    const attributes = await queryOne(
      `SELECT rolcanlogin, rolsuper OR rolcreaterole OR rolcreatedb OR rolreplication OR rolbypassrls AS elevated FROM pg_roles WHERE rolname = :'role'`,
      { role },
    );
    assert.deepEqual(attributes, { rolcanlogin: "t", elevated: "f" });
    assert.equal(await asRuntime(password, async (c) => (await c.query<{ who: string }>("SELECT current_user AS who")).rows[0]!.who), role);
  });

  it("reads and writes rows, and adds audit history", async () => {
    await asRuntime(password, async (c) => {
      await c.query("SELECT count(*) FROM users");
      await c.query("BEGIN");
      await c.query(`UPDATE users SET updated_at = updated_at WHERE false`);
      await c.query(`DELETE FROM stories WHERE false`);
      await c.query("ROLLBACK");
      const inserted = await c.query(`INSERT INTO admin_audit (action, metadata) VALUES ('runtime_role_probe', '{}') RETURNING id`);
      assert.equal(inserted.rowCount, 1);
    });
  });

  it("cannot rewrite audit history or change the schema", async () => {
    await asRuntime(password, async (c) => {
      const refused: Array<[string, RegExp]> = [
        ["UPDATE admin_audit SET action = 'x' WHERE false", /permission denied for table admin_audit/],
        ["DELETE FROM moderation_actions WHERE false", /permission denied for table moderation_actions/],
        ["TRUNCATE users", /permission denied for table users/],
        ["ALTER TABLE admin_audit DISABLE TRIGGER admin_audit_immutable", /must be owner of table admin_audit/],
        ["DROP TABLE users", /must be owner of table users/],
        ["CREATE TABLE katkee_rt_probe (id int)", /permission denied for schema public/],
        ["CREATE FUNCTION katkee_rt_probe() RETURNS int LANGUAGE sql AS 'SELECT 1'", /permission denied for schema public/],
        [`CREATE ROLE ${role}_other`, /permission denied to create role/],
        [`ALTER ROLE ${role} CREATEDB`, /permission denied to alter role/],
      ];
      for (const [sql, error] of refused) await assert.rejects(c.query(sql), error, sql);
    });
  });

  it("gets the same grants on tables later migrations create", async () => {
    await query(`CREATE TABLE katkee_rt_later (id int)`);
    await asRuntime(password, async (c) => {
      await c.query("INSERT INTO katkee_rt_later VALUES (1)");
      assert.equal((await c.query("SELECT count(*)::int AS n FROM katkee_rt_later")).rows[0].n, 1);
    });
  });

  it("re-running applies a new password (rotation) and stays idempotent", async () => {
    const old = password;
    password = newPassword();
    const result = migrate({ DB_RUNTIME_USER: role, DB_RUNTIME_PASSWORD: password });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Nothing to do/);
    await assert.rejects(asRuntime(old, async () => undefined), /password authentication failed/);
    assert.equal(await asRuntime(password, async (c) => (await c.query<{ who: string }>("SELECT current_user AS who")).rows[0]!.who), role);
  });

  it("refuses the migration role itself, a weak password, a bad name or an elevated role", async () => {
    const owner = (await queryOne("SELECT current_user AS who"))!.who!;
    const refusals: Array<[Record<string, string>, RegExp]> = [
      [{ DB_RUNTIME_USER: owner, DB_RUNTIME_PASSWORD: newPassword() }, /must not be the role that runs migrations/],
      [{ DB_RUNTIME_USER: role, DB_RUNTIME_PASSWORD: "short" }, /DB_RUNTIME_PASSWORD must be at least 32/],
      [{ DB_RUNTIME_USER: "Katkee App", DB_RUNTIME_PASSWORD: newPassword() }, /DB_RUNTIME_USER must be a lowercase PostgreSQL role name/],
    ];
    for (const [env, error] of refusals) {
      const result = migrate(env);
      assert.notEqual(result.status, 0, JSON.stringify(env));
      assert.match(result.stderr, error);
    }
    await query(`ALTER ROLE ${role} CREATEDB`);
    try {
      const result = migrate({ DB_RUNTIME_USER: role, DB_RUNTIME_PASSWORD: newPassword() });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /has administrative attributes/);
    } finally {
      await query(`ALTER ROLE ${role} NOCREATEDB`);
    }
    // Still the last good password: a refused run changes nothing.
    await asRuntime(password, async () => undefined);
  });

  it("sends the server a SCRAM verifier, never the password", () => {
    const secret = newPassword();
    const verifier = scramVerifier(secret);
    assert.match(verifier, /^SCRAM-SHA-256\$4096:[A-Za-z0-9+/=]{24}\$[A-Za-z0-9+/=]{44}:[A-Za-z0-9+/=]{44}$/);
    const script = runtimeRoleScript(role, verifier);
    assert.ok(script.includes(verifier) && !script.includes(secret));
    assert.notEqual(scramVerifier(secret), verifier, "a fresh salt each time");
  });
});
