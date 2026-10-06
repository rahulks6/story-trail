// TLS to PostgreSQL (PGSSLMODE/PGSSLROOTCERT), against the local server's own TLS: verified modes
// must refuse an untrusted certificate or a host name it doesn't cover, as RDS connections need.
import "./env";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import * as fs from "node:fs";
import { Client } from "pg";
import { databaseTls } from "../src/config/database";
import { query, queryOne } from "../src/db/psql";

// The local test cluster's certificate: CN and SAN "localhost", self-signed.
const SERVER_CERT = "/etc/ssl/certs/ssl-cert-snakeoil.pem";
const role = `katkee_tls_${Date.now().toString(36)}`;
const password = randomBytes(24).toString("hex");
let serverHasTls = false;

before(async () => {
  serverHasTls = (await queryOne("SHOW ssl"))?.ssl === "on" && fs.existsSync(SERVER_CERT);
  // A throwaway login for TCP connections (the suite itself uses the Unix socket).
  if (serverHasTls) await query(`CREATE ROLE ${role} LOGIN PASSWORD '${password}'`);
});
after(async () => {
  if (serverHasTls) await query(`DROP ROLE IF EXISTS ${role}`);
});

/** Connects over TCP with the TLS options the app derives from these settings; reports whether TLS was used. */
async function connect(host: string, env: Record<string, string>): Promise<boolean> {
  const client = new Client({ host, port: 5432, user: role, password, database: process.env.PGDATABASE, ssl: databaseTls({ ...env, PGHOST: host }), connectionTimeoutMillis: 5000 });
  await client.connect();
  try {
    const { rows } = await client.query<{ ssl: boolean }>("SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()");
    return rows[0]!.ssl;
  } finally {
    await client.end();
  }
}

describe("database TLS", () => {
  it("modes map to TLS options; anything else is refused", () => {
    assert.equal(databaseTls({}), false, "local development default: no TLS");
    assert.equal(databaseTls({ PGSSLMODE: "disable" }), false);
    assert.deepEqual(databaseTls({ PGSSLMODE: "require" }), { rejectUnauthorized: false });
    const full = databaseTls({ PGSSLMODE: "verify-full", PGSSLROOTCERT: "certs/rds-ap-south-1-bundle.pem" });
    assert.ok(full && full.rejectUnauthorized && full.ca?.includes("BEGIN CERTIFICATE") && typeof full.checkServerIdentity === "function");
    const ca = databaseTls({ PGSSLMODE: "verify-ca" });
    assert.ok(ca && ca.rejectUnauthorized && typeof ca.checkServerIdentity === "function");
    for (const bad of ["prefer", "allow", "verify_full", "true"]) assert.throws(() => databaseTls({ PGSSLMODE: bad }), /PGSSLMODE must be/, bad);
  });

  it("the shipped RDS bundle holds the Mumbai root CAs", () => {
    const bundle = fs.readFileSync("certs/rds-ap-south-1-bundle.pem", "utf8");
    assert.equal(bundle.match(/BEGIN CERTIFICATE/g)?.length, 3);
  });

  it("connects encrypted, and verified modes refuse what they cannot trust", async (t) => {
    if (!serverHasTls) {
      t.skip("this PostgreSQL server has TLS off");
      return;
    }
    assert.equal(await connect("127.0.0.1", { PGSSLMODE: "disable" }), false);
    assert.equal(await connect("127.0.0.1", { PGSSLMODE: "require" }), true, "encrypted without verification");
    assert.equal(await connect("localhost", { PGSSLMODE: "verify-full", PGSSLROOTCERT: SERVER_CERT }), true, "trusted CA, matching name");
    assert.equal(await connect("127.0.0.1", { PGSSLMODE: "verify-ca", PGSSLROOTCERT: SERVER_CERT }), true, "trusted CA, name not checked");
    await assert.rejects(connect("127.0.0.1", { PGSSLMODE: "verify-full", PGSSLROOTCERT: SERVER_CERT }), /IP: 127\.0\.0\.1 is not in the cert's list|altnames/i,
      "the certificate does not cover 127.0.0.1");
    await assert.rejects(connect("localhost", { PGSSLMODE: "verify-full" }), /self[- ]signed/i, "a CA the app doesn't trust");
    await assert.rejects(connect("localhost", { PGSSLMODE: "verify-full", PGSSLROOTCERT: "certs/rds-ap-south-1-bundle.pem" }), /self[- ]signed|unable to verify/i,
      "the RDS bundle does not vouch for another server");
  });
});
