import "./env";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import WebSocket from "ws";
import { buildApp } from "../src/app";
import { query, queryOne } from "../src/db/psql";
import { authHeader, makeClient, uniqueUser } from "./helpers";
import { buildTestPng } from "./fixtures";

// Forward a message to other chats and people, and pin up to three messages in a chat.
let client: ReturnType<typeof makeClient>;
let host = "";
const server = buildApp();
before(async () => {
  await new Promise<void>((resolve) => server.listen(0, resolve));
  host = `127.0.0.1:${(server.address() as AddressInfo).port}`;
  client = makeClient(`http://${host}`);
});
after(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); });

type Person = { username: string; token: string; id: string };
async function signup(): Promise<Person> {
  const input = uniqueUser();
  const res = await client.post("/api/v1/auth/signup", input);
  return { username: input.username, token: res.body.tokens.accessToken as string, id: res.body.user.id as string };
}
const as = (p: Person) => authHeader(p.token);
const follow = (who: Person, whom: Person) => client.post(`/api/v1/users/${whom.username}/follow`, undefined, as(who));
async function chat(a: Person, b: Person): Promise<string> {
  return (await client.post(`/api/v1/users/${b.username}/conversation`, undefined, as(a))).body.conversation.id as string;
}
async function send(conversationId: string, p: Person, input: Record<string, unknown>): Promise<{ id: string; [k: string]: unknown }> {
  const res = await client.post(`/api/v1/conversations/${conversationId}/messages`, input, as(p));
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.message;
}
async function group(owner: Person, members: Person[]): Promise<string> {
  for (const m of members) await follow(m, owner);
  const res = await client.post("/api/v1/conversations/groups", { usernames: members.map((m) => m.username), title: "Weekend" }, as(owner));
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.conversation.id as string;
}
const forward = (conversationId: string, messageId: string, p: Person, body: unknown) =>
  client.post(`/api/v1/conversations/${conversationId}/messages/${messageId}/forward`, body, as(p));
const thread = async (conversationId: string, p: Person) => (await client.get(`/api/v1/conversations/${conversationId}/messages`, as(p))).body.messages as Array<Record<string, any>>;
async function photo(owner: Person): Promise<string> {
  const res = await fetch(`http://${host}/api/v1/media/photos`, { method: "POST", headers: { "Content-Type": "image/png", ...as(owner) }, body: buildTestPng(4, 4) });
  return ((await res.json()) as { media: { id: string } }).media.id;
}

/** A realtime connection that keeps every event it gets. */
async function live(p: Person): Promise<{ events: Array<Record<string, unknown>>; close(): void; next(type: string): Promise<Record<string, unknown>> }> {
  const ws = new WebSocket(`ws://${host}/api/v1/realtime`, { headers: as(p) });
  const events: Array<Record<string, unknown>> = [];
  ws.on("message", (data) => events.push(JSON.parse(data.toString())));
  await new Promise<void>((resolve, reject) => { ws.once("open", () => resolve()); ws.once("error", reject); });
  const next = async (type: string) => {
    for (let i = 0; i < 100; i++) {
      const found = events.find((e) => e.type === type);
      if (found) { events.splice(events.indexOf(found), 1); return found; }
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(`no ${type} event`);
  };
  await next("hello");
  return { events, close: () => ws.close(), next };
}

describe("Forward", () => {
  it("sends a copy marked Forwarded to people and chats, once per chat, with the normal push and realtime event", async () => {
    const [alice, bob, carol, dan] = [await signup(), await signup(), await signup(), await signup()];
    const source = await chat(alice, bob);
    const original = await send(source, bob, { body: "The ferry leaves at 7" });
    const reply = await send(source, alice, { body: "Noted", replyToMessageId: original.id });
    const withCarol = await chat(alice, carol);
    const g = await group(alice, [carol, dan]);
    const carolLive = await live(carol);

    // Dan doesn't follow Alice and has never talked to her: a first message to anyone is allowed,
    // as when opening a chat. Carol is named twice (as a person and by her chat): one message.
    const res = await forward(source, reply.id, alice, { userIds: [carol.id, dan.id], conversationIds: [withCarol, g] });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const results = res.body.results as Array<Record<string, string>>;
    assert.deepEqual(results.map((r) => [r.userId ?? r.conversationId, r.status]), [[carol.id, "sent"], [dan.id, "sent"], [withCarol, "sent"], [g, "sent"]]);
    assert.equal(results[0]!.conversationId, withCarol);
    assert.equal(results[0]!.messageId, results[2]!.messageId, "one message in Carol's chat");

    const copy = (await thread(withCarol, carol)).find((m) => m.id === results[0]!.messageId)!;
    assert.deepEqual([copy.body, copy.forwarded, copy.replyTo, copy.senderId], ["Noted", true, null, alice.id], "no reply quote travels with it");
    assert.equal((await thread(withCarol, carol)).length, 1);
    assert.equal((await thread(source, bob)).find((m) => m.id === original.id)!.forwarded, false, "ordinary messages say false");
    const danChat = results[1]!.conversationId!;
    assert.equal((await thread(danChat, dan))[0]!.body, "Noted");
    assert.equal((await thread(g, dan)).find((m) => m.id === results[3]!.messageId)!.forwarded, true);

    const pushes = await query(`SELECT user_id FROM push_outbox WHERE kind = 'message' AND actor_id = :'a' AND ref_id IN (:'c', :'d', :'g')`, { a: alice.id, c: withCarol, d: danChat, g });
    assert.deepEqual(pushes.map((p) => p.user_id).sort(), [carol.id, dan.id, carol.id, dan.id].sort(), "the same pushes as sending");
    const event = await carolLive.next("message");
    assert.ok([withCarol, g].includes(event.conversationId as string));
    carolLive.close();
  });

  it("only from a chat you're in, and only what you can see in it", async () => {
    const [alice, bob, eve, newcomer] = [await signup(), await signup(), await signup(), await signup()];
    const source = await chat(alice, bob);
    const m = await send(source, bob, { body: "private" });
    const target = { conversationIds: [await chat(eve, alice)] };
    assert.equal((await forward(source, m.id, eve, target)).status, 404, "not in the chat");
    assert.equal((await forward(source, randomUUID(), alice, target)).status, 404);
    assert.equal((await forward(source, "nope", alice, target)).status, 404);

    // A group's member sees (and forwards) only what came after they joined.
    const g = await group(alice, [bob, eve]);
    const before = await send(g, bob, { body: "before you joined" });
    await follow(newcomer, alice);
    assert.equal((await client.post(`/api/v1/conversations/${g}/members`, { usernames: [newcomer.username] }, as(alice))).status, 200);
    const own = await chat(newcomer, alice);
    assert.equal((await forward(g, before.id, newcomer, { conversationIds: [own] })).status, 404);
    // Deleted chat: what came before is gone for you, so it can't be forwarded either.
    assert.equal((await client.post(`/api/v1/conversations/${source}/hide`, undefined, as(alice))).status, 204);
    assert.equal((await forward(source, m.id, alice, { conversationIds: [own] })).status, 404);
    // A group's event line isn't a message to forward.
    const created = (await thread(g, alice)).find((x) => x.event?.type === "created")!;
    assert.equal((await forward(g, created.id, alice, { conversationIds: [own] })).status, 404);
  });

  it("each recipient gets the rules of a normal send: blocked, someone else's chat, yourself, nobody", async () => {
    const [alice, bob, carol, blocker, stranger] = [await signup(), await signup(), await signup(), await signup(), await signup()];
    const source = await chat(alice, bob);
    const m = await send(source, bob, { body: "pass it on" });
    const blockedChat = await chat(alice, blocker);
    await client.post(`/api/v1/users/${alice.username}/block`, undefined, as(blocker));
    const notMine = await chat(carol, stranger);
    const res = await forward(source, m.id, alice, { userIds: [blocker.id, alice.id, randomUUID(), carol.id], conversationIds: [blockedChat, notMine] });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual((res.body.results as Array<Record<string, string>>).map((r) => r.status), ["not_allowed", "not_allowed", "not_allowed", "sent", "not_allowed", "not_allowed"]);
    assert.ok(!("conversationId" in res.body.results[0]), "no chat id for a refused recipient");
    assert.equal(Number((await queryOne(`SELECT count(*) AS n FROM messages WHERE conversation_id IN (:'a', :'b')`, { a: blockedChat, b: notMine }))!.n), 0);

    // A restricted account can still write in chats it has, but not start new ones (assertCanContribute).
    await query(`UPDATE users SET moderation_state = 'RESTRICTED' WHERE id = :'id'`, { id: alice.id });
    const fresh = await signup();
    const restricted = await forward(source, m.id, alice, { userIds: [fresh.id, carol.id] });
    assert.deepEqual(restricted.body.results.map((r: { status: string }) => r.status), ["not_allowed", "sent"]);
    await query(`UPDATE users SET moderation_state = 'ACTIVE' WHERE id = :'id'`, { id: alice.id });

    for (const body of [{}, { userIds: [] }, { userIds: ["x"] }, { conversationIds: Array.from({ length: 11 }, () => randomUUID()) }]) {
      assert.equal((await forward(source, m.id, alice, body)).status, 422, JSON.stringify(body));
    }
  });

  it("a forwarded photo opens for the people it reached, through the normal media route", async () => {
    const [alice, bob, carol, outsider] = [await signup(), await signup(), await signup(), await signup()];
    const source = await chat(bob, alice);
    const mediaId = await photo(bob);
    const m = await send(source, bob, { mediaId });
    assert.equal((await client.get(`/api/v1/media/${mediaId}`, as(carol))).status, 404);
    const res = await forward(source, m.id, alice, { userIds: [carol.id] });
    assert.equal(res.body.results[0].status, "sent", JSON.stringify(res.body));
    const copy = (await thread(res.body.results[0].conversationId, carol))[0]!;
    assert.deepEqual([copy.media.id, copy.media.kind, copy.forwarded], [mediaId, "photo", true]);
    assert.equal((await client.get(`/api/v1/media/${mediaId}`, as(carol))).status, 200);
    assert.equal((await fetch(`http://${host}/api/v1/media/${mediaId}/file`, { headers: as(carol) })).status, 200);
    assert.equal((await client.get(`/api/v1/media/${mediaId}`, as(outsider))).status, 404);

    // In a group too: every member who can see the message can open its photo.
    const dan = await signup();
    const g = await group(alice, [carol, dan]);
    await forward(source, m.id, alice, { conversationIds: [g] });
    assert.equal((await client.get(`/api/v1/media/${mediaId}`, as(dan))).status, 200);
    // Someone who left the group can't any more.
    await client.post(`/api/v1/conversations/${g}/leave`, undefined, as(dan));
    assert.equal((await client.get(`/api/v1/media/${mediaId}`, as(dan))).status, 404);

    // Bob unsends his photo: Carol's forwarded copy is a message of its own and keeps it.
    assert.equal((await client.delete(`/api/v1/conversations/${source}/messages/${m.id}`, as(bob))).status, 204);
    assert.equal((await client.get(`/api/v1/media/${mediaId}`, as(carol))).status, 200);
  });

  it("never an ID photo, and never media that's gone", async () => {
    const [alice, bob, carol] = [await signup(), await signup(), await signup()];
    const source = await chat(bob, alice);
    const idPhoto = await photo(bob);
    const m = await send(source, bob, { mediaId: idPhoto });
    await query(`UPDATE media SET verification_document = true WHERE id = :'id'`, { id: idPhoto });
    assert.equal((await forward(source, m.id, alice, { userIds: [carol.id] })).status, 422);
    const gone = await photo(bob);
    const g2 = await send(source, bob, { mediaId: gone, body: "caption" });
    await query(`UPDATE media SET purged_at = now() WHERE id = :'id'`, { id: gone });
    assert.equal((await forward(source, g2.id, alice, { userIds: [carol.id] })).status, 422);
    assert.equal(Number((await queryOne(`SELECT count(*) AS n FROM messages WHERE forwarded AND sender_id = :'a'`, { a: alice.id }))!.n), 0);
  });

  it("a shared Story goes on as the share, still under the Story's own rules", async () => {
    const [owner, alice, bob, carol] = [await signup(), await signup(), await signup(), await signup()];
    const story = await client.post("/api/v1/stories", { mediaId: await photo(owner), caption: "sunset", audience: "public", allowComments: "everyone", allowSharing: true }, as(owner));
    assert.equal(story.status, 201, JSON.stringify(story.body));
    const source = await chat(bob, alice);
    const m = await send(source, bob, { storyId: story.body.story.id });
    const res = await forward(source, m.id, alice, { userIds: [carol.id] });
    const copy = (await thread(res.body.results[0].conversationId, carol))[0]!;
    assert.deepEqual([copy.sharedStoryId, copy.sharedStory.ownerUsername, copy.forwarded], [story.body.story.id, owner.username, true]);
    // Once its owner turns sharing off, it can't be passed on any more.
    await query(`UPDATE stories SET allow_sharing = false WHERE id = :'id'`, { id: story.body.story.id });
    assert.equal((await forward(source, m.id, alice, { userIds: [carol.id] })).status, 403);
  });
});

describe("Pins", () => {
  const pin = (c: string, m: string, p: Person) => client.put(`/api/v1/conversations/${c}/pins/${m}`, undefined, as(p));
  const unpin = (c: string, m: string, p: Person) => client.delete(`/api/v1/conversations/${c}/pins/${m}`, as(p));
  const pins = async (c: string, p: Person) => (await client.get(`/api/v1/conversations/${c}/pins`, as(p))).body.pins as Array<Record<string, any>>;

  it("anyone in the chat pins up to three; a fourth is a 409 the app can offer a way out of", async () => {
    const [alice, bob] = [await signup(), await signup()];
    const c = await chat(alice, bob);
    const ms = [];
    for (const body of ["one", "two", "three", "four"]) ms.push(await send(c, alice, { body }));
    const bobLive = await live(bob);
    assert.equal((await pin(c, ms[0]!.id, alice)).status, 204);
    assert.deepEqual(await bobLive.next("pins_changed"), { type: "pins_changed", conversationId: c });
    assert.equal((await pin(c, ms[1]!.id, bob)).status, 204);
    assert.equal((await pin(c, ms[2]!.id, alice)).status, 204);
    assert.equal((await pin(c, ms[2]!.id, alice)).status, 204, "pinning it again changes nothing");
    const full = await pin(c, ms[3]!.id, bob);
    assert.deepEqual([full.status, full.body.code], [409, "too_many_pins"]);

    const list = await pins(c, bob);
    assert.deepEqual(list.map((p) => p.message.body), ["three", "two", "one"], "latest pin first");
    assert.deepEqual(list[1]!.pinnedBy, { id: bob.id, username: bob.username });
    assert.equal(list[0]!.messageId, ms[2]!.id);
    assert.ok(!("clientMessageId" in list[0]!.message));

    // Replace oldest: unpin it, then pin.
    assert.equal((await unpin(c, ms[0]!.id, bob)).status, 204);
    assert.equal((await pin(c, ms[3]!.id, bob)).status, 204);
    assert.deepEqual((await pins(c, alice)).map((p) => p.message.body), ["four", "three", "two"]);
    bobLive.events.length = 0;
    // Unsending a pinned message takes its pin with it.
    assert.equal((await client.delete(`/api/v1/conversations/${c}/messages/${ms[2]!.id}`, as(alice))).status, 204);
    assert.deepEqual((await pins(c, alice)).map((p) => p.message.body), ["four", "two"]);
    assert.equal((await bobLive.next("unsent")).messageId, ms[2]!.id, "open chats hear of it and refresh their pins");
    bobLive.close();
  });

  it("only for people in the chat, and only messages they can see", async () => {
    const [alice, bob, carol, newcomer] = [await signup(), await signup(), await signup(), await signup()];
    const c = await chat(alice, bob);
    const m = await send(c, bob, { body: "secret plan" });
    assert.equal((await pin(c, m.id, carol)).status, 404);
    assert.equal((await client.get(`/api/v1/conversations/${c}/pins`, as(carol))).status, 404);
    assert.equal((await unpin(c, m.id, carol)).status, 404);
    assert.equal((await pin(c, randomUUID(), alice)).status, 404);

    const g = await group(alice, [bob, carol]);
    const early = await send(g, bob, { body: "before you joined" });
    assert.equal((await pin(g, early.id, alice)).status, 204);
    const created = (await thread(g, alice)).find((x) => x.event?.type === "created")!;
    assert.equal((await pin(g, created.id, alice)).status, 404, "never a group's event line");
    await follow(newcomer, alice);
    await client.post(`/api/v1/conversations/${g}/members`, { usernames: [newcomer.username] }, as(alice));
    assert.deepEqual(await pins(g, newcomer), [], "a pin from before you joined isn't yours to see");
    assert.equal((await pin(g, early.id, newcomer)).status, 404);
    assert.equal((await unpin(g, early.id, newcomer)).status, 204, "nothing to unpin that you can see");
    assert.equal((await pins(g, carol)).length, 1, "and it stays pinned for everyone else");
    const later = await send(g, carol, { body: "after" });
    assert.equal((await pin(g, later.id, newcomer)).status, 204);
    assert.deepEqual((await pins(g, newcomer)).map((p) => p.message.body), ["after"]);

    // Deleted chat: earlier pins go out of sight with what came before.
    assert.equal((await pin(c, m.id, alice)).status, 204);
    await client.post(`/api/v1/conversations/${c}/hide`, undefined, as(alice));
    assert.deepEqual(await pins(c, alice), []);
    assert.equal((await pins(c, bob)).length, 1);
  });

  it("the limit holds when several people pin at once", async () => {
    const [alice, bob] = [await signup(), await signup()];
    const c = await chat(alice, bob);
    const ms = [];
    for (let i = 0; i < 6; i++) ms.push(await send(c, i % 2 ? bob : alice, { body: `m${i}` }));
    const statuses = await Promise.all(ms.map((m, i) => pin(c, m.id, i % 2 ? bob : alice)));
    assert.equal(statuses.filter((s) => s.status === 204).length, 3);
    assert.equal(statuses.filter((s) => s.status === 409).length, 3);
    assert.equal(Number((await queryOne(`SELECT count(*) AS n FROM conversation_pins WHERE conversation_id = :'c'`, { c }))!.n), 3);
  });
});
