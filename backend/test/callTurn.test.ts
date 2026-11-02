// Calls with Twilio's Network Traversal Service as the TURN provider, against a local stand-in
// for api.twilio.com (the real one needs credentials). Set before the configuration loads.
const twilioPort = 20000 + Math.floor(Math.random() * 20000);
process.env.CALLS_TURN_PROVIDER = "twilio";
process.env.CALLS_TURN_TTL_SECONDS = "3600";
process.env.TWILIO_ACCOUNT_SID = `AC${"a".repeat(32)}`;
process.env.TWILIO_API_KEY_SID = `SK${"b".repeat(32)}`;
process.env.TWILIO_API_KEY_SECRET = "api-key-secret-test-only";
process.env.TWILIO_API_ENDPOINT = `http://127.0.0.1:${twilioPort}`;

import "./env";
import { after, before, it } from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { buildApp } from "../src/app";
import { resetIceServerCache } from "../src/modules/calls/ice-servers";
import { authHeader, makeClient, uniqueUser } from "./helpers";

const requests: { path: string; auth: string; body: string }[] = [];
let failing = false;
const twilio: Server = createServer((req: IncomingMessage, res) => {
  let body = "";
  req.on("data", (c) => { body += c; });
  req.on("end", () => {
    requests.push({ path: req.url ?? "", auth: req.headers.authorization ?? "", body });
    if (failing) { res.writeHead(503).end(); return; }
    res.writeHead(201, { "Content-Type": "application/json" }).end(JSON.stringify({
      username: "ephemeral-user", password: "ephemeral-pass", ttl: "3600",
      ice_servers: [
        { url: "stun:global.stun.twilio.com:3478", urls: "stun:global.stun.twilio.com:3478" },
        { url: "turn:global.turn.twilio.com:3478?transport=udp", urls: "turn:global.turn.twilio.com:3478?transport=udp", username: "ephemeral-user", credential: "ephemeral-pass" },
        { urls: "turns:global.turn.twilio.com:443?transport=tcp", username: "ephemeral-user", credential: "ephemeral-pass" },
        { urls: "javascript:alert(1)" },
      ],
    }));
  });
});
const server = buildApp();
let client: ReturnType<typeof makeClient>;
before(async () => {
  await new Promise<void>((resolve) => twilio.listen(twilioPort, "127.0.0.1", resolve));
  await new Promise<void>((resolve) => server.listen(0, resolve));
  client = makeClient(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
});
after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await new Promise<void>((resolve) => twilio.close(() => resolve()));
});

async function token(): Promise<string> {
  return (await client.post("/api/v1/auth/signup", uniqueUser())).body.tokens.accessToken as string;
}

it("hands phones Twilio's short-lived TURN credentials, never the API key", async () => {
  resetIceServerCache();
  const res = await client.get("/api/v1/calls/ice-servers", authHeader(await token()));
  assert.equal(res.status, 200);
  assert.equal(requests.length, 1);
  assert.equal(requests[0]!.path, `/2010-04-01/Accounts/AC${"a".repeat(32)}/Tokens.json`);
  assert.equal(requests[0]!.auth, `Basic ${Buffer.from(`SK${"b".repeat(32)}:api-key-secret-test-only`).toString("base64")}`);
  assert.equal(requests[0]!.body, "Ttl=3600");
  assert.deepEqual(res.body.iceServers.map((s: { urls: string[] }) => s.urls[0]), [
    "stun:global.stun.twilio.com:3478", "turn:global.turn.twilio.com:3478?transport=udp", "turns:global.turn.twilio.com:443?transport=tcp",
  ]);
  assert.equal(res.body.iceServers[1].username, "ephemeral-user");
  assert.ok(res.body.ttlSeconds > 3500 && res.body.ttlSeconds <= 3600);
  assert.ok(!JSON.stringify(res.body).includes("api-key-secret"));

  // Shared for a while by everyone starting a call, then fetched again.
  await client.get("/api/v1/calls/ice-servers", authHeader(await token()));
  assert.equal(requests.length, 1);
});

it("keeps a still-valid token, or falls back to STUN, when Twilio is down", async () => {
  resetIceServerCache();
  failing = true;
  const res = await client.get("/api/v1/calls/ice-servers", authHeader(await token()));
  failing = false;
  assert.equal(res.status, 200);
  assert.ok(res.body.iceServers.every((s: { urls: string[] }) => s.urls.every((u) => u.startsWith("stun:"))));
});
