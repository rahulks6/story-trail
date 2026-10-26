import "./env";
import { after, before, it } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { buildApp } from "../src/app";
import { authHeader, makeClient, uniqueUser } from "./helpers";
import { query } from "../src/db/psql";

// Group chats: 3 to 32 people, admins, adding people you're connected to, history from when you joined.
let client: ReturnType<typeof makeClient>;
const server = buildApp();
before(async () => {
  await new Promise<void>((resolve) => server.listen(0, resolve));
  client = makeClient(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
});
after(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); });

type Person = { username: string; token: string; id: string };
async function signup(): Promise<Person> {
  const input = uniqueUser();
  const res = await client.post("/api/v1/auth/signup", input);
  return { username: input.username, token: res.body.tokens.accessToken as string, id: res.body.user.id as string };
}
const follow = (who: Person, whom: Person) => client.post(`/api/v1/users/${whom.username}/follow`, undefined, authHeader(who.token));
const as = (p: Person) => authHeader(p.token);

/** Alice with friends who follow her. */
async function crew(n: number): Promise<Person[] & Record<0 | 1 | 2 | 3, Person>> {
  const alice = await signup();
  const friends: Person[] = [];
  for (let i = 0; i < n; i++) { const f = await signup(); await follow(f, alice); friends.push(f); }
  return [alice, ...friends] as unknown as Person[] & Record<0 | 1 | 2 | 3, Person>;
}
async function group(owner: Person, members: Person[], title: string | null = "Goa trip") {
  const res = await client.post("/api/v1/conversations/groups", { usernames: members.map((m) => m.username), ...(title ? { title } : {}) }, as(owner));
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.conversation as { id: string; title: string | null; role: string; members: Array<{ userId: string; role: string }> };
}
const messages = (id: string, p: Person) => client.get(`/api/v1/conversations/${id}/messages`, as(p));
const send = (id: string, p: Person, body: string) => client.post(`/api/v1/conversations/${id}/messages`, { body }, as(p));

it("a group starts with its maker as admin, says so in the thread, and every member hears every message", async () => {
  const [alice, bob, carol] = await crew(2);
  const g = await group(alice, [bob, carol]);
  assert.equal(g.title, "Goa trip");
  assert.equal(g.role, "admin");
  assert.deepEqual(g.members[0], { ...g.members[0], userId: alice.id, role: "admin" }, "admins first");
  assert.deepEqual(g.members.slice(1).map((m) => [m.userId, m.role]).sort(), [[bob.id, "member"], [carol.id, "member"]].sort());
  assert.deepEqual((await messages(g.id, carol)).body.messages.map((m: { event: unknown }) => m.event), [{ type: "created", title: "Goa trip" }]);

  assert.equal((await send(g.id, bob, "Booking the villa?")).status, 201);
  const pushes = await query(`SELECT user_id, body, link FROM push_outbox WHERE kind = 'message' AND ref_id = :'c' ORDER BY user_id`, { c: g.id });
  assert.deepEqual(pushes.map((p) => p.user_id).sort(), [alice.id, carol.id].sort(), "everyone but the sender");
  assert.equal(pushes[0]!.body, `@${bob.username} sent a message in Goa trip`);
  assert.equal(pushes[0]!.link, `katkee://conversation/${g.id}`);
  assert.equal((await messages(g.id, carol)).body.messages[0].body, "Booking the villa?");
});

it("Seen means everyone has read it; Seen by lists who has so far", async () => {
  const [alice, bob, carol] = await crew(2);
  const g = await group(alice, [bob, carol]);
  await send(g.id, alice, "Dinner at 8");
  await client.post(`/api/v1/conversations/${g.id}/read`, undefined, as(bob));
  let mine = (await messages(g.id, alice)).body.messages.find((m: { body: string }) => m.body === "Dinner at 8");
  assert.deepEqual([mine.status === "read", mine.seenBy], [false, [bob.id]]);
  await client.post(`/api/v1/conversations/${g.id}/read`, undefined, as(carol));
  mine = (await messages(g.id, alice)).body.messages.find((m: { body: string }) => m.body === "Dinner at 8");
  assert.deepEqual([mine.status, mine.seenBy.sort()], ["read", [bob.id, carol.id].sort()]);
});

it("only people you're connected to, never someone blocked; 3 to 32 people", async () => {
  const [alice, bob, carol] = await crew(2);
  const stranger = await signup();
  const refused = await client.post("/api/v1/conversations/groups", { usernames: [bob.username, stranger.username] }, as(alice));
  assert.equal(refused.status, 422);
  assert.match(refused.body.message, new RegExp(`@${stranger.username} isn't connected to you`));
  await follow(alice, stranger); // following them is enough
  assert.equal((await client.post("/api/v1/conversations/groups", { usernames: [bob.username, stranger.username] }, as(alice))).status, 201);
  await client.post(`/api/v1/users/${alice.username}/block`, undefined, as(carol));
  assert.equal((await client.post("/api/v1/conversations/groups", { usernames: [bob.username, carol.username] }, as(alice))).status, 422, "blocked");
  assert.equal((await client.post("/api/v1/conversations/groups", { usernames: [bob.username] }, as(alice))).status, 422, "two people is a chat, not a group");
  assert.equal((await client.post("/api/v1/conversations/groups", { usernames: [bob.username, "nobody_here_x"] }, as(alice))).status, 422);
  const many = Array.from({ length: 32 }, (_, i) => `someone${i}`);
  assert.equal((await client.post("/api/v1/conversations/groups", { usernames: many }, as(alice))).status, 422);
  assert.equal((await client.post("/api/v1/conversations/groups", { usernames: [bob.username, stranger.username], title: "x".repeat(61) }, as(alice))).status, 422);
});

it("an older app never sees a group; this one sees its name, size and faces", async () => {
  const [alice, bob, carol] = await crew(2);
  const g = await group(alice, [bob, carol]);
  await send(g.id, carol, "hi all");
  const old = await client.get("/api/v1/conversations", as(bob));
  assert.ok(!old.body.conversations.some((c: { id: string }) => c.id === g.id));
  assert.equal((await client.get(`/api/v1/conversations/${g.id}`, as(bob))).status, 404);
  const now = await client.get("/api/v1/conversations?groups=1", as(bob));
  const row = now.body.conversations.find((c: { id: string }) => c.id === g.id);
  assert.deepEqual([row.kind, row.otherUser, row.group.title, row.group.memberCount], ["group", null, "Goa trip", 3]);
  assert.deepEqual(row.group.members.map((m: { username: string }) => m.username).sort(), [alice.username, carol.username].sort());
  assert.deepEqual([row.lastMessage.body, row.lastMessage.senderUsername, row.unread], ["hi all", carol.username, true]);
  assert.equal((await client.get(`/api/v1/conversations?groups=1&q=goa`, as(bob))).body.conversations.length, 1, "found by its name");
  assert.equal((await client.get("/api/v1/conversations/unread-count", as(bob))).body.count, 1);
});

it("your own group lines (made it, added someone, renamed it) don't make the chat unread for you", async () => {
  const [alice, bob, carol, dave] = await crew(3);
  const unread = async (p: Person) => (await client.get("/api/v1/conversations?groups=1", as(p))).body.conversations.find((c: { id: string }) => c.id === g.id).unread;
  const g = await group(alice, [bob, carol]);
  assert.equal(await unread(alice), false, "the maker");
  assert.equal(await unread(bob), true, "the others are told");
  await client.post(`/api/v1/conversations/${g.id}/read`, undefined, as(bob));
  assert.equal((await client.patch(`/api/v1/conversations/${g.id}`, { title: "Weekend" }, as(bob))).status, 200);
  assert.equal(await unread(bob), false, "the one who renamed it");
  assert.equal((await client.post(`/api/v1/conversations/${g.id}/members`, { usernames: [dave.username] }, as(alice))).status, 200);
  assert.equal(await unread(alice), false, "the one who added someone");
  assert.equal((await client.get("/api/v1/conversations/unread-count", as(alice))).body.count, 0);
  assert.equal(await unread(carol), true);
});

it("someone added later sees what's said from then on; removed or gone, they see nothing more", async () => {
  const [alice, bob, carol, dave] = await crew(3);
  const g = await group(alice, [bob, carol]);
  await send(g.id, bob, "before dave");
  const added = await client.post(`/api/v1/conversations/${g.id}/members`, { usernames: [dave.username] }, as(alice));
  assert.equal(added.status, 200, JSON.stringify(added.body));
  await send(g.id, bob, "after dave");
  const seen = (await messages(g.id, dave)).body.messages;
  assert.deepEqual(seen.map((m: { body: string | null; event: { type: string } | null }) => m.body ?? m.event!.type), ["after dave", "added"]);

  assert.equal((await client.delete(`/api/v1/conversations/${g.id}/members/${carol.id}`, as(bob))).status, 403, "only admins remove people");
  assert.equal((await client.delete(`/api/v1/conversations/${g.id}/members/${carol.id}`, as(alice))).status, 200);
  assert.equal((await messages(g.id, carol)).status, 404);
  assert.equal((await send(g.id, carol, "let me back")).status, 404);
  await send(g.id, bob, "carol's gone");
  assert.equal(Number((await query(`SELECT count(*) AS n FROM push_outbox WHERE kind = 'message' AND ref_id = :'c' AND user_id = :'u' AND created_at > now() - interval '1 minute' AND body LIKE '%carol%'`, { c: g.id, u: carol.id }))[0]!.n), 0);

  // The admin leaves: whoever has been there longest looks after the group now.
  assert.equal((await client.post(`/api/v1/conversations/${g.id}/leave`, undefined, as(alice))).status, 204);
  const left = (await client.get(`/api/v1/conversations/${g.id}?groups=1`, as(bob))).body.conversation;
  assert.deepEqual(left.members.map((m: { userId: string; role: string }) => [m.userId, m.role]), [[bob.id, "admin"], [dave.id, "member"]]);
  assert.equal((await client.get(`/api/v1/conversations?groups=1`, as(alice))).body.conversations.some((c: { id: string }) => c.id === g.id), false);
});

it("anyone renames it; reports, reactions and replies work on others' messages", async () => {
  const [alice, bob, carol] = await crew(2);
  const g = await group(alice, [bob, carol], null);
  const renamed = await client.patch(`/api/v1/conversations/${g.id}`, { title: "  Weekend  plans " }, as(carol));
  assert.equal(renamed.body.conversation.title, "Weekend plans");
  const sent = (await send(g.id, bob, "rude thing")).body.message;
  assert.equal((await client.put(`/api/v1/conversations/${g.id}/messages/${sent.id}/reaction`, { emoji: "😂" }, as(carol))).status, 200);
  assert.equal((await client.post(`/api/v1/conversations/${g.id}/messages`, { body: "what?", replyToMessageId: sent.id }, as(alice))).body.message.replyTo.id, sent.id);
  assert.equal((await client.post(`/api/v1/conversations/${g.id}/report`, { messageId: sent.id, reason: "harassment" }, as(carol))).status, 201);
  assert.equal((await client.post(`/api/v1/conversations/${g.id}/report`, { messageId: sent.id, reason: "harassment" }, as(bob))).status, 404, "not your own");
  const event = (await messages(g.id, alice)).body.messages.find((m: { event: { type: string } | null }) => m.event?.type === "renamed");
  assert.deepEqual(event.event, { type: "renamed", title: "Weekend plans" });
  assert.equal((await client.put(`/api/v1/conversations/${g.id}/messages/${event.id}/reaction`, { emoji: "😂" }, as(carol))).status, 404, "not on an event line");
});

it("1:1 conversations still work exactly as before", async () => {
  const [alice, bob] = await crew(1);
  const c = (await client.post(`/api/v1/users/${bob.username}/conversation`, undefined, as(alice))).body.conversation;
  await send(c.id, alice, "hey");
  const list = (await client.get("/api/v1/conversations", as(bob))).body.conversations;
  assert.deepEqual([list[0].kind, list[0].otherUser.username, list[0].lastMessage.body], ["direct", alice.username, "hey"]);
  assert.equal((await client.get(`/api/v1/conversations/${c.id}`, as(bob))).body.conversation.otherUser.username, alice.username);
  assert.equal((await client.post(`/api/v1/conversations/${c.id}/leave`, undefined, as(bob))).status, 404, "you can't leave a 1:1 chat");
});
