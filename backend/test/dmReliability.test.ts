import "./env";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { buildApp } from "../src/app";
import { queryOne } from "../src/db/psql";
import { authHeader, makeClient, uniqueUser } from "./helpers";

const server = buildApp();
let client: ReturnType<typeof makeClient>;

before(async () => {
  await new Promise<void>((resolve) => server.listen(0, resolve));
  client = makeClient(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
});
after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function signup(displayName?: string) {
  const input = { ...uniqueUser(), ...(displayName ? { displayName } : {}) };
  const res = await client.post("/api/v1/auth/signup", input);
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return { username: input.username, id: res.body.user.id as string, token: res.body.tokens.accessToken as string };
}
type User = Awaited<ReturnType<typeof signup>>;

async function conversation(from: User, to: User): Promise<string> {
  return (await client.post(`/api/v1/users/${to.username}/conversation`, undefined, authHeader(from.token))).body.conversation.id as string;
}
const send = (user: User, conversationId: string, body: Record<string, unknown>) =>
  client.post(`/api/v1/conversations/${conversationId}/messages`, body, authHeader(user.token));
const page = (user: User, conversationId: string, qs: string) =>
  client.get(`/api/v1/conversations/${conversationId}/messages?${qs}`, authHeader(user.token));
const clientId = () => `m_${randomUUID().replace(/-/g, "")}`;

describe("DM sends", () => {
  it("stores one message however many times a send is retried, even concurrently", async () => {
    const [a, b] = [await signup(), await signup()];
    const id = await conversation(a, b);
    const clientMessageId = clientId();
    const results = await Promise.all(Array.from({ length: 6 }, () => send(a, id, { body: "see you at 7", clientMessageId })));
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 200, 200, 200, 200, 201], "one created, the rest replayed");
    assert.equal(new Set(results.map((r) => r.body.message.id)).size, 1);
    assert.equal((await queryOne(`SELECT count(*) AS n FROM messages WHERE conversation_id = :'c'`, { c: id }))?.n, "1");

    const later = await send(a, id, { body: "see you at 7", clientMessageId });
    assert.deepEqual([later.status, later.body.message.id], [200, results[0]!.body.message.id], "a retry long after still replays");
    assert.equal((await send(a, id, { body: "see you at 8", clientMessageId })).status, 409, "an id can't be reused for different text");
    assert.equal((await send(b, id, { body: "see you at 7", clientMessageId })).status, 201, "ids are per sender");
    assert.equal((await send(a, id, { body: "x", clientMessageId: "too-short" })).status, 422);
    assert.equal((await send(a, id, { body: "x", clientMessageId: "has spaces in it, not allowed" })).status, 422);
    assert.equal((await send(a, id, { body: "no id still works" })).status, 201, "older clients without ids keep working");

    const asSender = (await page(a, id, "limit=10")).body.messages as { senderId: string; clientMessageId?: string }[];
    assert.ok(asSender.some((m) => m.clientMessageId === clientMessageId), "the sender sees its own message ids");
    const asRecipient = (await page(b, id, "limit=10")).body.messages as { senderId: string; clientMessageId?: string }[];
    assert.ok(asRecipient.filter((m) => m.senderId === a.id).every((m) => m.clientMessageId === undefined), "the recipient never does");
    assert.ok(asRecipient.some((m) => m.senderId === b.id && m.clientMessageId === clientMessageId), "...except on its own messages");
  });

  it("replays a retry even after the conversation was blocked, but refuses new messages", async () => {
    const [a, b] = [await signup(), await signup()];
    const id = await conversation(a, b);
    const clientMessageId = clientId();
    assert.equal((await send(a, id, { body: "hi", clientMessageId })).status, 201);
    await client.post(`/api/v1/users/${a.username}/block`, undefined, authHeader(b.token));
    assert.equal((await send(a, id, { body: "hi", clientMessageId })).status, 200, "the lost response is answered, nothing new is sent");
    assert.equal((await send(a, id, { body: "hello?", clientMessageId: clientId() })).status, 404);
  });
});

describe("opening a conversation by id", () => {
  it("returns the other participant to participants only, and 404s malformed ids instead of failing", async () => {
    const [a, b, c] = [await signup("Ada Lovelace"), await signup("Bob"), await signup()];
    const id = await conversation(a, b);
    const asB = await client.get(`/api/v1/conversations/${id}`, authHeader(b.token));
    assert.equal(asB.status, 200);
    assert.deepEqual([asB.body.conversation.id, asB.body.conversation.otherUser.username, asB.body.conversation.otherUser.displayName], [id, a.username, "Ada Lovelace"]);
    assert.equal((await client.get(`/api/v1/conversations/${id}`, authHeader(c.token))).status, 404);
    assert.equal((await client.get(`/api/v1/conversations/${randomUUID()}`, authHeader(b.token))).status, 404);
    assert.equal((await client.get(`/api/v1/conversations/${id}`)).status, 401);
    for (const bad of ["not-a-uuid", "------------------------------------"]) {
      assert.equal((await client.get(`/api/v1/conversations/${bad}`, authHeader(b.token))).status, 404);
      assert.equal((await client.get(`/api/v1/conversations/${bad}/messages`, authHeader(b.token))).status, 404);
      assert.equal((await send(b, bad, { body: "x" })).status, 404);
    }
    assert.equal((await page(b, id, "before=------------------------------------")).status, 400);
    assert.equal((await send(b, id, { storyId: "------------------------------------" })).status, 422);
    assert.equal((await client.get("/api/v1/conversations/unread-count", authHeader(b.token))).status, 200, "static route still wins");
  });
});

describe("DM history paging", () => {
  it("pages with cursors that stay stable while new messages arrive", async () => {
    const [a, b] = [await signup(), await signup()];
    const id = await conversation(a, b);
    const sent: string[] = [];
    for (let i = 1; i <= 7; i++) sent.push((await send(i % 2 ? a : b, id, { body: `m${i}` })).body.message.id);

    const first = await page(b, id, "limit=3");
    assert.deepEqual(first.body.messages.map((m: { body: string }) => m.body), ["m7", "m6", "m5"], "newest first");
    await send(a, id, { body: "m8" }); // arrives while B scrolls back
    await send(b, id, { body: "m9" });

    const older = await page(b, id, `before=${sent[4]}&limit=3`);
    assert.deepEqual([older.body.messages.map((m: { body: string }) => m.body), older.body.hasMore], [["m4", "m3", "m2"], true]);
    const oldest = await page(b, id, `before=${sent[1]}&limit=3`);
    assert.deepEqual([oldest.body.messages.map((m: { body: string }) => m.body), oldest.body.hasMore], [["m1"], false]);

    const newer = await page(b, id, `after=${sent[6]}&limit=10`);
    assert.deepEqual([newer.body.messages.map((m: { body: string }) => m.body), newer.body.hasMore], [["m9", "m8"], false]);
    const nextOne = await page(b, id, `after=${sent[6]}&limit=1`);
    assert.deepEqual([nextOne.body.messages.map((m: { body: string }) => m.body), nextOne.body.hasMore], [["m8"], true], "catch-up moves forward oldest-first");

    // Offset paging (older clients) still works.
    assert.equal((await page(b, id, "limit=2&offset=2")).body.messages.length, 2);
    assert.equal((await page(b, id, "before=not-a-message")).status, 400);
    assert.equal((await page(b, id, "after=1;DROP")).status, 400);
  });

  it("never pages into another conversation through a foreign cursor", async () => {
    const [a, b, c] = [await signup(), await signup(), await signup()];
    const ab = await conversation(a, b), ac = await conversation(a, c);
    const mine = (await send(a, ab, { body: "between a and b" })).body.message.id;
    await send(a, ac, { body: "between a and c" });
    const foreign = await page(c, ac, `before=${mine}`);
    assert.equal(foreign.status, 200);
    assert.deepEqual(foreign.body.messages, []);
    assert.equal((await page(c, ab, "limit=5")).status, 404, "not a participant");
  });
});

describe("conversation search", () => {
  it("finds conversations by the other person's username or name, treating % and _ literally", async () => {
    const me = await signup();
    const priya = await signup("Priya 100% Real");
    const rahul = await signup("Rahul K");
    await conversation(me, priya);
    await conversation(me, rahul);
    const search = async (q: string) =>
      (await client.get(`/api/v1/conversations?q=${encodeURIComponent(q)}`, authHeader(me.token))).body.conversations
        .map((c: { otherUser: { username: string } }) => c.otherUser.username).sort();

    assert.deepEqual(await search("rahul"), [rahul.username]);
    assert.deepEqual(await search(priya.username.slice(-6)), [priya.username]);
    assert.deepEqual(await search("%"), [priya.username], "% matches a literal percent sign, not everything");
    assert.deepEqual(await search("100%"), [priya.username]);
    assert.deepEqual(await search("t_st"), [], "_ is not a single-character wildcard");
    assert.deepEqual(await search(""), [priya.username, rahul.username].sort(), "empty query lists all");
  });

  it("treats % and _ literally in people search too", async () => {
    const me = await signup();
    const target = await signup("Zebra_Crossing 50%");
    const search = async (q: string) =>
      (await client.get(`/api/v1/search/users?q=${encodeURIComponent(q)}`, authHeader(me.token))).body.results.map((u: { username: string }) => u.username);
    assert.ok((await search("Zebra_Crossing")).includes(target.username));
    assert.ok((await search("_")).length >= 1);
    assert.deepEqual(await search("Zebr%Crossing"), [], "% inside a query is not a wildcard");
    assert.deepEqual(await search("Zebra_Crossing 5_%"), [], "_ inside a query is not a wildcard");
  });
});
