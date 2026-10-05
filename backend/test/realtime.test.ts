// Ping/expiry checks every 300 ms here instead of every 30 s, so expiry is observable quickly.
process.env.REALTIME_HEARTBEAT_MS = "300";

import "./env";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import WebSocket from "ws";
import { buildApp } from "../src/app";
import { query } from "../src/db/psql";
import { authHeader, makeClient, uniqueUser } from "./helpers";

const servers: Server[] = [buildApp(), buildApp()];
const urls: string[] = [];
let client: ReturnType<typeof makeClient>;

before(async () => {
  for (const server of servers) {
    await new Promise<void>((resolve) => server.listen(0, resolve));
    urls.push(`127.0.0.1:${(server.address() as AddressInfo).port}`);
  }
  client = makeClient(`http://${urls[0]}`);
});
after(async () => {
  for (const server of servers) await new Promise<void>((resolve) => server.close(() => resolve()));
});

interface Live {
  ws: WebSocket;
  events: { type: string; [k: string]: unknown }[];
  next(type: string, ms?: number): Promise<{ type: string; [k: string]: unknown }>;
  closed: Promise<{ code: number; reason: string }>;
}

function open(path: string, headers: Record<string, string> = {}, server = 0): Promise<Live> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://${urls[server]}${path}`, { headers });
    const events: Live["events"] = [];
    const waiters: { type: string; resolve: (e: Live["events"][number]) => void }[] = [];
    const closed = new Promise<{ code: number; reason: string }>((r) => ws.on("close", (code, reason) => r({ code, reason: reason.toString() })));
    ws.on("message", (data) => {
      const event = JSON.parse(data.toString()) as Live["events"][number];
      events.push(event);
      for (const w of [...waiters]) if (w.type === event.type) { waiters.splice(waiters.indexOf(w), 1); w.resolve(event); }
    });
    ws.once("unexpected-response", (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
    ws.once("error", reject);
    const live: Live = {
      ws, events, closed,
      next(type, ms = 5000) {
        const seen = events.find((e) => e.type === type && !(e as { _taken?: boolean })._taken);
        if (seen) { (seen as { _taken?: boolean })._taken = true; return Promise.resolve(seen); }
        return new Promise((res, rej) => {
          const timer = setTimeout(() => rej(new Error(`no ${type} event within ${ms} ms`)), ms);
          waiters.push({ type, resolve: (e) => { clearTimeout(timer); (e as { _taken?: boolean })._taken = true; res(e); } });
        });
      },
    };
    ws.once("open", () => live.next("hello").then(() => resolve(live), reject));
  });
}

async function signup() {
  const input = uniqueUser();
  const res = await client.post("/api/v1/auth/signup", input);
  return { username: input.username, id: res.body.user.id as string, token: res.body.tokens.accessToken as string, refresh: res.body.tokens.refreshToken as string, password: input.password, email: input.email };
}

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

describe("realtime connections", () => {
  it("authenticates the handshake and refuses everything else", async () => {
    const user = await signup();
    const live = await open("/api/v1/realtime", bearer(user.token));
    assert.equal(live.events[0]?.userId, user.id);
    live.ws.close();
    await assert.rejects(open("/api/v1/realtime"), /HTTP 401/);
    await assert.rejects(open("/api/v1/realtime", bearer("not.a.token")), /HTTP 401/);
    await assert.rejects(open("/api/v1/elsewhere", bearer(user.token)), /HTTP 404/);
  });

  it("accepts a single-use ticket for clients that can't send headers", async () => {
    const user = await signup();
    const ticket = await client.post("/api/v1/realtime/ticket", undefined, authHeader(user.token));
    assert.equal(ticket.status, 201);
    const live = await open(`/api/v1/realtime?ticket=${ticket.body.ticket}`);
    assert.equal(live.events[0]?.userId, user.id);
    live.ws.close();
    await assert.rejects(open(`/api/v1/realtime?ticket=${ticket.body.ticket}`), /HTTP 401/, "single use");
    const stale = await client.post("/api/v1/realtime/ticket", undefined, authHeader(user.token));
    await query(`UPDATE realtime_tickets SET expires_at = now() - interval '1 second'`);
    await assert.rejects(open(`/api/v1/realtime?ticket=${stale.body.ticket}`), /HTTP 401/, "expired");
  });

  it("delivers new messages and receipts to both participants, with ids only", async () => {
    const [a, b] = [await signup(), await signup()];
    const conversation = (await client.post(`/api/v1/users/${b.username}/conversation`, undefined, authHeader(a.token))).body.conversation;
    const [liveA, liveB] = [await open("/api/v1/realtime", bearer(a.token)), await open("/api/v1/realtime", bearer(b.token))];
    const sent = await client.post(`/api/v1/conversations/${conversation.id}/messages`, { body: "secret plans for friday" }, authHeader(a.token));
    assert.equal(sent.status, 201);
    const [toB, toA] = await Promise.all([liveB.next("message"), liveA.next("message")]);
    for (const event of [toA, toB]) {
      assert.deepEqual([event.conversationId, event.messageId, event.senderId], [conversation.id, sent.body.message.id, a.id]);
    }
    assert.ok(!JSON.stringify(liveB.events).includes("secret plans"), "message text never travels over the realtime channel");

    await client.get(`/api/v1/conversations/${conversation.id}/messages`, authHeader(b.token)); // B's app received it
    const delivered = await liveA.next("receipt");
    assert.deepEqual([delivered.conversationId, delivered.userId], [conversation.id, b.id]);
    assert.ok(Date.parse(String(delivered.lastDeliveredAt)) >= Date.parse(sent.body.message.createdAt));
    await client.post(`/api/v1/conversations/${conversation.id}/read`, undefined, authHeader(b.token));
    const read = await liveA.next("receipt");
    assert.ok(Date.parse(String(read.lastReadAt)) >= Date.parse(sent.body.message.createdAt));
    liveA.ws.close();
    liveB.ws.close();
  });

  it("delivers Activity notifications", async () => {
    const [a, b] = [await signup(), await signup()];
    const liveA = await open("/api/v1/realtime", bearer(a.token));
    await client.post(`/api/v1/users/${a.username}/follow`, undefined, authHeader(b.token));
    const event = await liveA.next("notification");
    assert.equal(event.kind, "follow");
    liveA.ws.close();
  });

  it("reaches a user connected to a different API instance", async () => {
    const [a, b] = [await signup(), await signup()];
    const liveA = await open("/api/v1/realtime", bearer(a.token), 1); // instance 2
    const conversation = (await client.post(`/api/v1/users/${a.username}/conversation`, undefined, authHeader(b.token))).body.conversation;
    await client.post(`/api/v1/conversations/${conversation.id}/messages`, { body: "hello across instances" }, authHeader(b.token)); // instance 1
    const event = await liveA.next("message");
    assert.equal(event.conversationId, conversation.id);
    liveA.ws.close();
  });

  it("closes connections as soon as their sign-in ends, the account is suspended, or the token expires", async () => {
    const user = await signup();
    const live = await open("/api/v1/realtime", bearer(user.token));
    const started = Date.now();
    await client.post("/api/v1/auth/logout", { refreshToken: user.refresh });
    const closed = await live.closed;
    assert.equal(closed.code, 4401);
    assert.ok(Date.now() - started < 3000, "immediately, not at the next periodic check");

    const other = await signup();
    const live2 = await open("/api/v1/realtime", bearer(other.token));
    await query(`UPDATE users SET is_active = false WHERE id = :'id'`, { id: other.id });
    assert.equal((await live2.closed).code, 4401);

    const third = await signup();
    const now = Math.floor(Date.now() / 1000);
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const unsigned = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: third.id, type: "access", iat: now, exp: now + 2 })}`;
    const shortLived = `${unsigned}.${createHmac("sha256", process.env.JWT_ACCESS_SECRET!).update(unsigned).digest("base64url")}`;
    const live3 = await open("/api/v1/realtime", bearer(shortLived));
    assert.equal((await live3.closed).code, 4001, "closed when its access token expires");
  });

  it("answers app-level pings so phones can detect dead connections, at a bounded rate", async () => {
    const user = await signup();
    const live = await open("/api/v1/realtime", bearer(user.token));
    live.ws.send(JSON.stringify({ type: "ping" }));
    await live.next("pong");
    live.ws.send(JSON.stringify({ type: "ping" }));
    live.ws.send("anything else is ignored");
    await new Promise((r) => setTimeout(r, 400));
    assert.equal(live.events.filter((e) => e.type === "pong").length, 1, "one pong per interval");
    assert.equal(live.ws.readyState, WebSocket.OPEN);
    live.ws.close();
  });

  it("caps connections per user by replacing the oldest", async () => {
    const user = await signup();
    const sockets: Live[] = [];
    for (let i = 0; i < 10; i++) sockets.push(await open("/api/v1/realtime", bearer(user.token)));
    const eleventh = await open("/api/v1/realtime", bearer(user.token));
    assert.equal((await sockets[0]!.closed).code, 4409);
    for (const s of [...sockets.slice(1), eleventh]) s.ws.close();
  });
});
