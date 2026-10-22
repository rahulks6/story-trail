import "./env";
import { after, before, it } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { buildApp } from "../src/app";
import { authHeader, makeClient, uniqueUser } from "./helpers";
import { query } from "../src/db/psql";

// Swipe a direct message to reply to it, like Instagram: the reply quotes the message.
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
  const message = (await client.post(`/api/v1/conversations/${conversationId}/messages`, { body: "Dinner at 8? " + "x".repeat(300) }, authHeader(alice.token))).body.message;
  return { alice, bob, conversationId, messageId: message.id as string };
}
const send = (conversationId: string, token: string, input: Record<string, unknown>) =>
  client.post(`/api/v1/conversations/${conversationId}/messages`, input, authHeader(token));

it("a reply quotes the start of the message it answers, in the response and in the thread", async () => {
  const t = await thread();
  const reply = await send(t.conversationId, t.bob.token, { body: "Yes!", replyToMessageId: t.messageId });
  assert.equal(reply.status, 201, JSON.stringify(reply.body));
  const quote = reply.body.message.replyTo;
  assert.deepEqual([quote.id, quote.senderId, quote.mediaKind, quote.sharedStory], [t.messageId, t.alice.id, null, false]);
  assert.equal(quote.body, ("Dinner at 8? " + "x".repeat(300)).slice(0, 160));
  const list = await client.get(`/api/v1/conversations/${t.conversationId}/messages`, authHeader(t.alice.token));
  const shown = list.body.messages.find((m: { id: string }) => m.id === reply.body.message.id);
  assert.deepEqual(shown.replyTo, quote);
  const plain = list.body.messages.find((m: { id: string }) => m.id === t.messageId);
  assert.equal(plain.replyTo, null);
});

it("a retried reply is the same message; the quote goes when the original does", async () => {
  const t = await thread();
  const input = { body: "On my way", replyToMessageId: t.messageId, clientMessageId: "reply-retry-0000000001" };
  const first = await send(t.conversationId, t.bob.token, input);
  const again = await send(t.conversationId, t.bob.token, input);
  assert.deepEqual([first.status, again.status, again.body.message.id], [201, 200, first.body.message.id]);
  await query(`DELETE FROM messages WHERE id = :'id'`, { id: t.messageId });
  const list = await client.get(`/api/v1/conversations/${t.conversationId}/messages`, authHeader(t.bob.token));
  assert.deepEqual(list.body.messages.map((m: { body: string; replyTo: unknown }) => [m.body, m.replyTo]), [["On my way", null]]);
  assert.equal((await send(t.conversationId, t.bob.token, input)).status, 200, "a retry after the original went is still the same message");
});

it("only a message in the same conversation can be quoted", async () => {
  const t = await thread();
  const other = await thread();
  const elsewhere = await send(t.conversationId, t.bob.token, { body: "hm", replyToMessageId: other.messageId });
  assert.equal(elsewhere.status, 422);
  assert.ok(!JSON.stringify(elsewhere.body).includes("Dinner"), "nothing of the other conversation leaks");
  assert.equal((await send(t.conversationId, t.bob.token, { body: "hm", replyToMessageId: "nope" })).status, 422);
  assert.equal((await send(t.conversationId, t.bob.token, { replyToMessageId: t.messageId })).status, 422, "a reply still needs something to say");
});
