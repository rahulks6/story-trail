import "./env";
import { after, before, it } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { buildApp } from "../src/app";
import { authHeader, makeClient, uniqueUser } from "./helpers";
import { query } from "../src/db/psql";
import { buildTestPng } from "./fixtures";

// Unsend, mute, delete chat, and a shared Story shown as a card.
let client: ReturnType<typeof makeClient>;
let base = "";
const server = buildApp();
before(async () => {
  await new Promise<void>((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  client = makeClient(base);
});
after(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); });

async function signup() {
  const input = uniqueUser();
  const res = await client.post("/api/v1/auth/signup", input);
  return { username: input.username, token: res.body.tokens.accessToken as string, id: res.body.user.id as string };
}
async function chat() {
  const a = await signup(), b = await signup();
  const c = (await client.post(`/api/v1/users/${b.username}/conversation`, undefined, authHeader(a.token))).body.conversation.id as string;
  return { a, b, c };
}
const send = (c: string, token: string, body: string) => client.post(`/api/v1/conversations/${c}/messages`, { body }, authHeader(token));
const bodies = async (c: string, token: string) => (await client.get(`/api/v1/conversations/${c}/messages`, authHeader(token))).body.messages.map((m: { body: string }) => m.body);

it("unsend takes your own message away for everyone, never someone else's", async () => {
  const { a, b, c } = await chat();
  const mine = (await send(c, a.token, "oops wrong chat")).body.message.id as string;
  const theirs = (await send(c, b.token, "hi")).body.message.id as string;
  await client.put(`/api/v1/conversations/${c}/messages/${mine}/reaction`, { emoji: "😂" }, authHeader(b.token));
  const reply = (await client.post(`/api/v1/conversations/${c}/messages`, { body: "what?", replyToMessageId: mine }, authHeader(b.token))).body.message.id as string;
  assert.equal((await client.delete(`/api/v1/conversations/${c}/messages/${theirs}`, authHeader(a.token))).status, 404);
  assert.equal((await client.delete(`/api/v1/conversations/${c}/messages/${mine}`, authHeader(b.token))).status, 404);
  assert.equal((await client.delete(`/api/v1/conversations/${c}/messages/${mine}`, authHeader(a.token))).status, 204);
  assert.deepEqual(await bodies(c, b.token), ["what?", "hi"]);
  const quoted = (await client.get(`/api/v1/conversations/${c}/messages`, authHeader(b.token))).body.messages.find((m: { id: string }) => m.id === reply);
  assert.equal(quoted.replyTo, null, "the reply stays; its quote goes");
});

it("muting stops pushes for you alone; it shows in the inbox", async () => {
  const { a, b, c } = await chat();
  assert.equal((await client.put(`/api/v1/conversations/${c}/mute`, { muted: true }, authHeader(b.token))).status, 204);
  await send(c, a.token, "are you there");
  await send(c, b.token, "yes");
  const pushes = await query(`SELECT user_id FROM push_outbox WHERE kind = 'message' AND ref_id = :'c'`, { c });
  assert.deepEqual(pushes.map((p) => p.user_id), [a.id], "Bob muted it: only Alice is told");
  const row = (await client.get("/api/v1/conversations", authHeader(b.token))).body.conversations.find((x: { id: string }) => x.id === c);
  assert.deepEqual([row.muted, row.unread], [true, false]);
  assert.equal((await client.get(`/api/v1/conversations/${c}`, authHeader(b.token))).body.conversation.muted, true);
  assert.equal((await client.put(`/api/v1/conversations/${c}/mute`, { muted: "yes" }, authHeader(b.token))).status, 422);
  await client.put(`/api/v1/conversations/${c}/mute`, { muted: false }, authHeader(b.token));
  await send(c, a.token, "back?");
  assert.equal((await query(`SELECT count(*) AS n FROM push_outbox WHERE kind = 'message' AND ref_id = :'c' AND user_id = :'u'`, { c, u: b.id }))[0]!.n, "1");
});

it("delete chat clears it for you only, until a new message brings it back", async () => {
  const { a, b, c } = await chat();
  await send(c, a.token, "old news");
  assert.equal((await client.post(`/api/v1/conversations/${c}/hide`, undefined, authHeader(b.token))).status, 204);
  assert.ok(!(await client.get("/api/v1/conversations", authHeader(b.token))).body.conversations.some((x: { id: string }) => x.id === c));
  assert.deepEqual(await bodies(c, b.token), []);
  assert.deepEqual(await bodies(c, a.token), ["old news"], "nothing changes for the other person");
  assert.equal((await client.get("/api/v1/conversations/unread-count", authHeader(b.token))).body.count, 0);
  await new Promise((r) => setTimeout(r, 20));
  await send(c, a.token, "new news");
  const back = (await client.get("/api/v1/conversations", authHeader(b.token))).body.conversations.find((x: { id: string }) => x.id === c);
  assert.equal(back.lastMessage.body, "new news");
  assert.deepEqual(await bodies(c, b.token), ["new news"]);
});

it("a shared Story arrives as a card: whose it is and whether it's still up", async () => {
  const { a, b, c } = await chat();
  const up = await fetch(base + "/api/v1/media/photos", { method: "POST", headers: { Authorization: `Bearer ${b.token}`, "Content-Type": "image/png" }, body: buildTestPng(8, 8) });
  const mediaId = ((await up.json()) as { media: { id: string } }).media.id;
  const story = (await client.post("/api/v1/stories", { mediaId, caption: "", audience: "public", allowComments: "everyone", allowSharing: true, requestId: `card_${Date.now()}` }, authHeader(b.token))).body;
  const storyId = (story.story?.id ?? story.id) as string;
  assert.ok(storyId, JSON.stringify(story));
  await client.post(`/api/v1/conversations/${c}/messages`, { storyId }, authHeader(a.token));
  const card = (await client.get(`/api/v1/conversations/${c}/messages`, authHeader(b.token))).body.messages[0].sharedStory;
  assert.deepEqual([card.ownerUsername, card.active, card.mediaId], [b.username, true, mediaId]);
  await query(`UPDATE stories SET expires_at = now() - interval '1 minute' WHERE id = :'s'`, { s: storyId });
  const gone = (await client.get(`/api/v1/conversations/${c}/messages`, authHeader(b.token))).body.messages[0].sharedStory;
  assert.deepEqual([gone.active, gone.mediaId], [false, null]);
});
