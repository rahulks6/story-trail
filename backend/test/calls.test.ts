// A tight calling budget here (the other tests' env.ts raises it), so the limit is observable.
process.env.SAFETY_LIMITS_JSON = JSON.stringify(Object.fromEntries(
  ["like", "comment", "follow", "message", "conversation", "view"].map((k) => [k, { perMinute: 100000, perHour: 1000000, newAccountPerHour: 1000000 }])
    .concat([["call", { perMinute: 4, perHour: 1000000, newAccountPerHour: 1000000 }]]),
));

import "./env";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import type { AddressInfo } from "node:net";
import WebSocket from "ws";
import { buildApp } from "../src/app";
import { query, queryOne } from "../src/db/psql";
import { renderPush } from "../src/modules/push/dispatcher";
import { endAbandonedCalls } from "../src/modules/calls/calls.service";
import { sharedSecretCredential } from "../src/modules/calls/ice-servers";
import { authHeader, makeClient, uniqueUser } from "./helpers";

// Voice and video calls: who may call whom (the rules of a DM), the call's states, the relayed
// signaling, the realtime events and pushes, and the call's line in the chat.
const server = buildApp();
let client: ReturnType<typeof makeClient>;
let host = "";
before(async () => {
  await new Promise<void>((resolve) => server.listen(0, resolve));
  host = `127.0.0.1:${(server.address() as AddressInfo).port}`;
  client = makeClient(`http://${host}`);
});
after(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); });

interface User { username: string; id: string; token: string }
async function signup(): Promise<User> {
  const input = uniqueUser();
  const res = await client.post("/api/v1/auth/signup", input);
  return { username: input.username, id: res.body.user.id as string, token: res.body.tokens.accessToken as string };
}
async function chat(): Promise<{ a: User; b: User; c: string }> {
  const a = await signup(), b = await signup();
  const c = (await client.post(`/api/v1/users/${b.username}/conversation`, undefined, authHeader(a.token))).body.conversation.id as string;
  return { a, b, c };
}
const call = (c: string, u: User, media = "audio") => client.post(`/api/v1/conversations/${c}/calls`, { media }, authHeader(u.token));
const act = (id: string, u: User, what: string, body?: unknown) => client.post(`/api/v1/calls/${id}/${what}`, body, authHeader(u.token));
const signals = (id: string, u: User, after = 0) => client.get(`/api/v1/calls/${id}/signals?after=${after}`, authHeader(u.token));
const OFFER = { kind: "offer", payload: { sdp: "v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\ns=-\r\n" } };
const ANSWER = { kind: "answer", payload: { sdp: "v=0\r\no=- 3 4 IN IP4 127.0.0.1\r\ns=-\r\n" } };
const CANDIDATE = { kind: "candidate", payload: { candidate: "candidate:1 1 udp 2122260223 192.0.2.1 54400 typ host", sdpMid: "0", sdpMLineIndex: 0 } };

async function callLines(c: string, u: User) {
  const messages = (await client.get(`/api/v1/conversations/${c}/messages`, authHeader(u.token))).body.messages as { event: { type: string } | null; senderId: string }[];
  return messages.filter((m) => m.event?.type === "call");
}
async function pushes(userId: string, kind: string) {
  return query(`SELECT ref_id, actor_id FROM push_outbox WHERE user_id = :'u' AND kind = :'k' ORDER BY id`, { u: userId, k: kind });
}

function listen(token: string): Promise<{ events: Record<string, unknown>[]; next: (type: string, match?: (e: Record<string, unknown>) => boolean) => Promise<Record<string, unknown>>; close: () => void }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://${host}/api/v1/realtime`, { headers: { Authorization: `Bearer ${token}` } });
    const events: Record<string, unknown>[] = [];
    const waiters: { type: string; match: (e: Record<string, unknown>) => boolean; resolve: (e: Record<string, unknown>) => void }[] = [];
    ws.on("message", (data) => {
      const event = JSON.parse(data.toString()) as Record<string, unknown>;
      events.push(event);
      for (const w of [...waiters]) if (w.type === event.type && w.match(event)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(event); }
      if (event.type === "hello") resolve(live);
    });
    ws.once("error", reject);
    const live = {
      events,
      next: (type: string, match: (e: Record<string, unknown>) => boolean = () => true) => {
        const seen = events.find((e) => e.type === type && match(e) && !e._taken);
        if (seen) { seen._taken = true; return Promise.resolve(seen); }
        return new Promise<Record<string, unknown>>((res, rej) => {
          const timer = setTimeout(() => rej(new Error(`no matching ${type} event in ${JSON.stringify(events)}`)), 5000);
          waiters.push({ type, match, resolve: (e) => { clearTimeout(timer); e._taken = true; res(e); } });
        });
      },
      close: () => ws.close(),
    };
  });
}

describe("who may call whom", () => {
  it("only the two people in a 1:1 chat, never across a block, never in a group", async () => {
    const { a, b, c } = await chat();
    const stranger = await signup();
    assert.equal((await client.post(`/api/v1/conversations/${c}/calls`, { media: "audio" })).status, 401);
    assert.equal((await call(c, stranger)).status, 404, "not in the chat");
    assert.equal((await call("not-a-uuid", a)).status, 404);
    assert.equal((await call(c, a, "hologram")).status, 422);

    const details = (await client.get(`/api/v1/conversations/${c}`, authHeader(a.token))).body.conversation;
    assert.equal(details.callsAvailable, true);

    await client.post(`/api/v1/users/${a.username}/block`, undefined, authHeader(b.token));
    assert.equal((await call(c, a)).status, 404, "blocked looks like an account that's gone");
    assert.equal((await call(c, b)).status, 404, "and the blocker can't call either");
    assert.equal((await client.get(`/api/v1/conversations/${c}`, authHeader(a.token))).body.conversation.callsAvailable, false);

    const group = (await queryOne(`INSERT INTO conversations (kind) VALUES ('group') RETURNING id`))!.id as string;
    await query(`INSERT INTO conversation_members (conversation_id, user_id) VALUES (:'g', :'a'), (:'g', :'s')`, { g: group, a: a.id, s: stranger.id });
    assert.equal((await call(group, stranger)).status, 422, "no group calls");
  });

  it("someone else can't see, answer or signal a call", async () => {
    const { a, b, c } = await chat();
    const stranger = await signup();
    const id = (await call(c, a)).body.call.id as string;
    assert.equal((await client.get(`/api/v1/calls/${id}`, authHeader(stranger.token))).status, 404);
    assert.equal((await act(id, stranger, "accept")).status, 404);
    assert.equal((await act(id, stranger, "signals", OFFER)).status, 404);
    assert.equal((await act(id, a, "accept")).status, 403, "the caller can't answer their own call");
    assert.equal((await act(id, b, "decline")).status, 200);
  });

  it("a suspended account can't be called", async () => {
    const { a, b, c } = await chat();
    await query(`UPDATE users SET is_active = false WHERE id = :'id'`, { id: b.id });
    assert.equal((await call(c, a)).status, 404);
  });

  it("placing calls is rate limited", async () => {
    const { a, b, c } = await chat();
    for (let i = 0; i < 4; i++) {
      const res = await call(c, a);
      assert.equal(res.status, 201);
      await act(res.body.call.id, b, "decline");
    }
    const limited = await call(c, a);
    assert.equal(limited.status, 429);
    assert.match(limited.body.message, /calling too often/);
  });
});

describe("a call from ringing to its line in the chat", () => {
  it("rings, connects through relayed signals, and ends as 'Voice call · m:ss'", async () => {
    const { a, b, c } = await chat();
    const [liveA, liveB] = await Promise.all([listen(a.token), listen(b.token)]);
    try {
      const started = await call(c, a);
      assert.equal(started.status, 201);
      const id = started.body.call.id as string;
      assert.equal(started.body.call.state, "ringing");
      assert.equal(started.body.call.outgoing, true);
      assert.ok(started.body.iceServers.iceServers[0].urls[0].startsWith("stun:"), "STUN without a TURN provider");
      assert.equal(started.body.call.callee.username, b.username);

      // The callee's phones hear the invite (ids only) and get a ringing push.
      const invite = await liveB.next("call", (e) => e.callId === id);
      assert.deepEqual({ state: invite.state, media: invite.media, callerId: invite.callerId, conversationId: invite.conversationId }, { state: "ringing", media: "audio", callerId: a.id, conversationId: c });
      assert.equal((await pushes(b.id, "call")).length, 1);
      const rendered = await renderPush({ id: "1", userId: b.id, kind: "call", actorId: a.id, refId: id, attempts: 1 });
      assert.ok("message" in rendered);
      if ("message" in rendered) {
        assert.equal(rendered.message.body, `@${a.username} is calling you`);
        assert.equal(rendered.message.channel, "calls");
        assert.equal(rendered.message.data.url, `katkee://call/${id}`);
        assert.ok(rendered.message.ttlSeconds! > 30 && rendered.message.ttlSeconds! <= 45, "never delivered after the ring time");
      }

      // The caller offers with the invite; the callee can't read it (or send anything) before answering.
      assert.equal((await act(id, a, "signals", OFFER)).status, 201);
      assert.equal((await act(id, a, "signals", CANDIDATE)).status, 201);
      assert.deepEqual((await signals(id, b)).body.signals, []);
      assert.equal((await act(id, b, "signals", CANDIDATE)).status, 409);
      assert.equal((await act(id, b, "signals", OFFER)).status, 409);

      assert.equal((await act(id, b, "ringing")).status, 200);
      const ringing = await liveA.next("call", (e) => e.callId === id && e.ringing === true);
      assert.equal(ringing.state, "ringing");

      const accepted = await act(id, b, "accept");
      assert.equal(accepted.status, 200);
      assert.equal(accepted.body.call.state, "active");
      assert.ok(Array.isArray(accepted.body.iceServers.iceServers));
      await liveA.next("call", (e) => e.callId === id && e.state === "active");
      assert.equal((await act(id, b, "accept")).status, 409, "answered once");

      const fromCaller = (await signals(id, b)).body.signals as { seq: number; kind: string; payload: { sdp?: string } }[];
      assert.deepEqual(fromCaller.map((s) => s.kind), ["offer", "candidate"]);
      assert.equal(fromCaller[0]!.payload.sdp, OFFER.payload.sdp);
      assert.deepEqual((await signals(id, b, fromCaller[1]!.seq)).body.signals, [], "after= skips what was handled");

      assert.equal((await act(id, b, "signals", ANSWER)).status, 201);
      const sent = await act(id, b, "signals", CANDIDATE);
      const announced = await liveA.next("call_signal", (e) => e.seq === sent.body.seq);
      assert.deepEqual(Object.keys(announced).filter((k) => k !== "_taken").sort(), ["callId", "seq", "type"], "events carry ids, never the signal");
      assert.deepEqual(((await signals(id, a)).body.signals as { kind: string }[]).map((s) => s.kind), ["answer", "candidate"]);
      assert.equal((await act(id, a, "signals", ANSWER)).status, 409, "only the callee answers");

      // Talked for 4:12.
      await query(`UPDATE calls SET answered_at = now() - interval '252 seconds' WHERE id = :'id'`, { id });
      assert.equal((await act(id, a, "heartbeat")).body.call.state, "active");
      const ended = await act(id, b, "end");
      assert.equal(ended.body.call.state, "ended");
      assert.equal(ended.body.call.endReason, "completed");
      assert.equal(ended.body.call.durationSeconds, 252);
      await liveA.next("call", (e) => e.callId === id && e.state === "ended" && e.reason === "completed");
      await liveB.next("message", (e) => e.conversationId === c);

      const lines = await callLines(c, a);
      assert.equal(lines.length, 1);
      assert.deepEqual(lines[0]!.event, { type: "call", callId: id, media: "audio", outcome: "completed", durationSeconds: 252 });
      assert.equal(lines[0]!.senderId, a.id);
      // Both talked: the line doesn't make the chat unread for either; no missed-call push.
      const inbox = (await client.get(`/api/v1/conversations`, authHeader(b.token))).body.conversations.find((x: { id: string }) => x.id === c);
      assert.equal(inbox.unread, false);
      assert.equal((await pushes(b.id, "call_missed")).length, 0);

      // Ended once; its signaling is gone with it; nothing more can be said.
      assert.equal((await act(id, a, "end")).body.call.endReason, "completed");
      assert.equal((await queryOne(`SELECT count(*) AS n FROM call_signals WHERE call_id = :'id'`, { id }))!.n, "0");
      assert.equal((await act(id, a, "signals", CANDIDATE)).status, 409);
      assert.equal((await callLines(c, a)).length, 1);
      assert.deepEqual(await renderPush({ id: "2", userId: b.id, kind: "call", actorId: a.id, refId: id, attempts: 1 }), { skip: "call over" });
    } finally {
      liveA.close();
      liveB.close();
    }
  });

  it("declined, cancelled and missed calls each say so, and only unanswered ones push 'Missed call'", async () => {
    const { a, b, c } = await chat();
    const declined = (await call(c, a, "video")).body.call.id as string;
    assert.equal((await act(declined, b, "decline")).body.call.endReason, "declined");

    const cancelled = (await call(c, a)).body.call.id as string;
    assert.equal((await act(cancelled, a, "end")).body.call.endReason, "cancelled");
    assert.equal((await act(cancelled, b, "accept")).status, 409, "too late to answer");

    const timedOut = (await call(c, a, "video")).body.call.id as string;
    assert.equal((await act(timedOut, a, "end", { reason: "timeout" })).body.call.endReason, "missed");

    const outcomes = (await callLines(c, a)).map((m) => (m.event as unknown as { outcome: string; media: string })).map((e) => `${e.media}:${e.outcome}`);
    assert.deepEqual(outcomes, ["video:missed", "audio:cancelled", "video:declined"]);
    const missed = await pushes(b.id, "call_missed");
    assert.deepEqual(missed.map((p) => p.ref_id), [cancelled, timedOut]);
    const rendered = await renderPush({ id: "3", userId: b.id, kind: "call_missed", actorId: a.id, refId: timedOut, attempts: 1 });
    assert.ok("message" in rendered && rendered.message.body === `Missed video call from @${a.username}` && rendered.message.data.url === `katkee://conversation/${c}`);
    assert.equal((await client.get(`/api/v1/conversations`, authHeader(b.token))).body.conversations.find((x: { id: string }) => x.id === c).unread, true, "a missed call is unread for the callee");
    assert.equal((await client.get(`/api/v1/conversations`, authHeader(a.token))).body.conversations.find((x: { id: string }) => x.id === c).unread, false);
  });

  it("someone already on a call is busy; a caller can't place two calls at once", async () => {
    const { a, b, c } = await chat();
    const other = await signup();
    const toOther = (await client.post(`/api/v1/users/${other.username}/conversation`, undefined, authHeader(b.token))).body.conversation.id as string;
    const busyCall = (await call(toOther, b)).body.call.id as string;

    const res = await call(c, a);
    assert.equal(res.status, 201);
    assert.equal(res.body.call.state, "ended");
    assert.equal(res.body.call.endReason, "busy");
    assert.equal(res.body.iceServers, null);
    assert.equal((await pushes(b.id, "call_missed")).length, 1);

    const again = await call(toOther, b);
    assert.equal(again.status, 409);
    assert.equal(again.body.code, "in_call");
    await act(busyCall, b, "end");
    assert.equal((await call(c, a)).body.call.state, "ringing", "free again once that call ended");
  });

  it("a call nobody answers rings out as missed, and one both phones abandoned ends at their last sign of life", async () => {
    const { a, b, c } = await chat();
    const rang = (await call(c, a)).body.call.id as string;
    await query(`UPDATE calls SET created_at = now() - interval '2 minutes' WHERE id = :'id'`, { id: rang });
    assert.equal(await endAbandonedCalls([a.id]), 1);
    assert.equal((await client.get(`/api/v1/calls/${rang}`, authHeader(b.token))).body.call.endReason, "missed");

    const dropped = (await call(c, a)).body.call.id as string;
    await act(dropped, b, "accept");
    await query(
      `UPDATE calls SET answered_at = now() - interval '10 minutes', caller_seen_at = now() - interval '7 minutes', callee_seen_at = now() - interval '8 minutes' WHERE id = :'id'`,
      { id: dropped },
    );
    // Reading it ends it too, without waiting for the worker.
    const view = (await client.get(`/api/v1/calls/${dropped}`, authHeader(a.token))).body.call;
    assert.equal(view.state, "ended");
    assert.equal(view.endReason, "completed");
    assert.equal(view.durationSeconds, 120, "up to the last time both were heard from");
    assert.equal((await queryOne(`SELECT count(*) AS n FROM call_lines WHERE user_id IN (:'a', :'b')`, { a: a.id, b: b.id }))!.n, "0");
  });

  it("a block during a call ends it at the next heartbeat", async () => {
    const { a, b, c } = await chat();
    const id = (await call(c, a)).body.call.id as string;
    await act(id, b, "accept");
    await client.post(`/api/v1/users/${a.username}/block`, undefined, authHeader(b.token));
    assert.equal((await act(id, a, "heartbeat")).body.call.state, "ended");
  });

  it("refuses signals that aren't what a phone sends", async () => {
    const { a, b, c } = await chat();
    const id = (await call(c, a)).body.call.id as string;
    for (const bad of [
      { kind: "offer", payload: { sdp: "<script>" } },
      { kind: "offer", payload: { sdp: `v=0${"a".repeat(13_000)}` } },
      { kind: "candidate", payload: { candidate: 42 } },
      { kind: "candidate", payload: { candidate: "x", sdpMLineIndex: -1 } },
      { kind: "media", payload: { microphone: "yes", camera: true } },
      { kind: "file", payload: {} },
      { kind: "offer" },
    ]) assert.equal((await act(id, a, "signals", bad)).status, 422, JSON.stringify(bad).slice(0, 60));
    assert.equal((await signals(id, a, -1 as unknown as number)).status, 400);
    await act(id, b, "accept");
    assert.equal((await act(id, b, "signals", { kind: "media", payload: { microphone: false, camera: true } })).status, 201);
  });
});

describe("ICE servers", () => {
  it("are only for signed-in people, and short-lived", async () => {
    const u = await signup();
    assert.equal((await client.get("/api/v1/calls/ice-servers")).status, 401);
    const res = await client.get("/api/v1/calls/ice-servers", authHeader(u.token));
    assert.equal(res.status, 200);
    assert.ok(res.body.ttlSeconds > 0);
    assert.ok(res.body.iceServers.every((s: { urls: string[] }) => s.urls.every((url) => /^stuns?:/.test(url))), "no TURN without a provider");
  });

  it("shared-secret TURN credentials follow the TURN REST API", () => {
    const { username, credential } = sharedSecretCredential("s".repeat(40), "user-1", 1_900_000_000);
    assert.equal(username, "1900000000:user-1");
    assert.equal(credential, createHmac("sha1", "s".repeat(40)).update("1900000000:user-1").digest("base64"));
  });
});
