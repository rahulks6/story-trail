import "./env";
import { after, before, it } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { buildApp } from "../src/app";
import { authHeader, makeClient, uniqueUser } from "./helpers";
import { query } from "../src/db/psql";
import { renderPush } from "../src/modules/push/dispatcher";

// Long-press a direct message to react, like Instagram: one reaction each, changeable, removable.
let client: ReturnType<typeof makeClient>;
const server = buildApp();
before(async () => {
  await new Promise<void>((resolve) => server.listen(0, resolve));
  client = makeClient(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
});
after(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); });

async function signup() {
  const input = uniqueUser();
  const res = await client.post("/api/v1/auth/signup", input);
  return { username: input.username, token: res.body.tokens.accessToken as string, id: res.body.user.id as string };
}
async function thread() {
  const alice = await signup();
  const bob = await signup();
  const conversationId = (await client.post(`/api/v1/users/${bob.username}/conversation`, undefined, authHeader(alice.token))).body.conversation.id as string;
  const message = (await client.post(`/api/v1/conversations/${conversationId}/messages`, { body: "Happy Dussehra!" }, authHeader(alice.token))).body.message;
  return { alice, bob, conversationId, messageId: message.id as string };
}
const react = (t: { conversationId: string; messageId: string }, token: string, emoji: unknown) =>
  client.put(`/api/v1/conversations/${t.conversationId}/messages/${t.messageId}/reaction`, { emoji }, authHeader(token));

it("either person reacts once; reacting again changes it; removing clears it; the thread shows it", async () => {
  const t = await thread();
  const first = await react(t, t.bob.token, "❤️");
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.deepEqual(first.body.reactions, [{ userId: t.bob.id, emoji: "❤️" }]);
  assert.deepEqual((await react(t, t.bob.token, "😂")).body.reactions, [{ userId: t.bob.id, emoji: "😂" }], "changed, not added");
  await react(t, t.alice.token, "👍");
  const list = await client.get(`/api/v1/conversations/${t.conversationId}/messages`, authHeader(t.alice.token));
  const shown = list.body.messages.find((m: { id: string }) => m.id === t.messageId);
  assert.deepEqual(shown.reactions, [{ userId: t.bob.id, emoji: "😂" }, { userId: t.alice.id, emoji: "👍" }]);
  const removed = await client.delete(`/api/v1/conversations/${t.conversationId}/messages/${t.messageId}/reaction`, authHeader(t.bob.token));
  assert.deepEqual(removed.body.reactions, [{ userId: t.alice.id, emoji: "👍" }]);
});

it("the sender is told (unless message pushes are off), and never about their own reaction", async () => {
  const t = await thread();
  await react(t, t.bob.token, "❤️");
  await react(t, t.alice.token, "😮");
  const pushes = await query(`SELECT user_id, kind, actor_id, ref_id, body, link FROM push_outbox WHERE kind = 'message_reaction' AND ref_id = :'c'`, { c: t.conversationId });
  assert.equal(pushes.length, 1, "only Bob's reaction to Alice's message");
  assert.equal(pushes[0]!.user_id, t.alice.id);
  assert.equal(pushes[0]!.body, `@${t.bob.username} reacted ❤️ to your message`);
  const item = { id: "x", userId: t.alice.id, kind: "message_reaction", actorId: t.bob.id, refId: t.conversationId, attempts: 1, body: pushes[0]!.body ?? null, link: pushes[0]!.link ?? null };
  const rendered = await renderPush(item);
  assert.ok("message" in rendered && rendered.message.data.url === `katkee://conversation/${t.conversationId}` && rendered.message.channel === "messages");
  await client.patch("/api/v1/notifications/preferences", { messagesEnabled: false }, authHeader(t.alice.token));
  assert.deepEqual(await renderPush(item), { skip: "message pushes turned off" });
});

it("a heart without its emoji-style selector (U+FE0F) is the same heart, stored one way", async () => {
  const t = await thread();
  const bare = await react(t, t.bob.token, "❤");
  assert.equal(bare.status, 200, JSON.stringify(bare.body));
  assert.deepEqual(bare.body.reactions, [{ userId: t.bob.id, emoji: "❤️" }]);
  assert.deepEqual((await react(t, t.alice.token, "❤️")).body.reactions.map((r: { emoji: string }) => r.emoji), ["❤️", "❤️"], "both compare equal");
  assert.equal((await react(t, t.bob.token, "❤️❤️")).status, 422, "still only one of the six");
});

it("only the two people in the conversation, only its messages, only the six reactions", async () => {
  const t = await thread();
  const stranger = await signup();
  assert.equal((await react(t, stranger.token, "❤️")).status, 404);
  assert.equal((await react(t, t.bob.token, "🎃")).status, 422);
  assert.equal((await react(t, t.bob.token, 5)).status, 422);
  const other = await thread();
  assert.equal((await react({ conversationId: t.conversationId, messageId: other.messageId }, t.bob.token, "❤️")).status, 404, "a message from another conversation");
  assert.equal((await react({ conversationId: t.conversationId, messageId: "not-a-uuid" }, t.bob.token, "❤️")).status, 404);
  await client.post(`/api/v1/users/${t.alice.username}/block`, undefined, authHeader(t.bob.token));
  assert.equal((await react(t, t.bob.token, "❤️")).status, 404, "not across a block (reads as not found, like messaging)");
});
