// Readiness, graceful shutdown and request ids: what a load balancer and an operator rely on
// when instances are replaced during a deploy.
import "./env";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import * as http from "node:http";
import { spawn } from "node:child_process";
import * as path from "node:path";
import type { AddressInfo } from "node:net";
import { buildApp } from "../src/app";
import { Router } from "../src/http/router";
import { createServer } from "../src/http/server";
import { Lifecycle } from "../src/http/lifecycle";
import { sendJson } from "../src/http/respond";

type Reply = { status: number; headers: http.IncomingHttpHeaders; body: string };
function get(port: number, urlPath: string, headers: Record<string, string> = {}, agent: http.Agent | false = false): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: "127.0.0.1", port, path: urlPath, headers, agent }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (c: string) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
    });
    req.on("error", reject);
  });
}
const listen = (server: http.Server) => new Promise<number>((resolve) => server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port)));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("request ids", () => {
  const server = buildApp();
  let port = 0;
  before(async () => { port = await listen(server); });
  after(async () => { await new Promise<void>((r) => server.close(() => r())); });

  it("every response carries one; a well-formed caller id is kept, anything else replaced", async () => {
    assert.match(String((await get(port, "/health")).headers["x-request-id"]), UUID);
    assert.equal((await get(port, "/health", { "X-Request-Id": "edge-7f3a9c21" })).headers["x-request-id"], "edge-7f3a9c21");
    for (const bad of ["short", "has spaces in it", "x".repeat(129), "inject\"quote"]) {
      assert.match(String((await get(port, "/health", { "X-Request-Id": bad })).headers["x-request-id"]), UUID, bad);
    }
    const missing = await get(port, "/api/v1/nothing-here");
    assert.equal(missing.status, 404);
    assert.match(String(missing.headers["x-request-id"]), UUID);
  });
});

describe("server errors", () => {
  it("answer with the request id, and the log line carries the same id", async () => {
    const router = new Router();
    router.get("/boom", async () => { throw new Error("kaboom"); });
    const server = createServer(router);
    const port = await listen(server);
    const logged: string[] = [];
    const original = console.error;
    console.error = (line: unknown) => { logged.push(String(line)); };
    try {
      const reply = await get(port, "/boom", { "X-Request-Id": "trace-1234abcd" });
      assert.equal(reply.status, 500);
      assert.deepEqual(JSON.parse(reply.body), { error: "internal_error", message: "Something went wrong.", requestId: "trace-1234abcd" });
      const entry = JSON.parse(logged.find((l) => l.includes("unhandled_error"))!) as Record<string, unknown>;
      assert.deepEqual([entry.requestId, entry.error], ["trace-1234abcd", "Error: kaboom"]);
    } finally {
      console.error = original;
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
});

describe("readiness and draining", () => {
  it("reports ready, then draining once shutdown starts; liveness stays up; connections close", async () => {
    const server = buildApp();
    const port = await listen(server);
    // A client that keeps connections open, as load balancers and apps do.
    const keepAlive = new http.Agent({ keepAlive: true });
    const ready = await get(port, "/ready", {}, keepAlive);
    assert.deepEqual([ready.status, JSON.parse(ready.body).status, ready.headers["cache-control"]], [200, "ready", "no-store"]);
    assert.equal(ready.headers.connection, "keep-alive");

    let cleaned = 0;
    const events: Record<string, unknown>[] = [];
    const stopping = server.lifecycle.shutdown(server, { drainMs: 400, timeoutMs: 2000, cleanup: async () => { cleaned++; }, log: (e) => events.push(e) });
    const draining = await get(port, "/ready", {}, keepAlive);
    keepAlive.destroy();
    assert.deepEqual([draining.status, JSON.parse(draining.body).status], [503, "draining"]);
    assert.equal(draining.headers.connection, "close", "keep-alive clients reconnect to another instance");
    assert.equal((await get(port, "/health")).status, 200, "liveness is unaffected: the process is healthy, just leaving");

    assert.equal(await stopping, "clean");
    assert.equal(cleaned, 1);
    assert.equal(await server.lifecycle.shutdown(server, { drainMs: 0, timeoutMs: 10 }), "clean", "a second signal waits for the first");
    assert.equal(cleaned, 1);
    await assert.rejects(get(port, "/health"), /ECONNREFUSED/);
    assert.deepEqual(events.map((e) => e.event), ["shutdown_started", "shutdown_finished"]);
  });
});

describe("in-flight requests at shutdown", () => {
  let handlerFinished = false;
  function slowServer() {
    const router = new Router();
    router.get("/slow", async (_req, res) => {
      await new Promise((r) => setTimeout(r, 400));
      handlerFinished = true;
      sendJson(res, 200, { done: true });
    });
    router.get("/hang", async () => new Promise<void>(() => undefined));
    const lifecycle = new Lifecycle();
    return { server: createServer(router, lifecycle), lifecycle };
  }

  it("finish before the process stops", async () => {
    const { server, lifecycle } = slowServer();
    const port = await listen(server);
    const pending = get(port, "/slow");
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(lifecycle.requestsInFlight, 1);
    const cleanups: boolean[] = [];
    const outcome = await lifecycle.shutdown(server, { drainMs: 0, timeoutMs: 3000, cleanup: async () => { cleanups.push(handlerFinished); } });
    const reply = await pending;
    assert.deepEqual([outcome, reply.status, JSON.parse(reply.body).done], ["clean", 200, true]);
    assert.deepEqual(cleanups, [true], "the database closes once, after the last request is answered");
  });

  it("are cut after the timeout, and cleanup still runs", async () => {
    const { server, lifecycle } = slowServer();
    const port = await listen(server);
    const pending = get(port, "/hang");
    await new Promise((r) => setTimeout(r, 50));
    let cleaned = false;
    const startedAt = Date.now();
    const outcome = await lifecycle.shutdown(server, { drainMs: 0, timeoutMs: 300, cleanup: async () => { cleaned = true; } });
    assert.equal(outcome, "forced");
    assert.ok(Date.now() - startedAt < 2000);
    assert.ok(cleaned);
    await assert.rejects(pending, /socket hang up|ECONNRESET/);
  });
});

describe("the API process", () => {
  it("drains and exits cleanly on SIGTERM", async () => {
    const probe = http.createServer();
    const port = await listen(probe); // a free port, released for the child process
    await new Promise<void>((r) => probe.close(() => r()));
    const child = spawn(process.execPath, [path.join(__dirname, "../src/index.js")], {
      cwd: path.join(__dirname, "../.."),
      env: { ...process.env, PORT: String(port), SHUTDOWN_DRAIN_MS: "800", SHUTDOWN_TIMEOUT_MS: "3000", MEDIA_WORKER_IN_PROCESS: "false" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (c) => (output += c));
    child.stderr.on("data", (c) => (output += c));
    const exited = new Promise<number | null>((resolve) => child.on("exit", (code) => resolve(code)));
    try {
      let ready: Reply | null = null;
      for (let i = 0; i < 100 && !ready; i++) {
        ready = await get(port, "/ready").catch(() => null);
        if (!ready) await new Promise((r) => setTimeout(r, 100));
      }
      assert.equal(ready?.status, 200, output);
      child.kill("SIGTERM");
      await new Promise((r) => setTimeout(r, 200));
      assert.equal((await get(port, "/ready")).status, 503, "draining after SIGTERM");
      assert.equal(await exited, 0, output);
      const events = output.split("\n").filter((l) => l.startsWith("{")).map((l) => JSON.parse(l) as Record<string, unknown>);
      assert.deepEqual(events.filter((e) => String(e.event).startsWith("shutdown_")).map((e) => [e.event, e.signal, e.outcome ?? null]),
        [["shutdown_started", "SIGTERM", null], ["shutdown_finished", "SIGTERM", "clean"]]);
    } finally {
      if (child.exitCode === null) child.kill("SIGKILL");
    }
  });
});
