/**
 * Realtime delivery benchmark on a new local database (never an existing one).
 *
 *   npm run build && node scripts/bench-realtime.cjs [--users 200] [--sockets 10] [--messages 1000] [--concurrency 50]
 *
 * Starts two API instances as separate processes, so events cross instances through
 * Postgres NOTIFY as in production. Opens `--sockets` connections per user
 * (half the users are senders on instance A, half recipients on instance B), then
 * posts messages to A and records when each event reaches every socket of the
 * recipient on B. Results go to docs/performance/<date>-realtime.json.
 */
const cp = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { performance } = require("node:perf_hooks");
const WebSocket = require("ws");

const root = path.resolve(__dirname, "..");
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? Number(process.argv[i + 1]) : fallback;
};
const USERS = arg("users", 200), SOCKETS = arg("sockets", 10), MESSAGES = arg("messages", 1000), CONCURRENCY = arg("concurrency", 50);
if (process.env.NODE_ENV === "production") throw new Error("Never benchmark with production configuration.");
if (!["localhost", "127.0.0.1", "::1"].includes(process.env.PGHOST || "localhost")) throw new Error("Use a local PostgreSQL server.");
if (USERS % 2 || SOCKETS > 10) throw new Error("--users must be even; --sockets at most 10 (the per-user cap).");

const run = Date.now().toString();
const database = `katkee_bench_${run}`;
const env = {
  ...process.env,
  PGHOST: process.env.PGHOST || "localhost",
  PGDATABASE: database,
  JWT_ACCESS_SECRET: "bench-access-secret-at-least-32-characters-long",
  JWT_REFRESH_SECRET: "bench-refresh-secret-at-least-32-characters-long",
  EMAIL_PROVIDER: "memory",
  MEDIA_STORAGE_ROOT: path.join(os.tmpdir(), `katkee-bench-${run}`),
  RATE_LIMIT_AUTH_MAX: "100000000", RATE_LIMIT_GLOBAL_MAX: "100000000", RATE_LIMIT_SIGNUP_PER_HOUR: "100000000",
};

const pct = (sorted, p) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] : null;
const summary = (values) => {
  const s = [...values].sort((a, b) => a - b), r = (v) => (v === null ? null : Math.round(v * 10) / 10);
  return { n: s.length, p50: r(pct(s, 50)), p95: r(pct(s, 95)), p99: r(pct(s, 99)), max: r(s[s.length - 1] ?? null) };
};
const rssMb = (pid) => {
  const line = fs.readFileSync(`/proc/${pid}/status`, "utf8").split("\n").find((l) => l.startsWith("VmRSS:"));
  return Math.round(Number(line.split(/\s+/)[1]) / 1024);
};

function startServer(port) {
  const child = cp.spawn(process.execPath, ["-e", `require("./dist/src/app").buildApp().listen(${port}, () => process.send("ready"))`], {
    cwd: root, env: { ...env, LOG_REQUESTS: "false" }, stdio: ["ignore", "ignore", "inherit", "ipc"],
  });
  return new Promise((resolve, reject) => {
    child.once("message", () => resolve(child));
    child.once("exit", (code) => reject(new Error(`server exited ${code}`)));
  });
}

async function api(base, method, route, body, token) {
  const res = await fetch(base + route, {
    method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${method} ${route} -> ${res.status} ${JSON.stringify(json)}`);
  return json;
}

async function main() {
  cp.execFileSync("createdb", [database], { env, stdio: "inherit" });
  cp.execFileSync(process.execPath, ["dist/scripts/migrate.js"], { cwd: root, env, stdio: "ignore" });
  const ports = [41000 + Math.floor(Math.random() * 2000), 43000 + Math.floor(Math.random() * 2000)];
  const servers = [await startServer(ports[0]), await startServer(ports[1])];
  const [A, B] = ports.map((p) => `http://127.0.0.1:${p}`);

  // Accounts and one conversation per sender/recipient pair (through the real API).
  const users = [];
  for (let i = 0; i < USERS; i++) {
    const tag = `${run.slice(-6)}${i}`;
    const res = await api(A, "POST", "/api/v1/auth/signup", { username: `bench_${tag}`, email: `bench_${tag}@example.com`, password: "correcthorsebattery", displayName: `Bench ${i}` });
    users.push({ id: res.user.id, username: `bench_${tag}`, token: res.tokens.accessToken });
  }
  const pairs = [];
  for (let i = 0; i < USERS / 2; i++) {
    const sender = users[i], recipient = users[USERS / 2 + i];
    const { conversation } = await api(A, "POST", `/api/v1/users/${recipient.username}/conversation`, undefined, sender.token);
    pairs.push({ sender, recipient, conversationId: conversation.id });
  }

  const baseline = servers.map((s) => rssMb(s.pid));
  const arrivals = new Map(); // messageId -> arrival times on the recipient's sockets
  const sockets = [], handshakes = [];
  const connectStarted = performance.now();
  const open = (url, token, onMessage) => new Promise((resolve, reject) => {
    const started = performance.now();
    const ws = new WebSocket(url, { headers: { Authorization: `Bearer ${token}` } });
    ws.on("message", (data) => {
      const event = JSON.parse(data.toString());
      if (event.type === "hello") { handshakes.push(performance.now() - started); resolve(ws); }
      else onMessage?.(event);
    });
    ws.once("error", reject);
  });
  const batch = [];
  for (const { sender, recipient } of pairs) {
    for (let k = 0; k < SOCKETS; k++) {
      batch.push(open(`ws://127.0.0.1:${ports[0]}/api/v1/realtime`, sender.token));
      batch.push(open(`ws://127.0.0.1:${ports[1]}/api/v1/realtime`, recipient.token, (event) => {
        if (event.type !== "message") return;
        const list = arrivals.get(event.messageId) ?? [];
        list.push(performance.now());
        arrivals.set(event.messageId, list);
      }));
    }
    if (batch.length >= 200) sockets.push(...(await Promise.all(batch.splice(0))));
  }
  sockets.push(...(await Promise.all(batch)));
  const connectMs = performance.now() - connectStarted;
  const loaded = servers.map((s) => rssMb(s.pid));

  // Messages: POST to instance A, delivered to the recipient's sockets on instance B.
  const sentAt = new Map(), postMs = [];
  let next = 0;
  const sendStarted = performance.now();
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (next < MESSAGES) {
      const pair = pairs[next++ % pairs.length];
      const started = performance.now();
      const { message } = await api(A, "POST", `/api/v1/conversations/${pair.conversationId}/messages`, { body: "bench" }, pair.sender.token);
      postMs.push(performance.now() - started);
      sentAt.set(message.id, started);
    }
  }));
  const sendMs = performance.now() - sendStarted;
  await new Promise((r) => setTimeout(r, 1500)); // let the last events land

  const first = [], all = [];
  let complete = 0;
  for (const [id, started] of sentAt) {
    const times = (arrivals.get(id) ?? []).sort((a, b) => a - b);
    if (times.length) first.push(times[0] - started);
    if (times.length === SOCKETS) { complete++; all.push(times[times.length - 1] - started); }
  }
  const after = servers.map((s) => rssMb(s.pid));
  for (const ws of sockets) ws.terminate();
  for (const s of servers) s.kill();

  const pg = cp.execFileSync("psql", ["-Atc", "SHOW server_version", "-d", database], { env }).toString().trim();
  const result = {
    measuredAt: new Date().toISOString(),
    what: "Realtime DM event delivery across two API instances (events cross through Postgres NOTIFY)",
    machine: { cpus: os.cpus().length, cpuModel: os.cpus()[0]?.model, memoryGb: Math.round(os.totalmem() / 2 ** 30), node: process.version, postgres: pg },
    setup: { users: USERS, socketsPerUser: SOCKETS, totalSockets: sockets.length, messages: MESSAGES, concurrency: CONCURRENCY, note: "client, both API instances and Postgres share one machine" },
    connect: { totalMs: Math.round(connectMs), handshakeMs: summary(handshakes) },
    memory: {
      rssMbBeforeSockets: baseline, rssMbWithSockets: loaded, rssMbAfterMessages: after,
      kbPerSocket: Math.round(((loaded[0] + loaded[1] - baseline[0] - baseline[1]) * 1024) / sockets.length),
    },
    delivery: {
      postResponseMs: summary(postMs),
      toFirstRecipientSocketMs: summary(first),
      toAllRecipientSocketsMs: summary(all),
      delivered: `${complete}/${sentAt.size} messages reached all ${SOCKETS} recipient sockets`,
      messagesPerSecond: Math.round(MESSAGES / (sendMs / 1000)),
    },
    database,
  };
  const out = path.join(root, "..", "docs", "performance", `${result.measuredAt.slice(0, 10)}-realtime.json`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify(result, null, 2));
  console.log(`Wrote ${path.relative(path.join(root, ".."), out)}. Database ${database} was created for this run and retained.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
