// Push against local protocol servers: an OAuth token endpoint + FCM HTTP v1 endpoint,
// and an HTTP/2 APNs endpoint. Each verifies the provider's signed credentials (RS256
// JWT assertion for Google OAuth, ES256 provider token for APNs) with the public key.
import { execFileSync } from "node:child_process";
import { generateKeyPairSync, verify as verifySignature, type KeyObject } from "node:crypto";

const freePort = () => Number(execFileSync(process.execPath, ["-e",
  "const s=require('net').createServer().listen(0,'127.0.0.1',()=>{process.stdout.write(String(s.address().port));s.close()})"]).toString());
const FCM_PORT = freePort(), APNS_PORT = freePort();
const fcmKeys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const apnsKeys = generateKeyPairSync("ec", { namedCurve: "P-256" });
process.env.FCM_SERVICE_ACCOUNT_JSON = JSON.stringify({
  type: "service_account", project_id: "katkee-test", client_email: "push@katkee-test.iam.gserviceaccount.com",
  private_key: fcmKeys.privateKey.export({ type: "pkcs8", format: "pem" }).toString(), token_uri: `http://127.0.0.1:${FCM_PORT}/token`,
});
process.env.FCM_ENDPOINT = `http://127.0.0.1:${FCM_PORT}`;
process.env.APNS_KEY_ID = "ABC123DEFG";
process.env.APNS_TEAM_ID = "TEAM123456";
process.env.APNS_BUNDLE_ID = "com.katkee.app";
process.env.APNS_PRIVATE_KEY = Buffer.from(apnsKeys.privateKey.export({ type: "pkcs8", format: "pem" }).toString()).toString("base64");
process.env.APNS_HOST = `http://127.0.0.1:${APNS_PORT}`;

import "./env";
import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import * as http from "node:http";
import * as http2 from "node:http2";
import type { AddressInfo } from "node:net";
import { buildApp } from "../src/app";
import { query, queryOne } from "../src/db/psql";
import { PushWorker } from "../src/modules/push/push-worker";
import { providersFromConfig } from "../src/modules/push/dispatcher";
import { authHeader, makeClient, uniqueUser } from "./helpers";
import { buildTestPng } from "./fixtures";

function verifyJwt(token: string, key: KeyObject, alg: "RS256" | "ES256"): { header: Record<string, unknown>; payload: Record<string, unknown> } {
  const [h, p, s] = token.split(".");
  const ok = alg === "RS256"
    ? verifySignature("sha256", Buffer.from(`${h}.${p}`), key, Buffer.from(s!, "base64url"))
    : verifySignature("sha256", Buffer.from(`${h}.${p}`), { key, dsaEncoding: "ieee-p1363" }, Buffer.from(s!, "base64url"));
  assert.ok(ok, `${alg} signature verifies with the public key`);
  return { header: JSON.parse(Buffer.from(h!, "base64url").toString()), payload: JSON.parse(Buffer.from(p!, "base64url").toString()) };
}

const fcm = { tokenRequests: 0, sends: [] as { token: string; body: any }[], failNext: 0, rejectAuthNext: false };
const apns = { sends: [] as { token: string; headers: http2.IncomingHttpHeaders; body: any }[] };

const fcmServer = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    if (req.url === "/token") {
      const form = new URLSearchParams(raw);
      assert.equal(form.get("grant_type"), "urn:ietf:params:oauth:grant-type:jwt-bearer");
      const { payload } = verifyJwt(form.get("assertion")!, fcmKeys.publicKey, "RS256");
      assert.equal(payload.iss, "push@katkee-test.iam.gserviceaccount.com");
      assert.equal(payload.scope, "https://www.googleapis.com/auth/firebase.messaging");
      assert.equal(payload.aud, `http://127.0.0.1:${FCM_PORT}/token`);
      fcm.tokenRequests++;
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ access_token: `ya29.test-${fcm.tokenRequests}`, expires_in: 3600 }));
      return;
    }
    assert.equal(req.url, "/v1/projects/katkee-test/messages:send");
    if (fcm.rejectAuthNext || !req.headers.authorization?.startsWith("Bearer ya29.test-")) {
      fcm.rejectAuthNext = false;
      res.writeHead(401).end("{}");
      return;
    }
    const body = JSON.parse(raw);
    fcm.sends.push({ token: body.message.token, body });
    if (fcm.failNext > 0) {
      fcm.failNext--;
      res.writeHead(503).end(JSON.stringify({ error: { status: "UNAVAILABLE" } }));
    } else if (String(body.message.token).startsWith("unregistered")) {
      res.writeHead(404).end(JSON.stringify({ error: { status: "NOT_FOUND", details: [{ errorCode: "UNREGISTERED" }] } }));
    } else {
      res.writeHead(200).end(JSON.stringify({ name: "projects/katkee-test/messages/1" }));
    }
  });
});

const apnsServer = http2.createServer();
apnsServer.on("stream", (stream, headers) => {
  let raw = "";
  stream.on("data", (c) => (raw += c));
  stream.on("end", () => {
    const { header, payload } = verifyJwt(String(headers.authorization).replace(/^bearer /, ""), apnsKeys.publicKey, "ES256");
    assert.deepEqual([header.alg, header.kid, payload.iss], ["ES256", "ABC123DEFG", "TEAM123456"]);
    assert.equal(headers["apns-topic"], "com.katkee.app");
    const token = decodeURIComponent(String(headers[":path"]).replace("/3/device/", ""));
    apns.sends.push({ token, headers, body: JSON.parse(raw) });
    if (token.startsWith("gone")) {
      stream.respond({ ":status": 410 });
      stream.end(JSON.stringify({ reason: "Unregistered" }));
    } else {
      stream.respond({ ":status": 200 });
      stream.end();
    }
  });
});

const server = buildApp();
let client: ReturnType<typeof makeClient>;
let baseUrl = "";
let worker: PushWorker;

before(async () => {
  await new Promise<void>((r) => fcmServer.listen(FCM_PORT, "127.0.0.1", r));
  await new Promise<void>((r) => apnsServer.listen(APNS_PORT, "127.0.0.1", r));
  await new Promise<void>((r) => server.listen(0, r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  client = makeClient(baseUrl);
  worker = new PushWorker({ providers: providersFromConfig(), pollMs: 50, maxAttempts: 5 });
});
after(async () => {
  await worker.stop();
  await new Promise<void>((r) => server.close(() => r()));
  await new Promise<void>((r) => fcmServer.close(() => r()));
  await new Promise<void>((r) => apnsServer.close(() => r()));
});
beforeEach(async () => {
  await worker.drain(); // nothing left over from the previous test
  fcm.sends.length = 0;
  apns.sends.length = 0;
});

async function signup() {
  const input = uniqueUser();
  const res = await client.post("/api/v1/auth/signup", input);
  return { username: input.username, id: res.body.user.id as string, token: res.body.tokens.accessToken as string, refresh: res.body.tokens.refreshToken as string };
}
const register = (token: string, device: Record<string, unknown>) => client.post("/api/v1/push/devices", device, authHeader(token));
const unique = (prefix: string) => `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2)}abcdefghij`;

async function publishPhotoStory(token: string): Promise<string> {
  const res = await fetch(`${baseUrl}/api/v1/media/photos`, { method: "POST", headers: { "Content-Type": "image/png", ...authHeader(token) }, body: buildTestPng(8, 8) });
  const mediaId = ((await res.json()) as { media: { id: string } }).media.id;
  const story = await client.post("/api/v1/stories", { mediaId, caption: "", audience: "public", allowComments: "everyone", allowSharing: true }, authHeader(token));
  assert.equal(story.status, 201, JSON.stringify(story.body));
  return story.body.story.id as string;
}

async function conversationBetween(a: { token: string }, b: { username: string }) {
  return (await client.post(`/api/v1/users/${b.username}/conversation`, undefined, authHeader(a.token))).body.conversation.id as string;
}

describe("push devices", () => {
  it("registers, refreshes, moves between accounts and unregisters device tokens", async () => {
    const [a, b] = [await signup(), await signup()];
    const token = unique("fcm-");
    assert.equal((await register(a.token, { provider: "fcm", platform: "android", token, appVersion: "1.0.0", locale: "en-IN" })).status, 201);
    assert.equal((await register(a.token, { provider: "fcm", platform: "android", token })).status, 200, "same token refreshes");
    assert.equal((await register(b.token, { provider: "fcm", platform: "android", token })).status, 200, "the phone signed in as someone else");
    assert.equal((await queryOne(`SELECT user_id FROM push_devices WHERE token = :'t'`, { t: token }))?.user_id, b.id);
    assert.equal((await register(a.token, { provider: "apns", platform: "android", token: unique("x") })).status, 422);
    assert.equal((await register(a.token, { provider: "fcm", platform: "android", token: "short" })).status, 422);
    assert.equal((await client.post("/api/v1/push/devices/unregister", { provider: "fcm", token }, authHeader(b.token))).status, 204);
    assert.equal(await queryOne(`SELECT id FROM push_devices WHERE token = :'t'`, { t: token }), null);
  });

  it("stops pushing to a device when the sign-in that registered it ends", async () => {
    const a = await signup();
    const token = unique("apns-");
    await register(a.token, { provider: "apns", platform: "ios", token });
    await client.post("/api/v1/auth/logout", { refreshToken: a.refresh });
    assert.equal((await queryOne(`SELECT disabled_reason FROM push_devices WHERE token = :'t'`, { t: token }))?.disabled_reason, "signed_out");
  });
});

describe("push delivery", () => {
  it("sends a DM push to iOS (APNs) and Android (FCM) without the message text", async () => {
    const [a, b] = [await signup(), await signup()];
    const [iosToken, androidToken] = [unique("apns-"), unique("fcm-")];
    await register(a.token, { provider: "apns", platform: "ios", token: iosToken });
    await register(a.token, { provider: "fcm", platform: "android", token: androidToken });
    const conversation = await conversationBetween(b, a);
    await client.post(`/api/v1/conversations/${conversation}/messages`, { body: "the safe code is 4417" }, authHeader(b.token));
    assert.ok((await worker.drain()) >= 1);

    const ios = apns.sends.find((s) => s.token === iosToken)!;
    assert.ok(ios, "APNs request made");
    assert.equal(ios.body.aps.alert.body, `@${b.username} sent you a message`);
    assert.equal(ios.headers["apns-collapse-id"], `dm-${conversation}`);
    assert.equal(ios.headers["apns-push-type"], "alert");
    assert.equal(ios.body.aps["thread-id"], `dm-${conversation}`);
    assert.ok(ios.body.aps.badge >= 1);
    assert.equal(ios.body.url, `katkee://conversation/${conversation}`);
    const android = fcm.sends.find((s) => s.token === androidToken)!;
    assert.equal(android.body.message.notification.body, `@${b.username} sent you a message`);
    assert.equal(android.body.message.android.collapse_key, `dm-${conversation}`);
    assert.equal(android.body.message.data.conversationId, conversation);
    assert.ok(![...apns.sends.map((s) => JSON.stringify(s.body)), ...fcm.sends.map((s) => JSON.stringify(s.body))].some((p) => p.includes("4417")),
      "DM text never leaves the server in a push");
    const row = await queryOne(`SELECT status FROM push_outbox WHERE user_id = :'u' AND kind = 'message' ORDER BY id DESC LIMIT 1`, { u: a.id });
    assert.equal(row?.status, "sent");
  });

  it("disables tokens the providers report as gone", async () => {
    const [a, b] = [await signup(), await signup()];
    const [deadAndroid, deadIos] = [unique("unregistered-"), unique("gone-")];
    await register(a.token, { provider: "fcm", platform: "android", token: deadAndroid });
    await register(a.token, { provider: "apns", platform: "ios", token: deadIos });
    await client.post(`/api/v1/users/${a.username}/follow`, undefined, authHeader(b.token));
    await worker.drain();
    const rows = await query(`SELECT token, disabled_reason FROM push_devices WHERE user_id = :'u' ORDER BY token`, { u: a.id });
    assert.ok(rows.every((r) => String(r.disabled_reason).startsWith("invalid_token:")), JSON.stringify(rows));
    assert.equal((await queryOne(`SELECT status FROM push_outbox WHERE user_id = :'u' ORDER BY id DESC LIMIT 1`, { u: a.id }))?.status, "skipped");
  });

  it("honours preferences and blocks at send time", async () => {
    const [a, b, c] = [await signup(), await signup(), await signup()];
    const token = unique("fcm-");
    await register(a.token, { provider: "fcm", platform: "android", token });
    await client.patch("/api/v1/notifications/preferences", { messagesEnabled: false }, authHeader(a.token));
    const conversation = await conversationBetween(b, a);
    await client.post(`/api/v1/conversations/${conversation}/messages`, { body: "hi" }, authHeader(b.token));
    await client.post(`/api/v1/users/${a.username}/follow`, undefined, authHeader(c.token));
    await worker.drain();
    const statuses = await query(`SELECT kind, status, last_error FROM push_outbox WHERE user_id = :'u' ORDER BY id`, { u: a.id });
    assert.deepEqual(statuses.map((s) => [s.kind, s.status]), [["message", "skipped"], ["follow", "sent"]]);
    assert.equal(statuses[0]!.last_error, "message pushes turned off");

    await client.patch("/api/v1/notifications/preferences", { pushEnabled: false, messagesEnabled: true }, authHeader(a.token));
    await client.post(`/api/v1/conversations/${conversation}/messages`, { body: "again" }, authHeader(b.token));
    await worker.drain();
    assert.equal((await queryOne(`SELECT last_error FROM push_outbox WHERE user_id = :'u' ORDER BY id DESC LIMIT 1`, { u: a.id }))?.last_error, "push turned off");

    await client.patch("/api/v1/notifications/preferences", { pushEnabled: true }, authHeader(a.token));
    const story = await publishPhotoStory(a.token);
    await client.post(`/api/v1/stories/${story}/like`, undefined, authHeader(c.token));
    await client.post(`/api/v1/users/${c.username}/block`, undefined, authHeader(a.token)); // blocked before the push goes out
    await worker.drain();
    const like = await queryOne(`SELECT status, last_error FROM push_outbox WHERE user_id = :'u' AND kind = 'like' ORDER BY id DESC LIMIT 1`, { u: a.id });
    assert.deepEqual([like?.status, like?.last_error], ["skipped", "actor unavailable"]);
  });

  it("retries provider outages with backoff and re-mints an access token the provider rejects", async () => {
    const [a, b] = [await signup(), await signup()];
    const token = unique("fcm-");
    await register(a.token, { provider: "fcm", platform: "android", token });
    fcm.failNext = 1;
    await client.post(`/api/v1/users/${a.username}/follow`, undefined, authHeader(b.token));
    await worker.drain();
    let row = await queryOne(`SELECT status, attempts, run_after > now() AS later FROM push_outbox WHERE user_id = :'u' ORDER BY id DESC LIMIT 1`, { u: a.id });
    assert.deepEqual([row?.status, row?.attempts, row?.later], ["queued", "1", "t"]);
    await query(`UPDATE push_outbox SET run_after = now() WHERE user_id = :'u' AND status = 'queued'`, { u: a.id });
    const mintedBefore = fcm.tokenRequests;
    fcm.rejectAuthNext = true;
    await worker.drain();
    row = await queryOne(`SELECT status, attempts FROM push_outbox WHERE user_id = :'u' ORDER BY id DESC LIMIT 1`, { u: a.id });
    assert.deepEqual([row?.status, row?.attempts], ["sent", "2"]);
    assert.equal(fcm.tokenRequests, mintedBefore + 1, "a rejected access token is replaced once");
  });

  it("never queues a second push for a retried DM send", async () => {
    const [a, b] = [await signup(), await signup()];
    const conversation = await conversationBetween(b, a);
    const send = () => client.post(`/api/v1/conversations/${conversation}/messages`, { body: "once", clientMessageId: "retry_0123456789abcdef" }, authHeader(b.token));
    const results = await Promise.all([send(), send(), send()]);
    assert.equal(new Set(results.map((r) => r.body.message.id)).size, 1);
    assert.equal((await queryOne(`SELECT count(*) AS n FROM push_outbox WHERE user_id = :'u' AND kind = 'message'`, { u: a.id }))?.n, "1");
  });
});
