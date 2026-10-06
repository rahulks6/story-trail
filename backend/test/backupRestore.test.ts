// Backup and restore drill (scripts/restore-drill.ts, release gate 25). A database with real
// activity is backed up, restored into a new database and compared: accounts, a Story with
// media, a Highlight, a conversation and audit history. Then the API runs on the restore.
import "./env";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { AddressInfo } from "node:net";
import { buildApp } from "../src/app";
import { query } from "../src/db/psql";
import { compareFingerprints, dumpDatabase, fingerprint, restoreDatabase, type DrillReport } from "../scripts/restore-drill";
import { authHeader, makeClient, uniqueUser } from "./helpers";
import { buildTestPng } from "./fixtures";

const backendRoot = path.join(__dirname, "../..");
const source = process.env.PGDATABASE!;
const run = Date.now().toString(36);
const restored = `katkee_drill_${run}`, tampered = `katkee_drill_t_${run}`, damaged = `katkee_drill_d_${run}`;
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "katkee-drill-test-"));

const server = buildApp();
let client: ReturnType<typeof makeClient>;
const alice = uniqueUser(), bob = uniqueUser();
let conversationId = "";

/** psql against one of the drill's databases, as the suite's role. */
const psql = (db: string, statement: string) => spawnSync("psql", ["-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-d", db, "-c", statement], { encoding: "utf8", env: process.env });
const exists = (db: string) => psql("postgres", `SELECT 1 FROM pg_database WHERE datname = '${db}'`).stdout.trim() === "1";

before(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  client = makeClient(baseUrl);
  const a = await client.post("/api/v1/auth/signup", alice);
  const b = await client.post("/api/v1/auth/signup", bob);
  const aliceAuth = authHeader(a.body.tokens.accessToken), bobAuth = authHeader(b.body.tokens.accessToken);
  await client.post(`/api/v1/users/${alice.username}/follow`, undefined, bobAuth);
  const photo = await fetch(`${baseUrl}/api/v1/media/photos`, { method: "POST", headers: { "Content-Type": "image/png", ...aliceAuth }, body: buildTestPng(8, 8) });
  const mediaId = ((await photo.json()) as { media: { id: string } }).media.id;
  const story = await client.post("/api/v1/stories", { mediaId, caption: "Restore drill story", audience: "public", allowComments: "everyone", allowSharing: true }, aliceAuth);
  assert.equal(story.status, 201, JSON.stringify(story.body));
  const highlight = await client.post("/api/v1/highlights", { title: "Drill", storyIds: [story.body.story.id] }, aliceAuth);
  assert.equal(highlight.status, 201, JSON.stringify(highlight.body));
  conversationId = (await client.post(`/api/v1/users/${bob.username}/conversation`, undefined, aliceAuth)).body.conversation.id;
  await client.post(`/api/v1/conversations/${conversationId}/messages`, { body: "Restore drill message" }, aliceAuth);
  await client.post(`/api/v1/conversations/${conversationId}/messages`, { body: "Got it" }, bobAuth);
  await query(`INSERT INTO admin_audit (action, metadata) VALUES ('restore_drill_seed', '{"by":"backupRestore.test"}')`);
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  // Only the databases this test created.
  for (const db of [restored, tampered, damaged]) if (exists(db)) spawnSync("dropdb", [db], { env: process.env });
  fs.rmSync(scratch, { recursive: true, force: true });
});

describe("backup and restore drill", () => {
  let report: DrillReport;

  it("a backup restores to an identical database, with nothing left for migrations to do", () => {
    const reportPath = path.join(scratch, "report.json");
    const drill = spawnSync(process.execPath, ["dist/scripts/restore-drill.js", restored, "--keep", "--report", reportPath], { cwd: backendRoot, env: process.env, encoding: "utf8" });
    assert.equal(drill.status, 0, drill.stdout + drill.stderr);
    report = JSON.parse(fs.readFileSync(reportPath, "utf8")) as DrillReport;
    console.log(`drill: ${report.verify!.tables} tables, ${report.verify!.rows} rows, dump ${report.dump!.bytes} bytes in ${report.dump!.ms} ms, restore ${report.restore!.ms} ms, verify ${report.verify!.ms} ms`);
    assert.equal(report.ok, true);
    assert.deepEqual(report.differences, []);
    assert.equal(report.source, source);
    assert.equal(report.migrations, "Nothing to do — schema is up to date.");
    assert.match(report.dump!.sha256, /^[0-9a-f]{64}$/);
    assert.ok(report.verify!.tables >= 60, `${report.verify!.tables} tables`);
    assert.equal(report.kept, true);
    for (const [table, minimum] of [["users", 2], ["stories", 1], ["highlights", 1], ["messages", 2], ["admin_audit", 1], ["schema_migrations", 36]] as const) {
      const rows = Number(psql(restored, `SELECT count(*) FROM ${table}`).stdout.trim());
      assert.ok(rows >= minimum, `${table}: ${rows} rows`);
    }
  });

  it("the API runs on the restore: sign-in, Highlights and messages are all there", async () => {
    const port = await new Promise<number>((resolve) => {
      const probe = require("node:net").createServer().listen(0, "127.0.0.1", () => { const p = probe.address().port; probe.close(() => resolve(p)); });
    });
    const api = spawn(process.execPath, ["dist/src/index.js"], { cwd: backendRoot, env: { ...process.env, PGDATABASE: restored, PORT: String(port) }, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`API did not start: ${output}`)), 20_000);
        const listen = (chunk: Buffer) => { output += chunk.toString(); if (output.includes("listening")) { clearTimeout(timer); resolve(); } };
        api.stdout.on("data", listen);
        api.stderr.on("data", (chunk: Buffer) => { output += chunk.toString(); });
        api.on("exit", (code) => reject(new Error(`API exited (${code}): ${output}`)));
      });
      const restoredApi = makeClient(`http://127.0.0.1:${port}`);
      assert.equal((await restoredApi.get("/ready")).status, 200);
      const login = await restoredApi.post("/api/v1/auth/login", { email: alice.email, password: alice.password });
      assert.equal(login.status, 200, JSON.stringify(login.body));
      const auth = authHeader(login.body.tokens.accessToken);
      const highlights = await restoredApi.get(`/api/v1/users/${alice.username}/highlights`, auth);
      assert.deepEqual(highlights.body.highlights.map((h: { title: string }) => h.title), ["Drill"]);
      const conversations = await restoredApi.get("/api/v1/conversations", auth);
      assert.ok(conversations.body.conversations.some((c: { id: string }) => c.id === conversationId));
      const messages = await restoredApi.get(`/api/v1/conversations/${conversationId}/messages`, auth);
      assert.deepEqual(messages.body.messages.map((m: { body: string }) => m.body).sort(), ["Got it", "Restore drill message"]);
    } finally {
      api.kill("SIGTERM");
      await new Promise((resolve) => (api.exitCode !== null ? resolve(null) : api.once("exit", resolve)));
    }
  });

  it("audit history stays append-only on the restore", () => {
    const changed = psql(restored, "UPDATE admin_audit SET action = 'rewritten'");
    assert.notEqual(changed.status, 0);
    assert.match(changed.stderr, /Audit history is append-only/);
  });

  it("the comparison catches lost data and a missing trigger", () => {
    const dump = path.join(scratch, "tamper.dump");
    dumpDatabase(source, dump);
    restoreDatabase(dump, tampered);
    assert.deepEqual(compareFingerprints(fingerprint(source), fingerprint(tampered)), [], "identical before tampering");
    assert.equal(psql(tampered, `DELETE FROM messages WHERE body = 'Got it'`).status, 0);
    assert.equal(psql(tampered, "DROP TRIGGER moderation_actions_immutable ON moderation_actions").status, 0);
    const differences = compareFingerprints(fingerprint(source), fingerprint(tampered));
    assert.equal(differences.length, 2, differences.join("\n"));
    assert.match(differences[0]!, /^schema triggers: missing \[".*moderation_actions_immutable/);
    assert.match(differences[1]!, /^data messages: \d+:[0-9a-f]{32} != \d+:[0-9a-f]{32}$/);
  });

  it("a damaged backup restores nothing", () => {
    const dump = path.join(scratch, "damaged.dump");
    dumpDatabase(source, dump);
    fs.truncateSync(dump, Math.floor(fs.statSync(dump).size / 2));
    assert.throws(() => restoreDatabase(dump, damaged), /Restore failed, nothing was restored/);
    assert.equal(exists(damaged), false, "no half-restored database is left behind");
  });

  it("never touches an existing database", () => {
    const drill = spawnSync(process.execPath, ["dist/scripts/restore-drill.js", restored], { cwd: backendRoot, env: process.env, encoding: "utf8" });
    assert.notEqual(drill.status, 0);
    assert.match(JSON.parse(drill.stdout).error, /already exists/);
    assert.ok(exists(restored), "the existing database is still there");
    const self = spawnSync(process.execPath, ["dist/scripts/restore-drill.js", source], { cwd: backendRoot, env: process.env, encoding: "utf8" });
    assert.notEqual(self.status, 0);
    assert.match(self.stderr, /must not be the source database/);
  });
});
