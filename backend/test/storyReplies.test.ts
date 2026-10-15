import "./env";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { buildApp } from "../src/app";
import { query } from "../src/db/psql";
import { authHeader, makeClient, uniqueUser } from "./helpers";
import { buildTestPng } from "./fixtures";

let client: ReturnType<typeof makeClient>;
let baseUrl: string;
const server = buildApp();

before(async () => {
  await new Promise<void>((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  client = makeClient(baseUrl);
});
after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function signupUser() {
  const input = uniqueUser();
  const res = await client.post("/api/v1/auth/signup", input);
  return { username: input.username, token: res.body.tokens.accessToken as string, id: res.body.user.id as string };
}

async function publishStory(token: string, overrides: Record<string, unknown> = {}): Promise<string> {
  const upload = await fetch(`${baseUrl}/api/v1/media/photos`, { method: "POST", headers: { "Content-Type": "image/png", ...authHeader(token) }, body: buildTestPng(4, 4) });
  const mediaId = ((await upload.json()) as { media: { id: string } }).media.id;
  const res = await client.post("/api/v1/stories", { mediaId, caption: "", audience: "public", allowComments: "everyone", allowSharing: true, ...overrides }, authHeader(token));
  return res.body.story.id as string;
}

const reply = (storyId: string, token: string, body: Record<string, unknown>) => client.post(`/api/v1/stories/${storyId}/replies`, body, authHeader(token));
const clientId = () => `reply_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;

describe("Story replies and reactions", () => {
  it("delivers a written reply and a quick reaction to the owner's DMs, linked to the Story", async () => {
    const owner = await signupUser();
    const viewer = await signupUser();
    const storyId = await publishStory(owner.token);

    const written = await reply(storyId, viewer.token, { body: "  Love this view!  " });
    assert.equal(written.status, 201, JSON.stringify(written.body));
    assert.equal(written.body.message.body, "Love this view!");
    assert.deepEqual(written.body.message.storyReply, { storyId, kind: "reply" });

    const reacted = await reply(storyId, viewer.token, { reaction: "🔥" });
    assert.equal(reacted.status, 201);
    assert.equal(reacted.body.conversationId, written.body.conversationId, "same conversation");
    assert.deepEqual([reacted.body.message.body, reacted.body.message.storyReply], ["🔥", { storyId, kind: "reaction" }]);

    // The owner sees both in their conversation with the viewer, and gets a push for each.
    const thread = await client.get(`/api/v1/conversations/${written.body.conversationId}/messages`, authHeader(owner.token));
    assert.equal(thread.status, 200);
    const replies = thread.body.messages.filter((m: { storyReply: unknown }) => m.storyReply);
    assert.equal(replies.length, 2);
    const pushes = await query(`SELECT kind FROM push_outbox WHERE user_id = :'owner'`, { owner: owner.id });
    assert.equal(pushes.filter((p) => p.kind === "message").length, 2);
  });

  it("is idempotent for a retried send with the same client id", async () => {
    const owner = await signupUser();
    const viewer = await signupUser();
    const storyId = await publishStory(owner.token);
    const id = clientId();
    const first = await reply(storyId, viewer.token, { reaction: "😂", clientMessageId: id });
    const again = await reply(storyId, viewer.token, { reaction: "😂", clientMessageId: id });
    assert.deepEqual([first.status, again.status], [201, 200]);
    assert.equal(again.body.message.id, first.body.message.id);
    const different = await reply(storyId, viewer.token, { reaction: "😮", clientMessageId: id });
    assert.equal(different.status, 409);
  });

  it("only lets someone who can see the Story reply, never its owner, and never across a block", async () => {
    const owner = await signupUser();
    const stranger = await signupUser();
    const followersOnly = await publishStory(owner.token, { audience: "followers" });
    assert.equal((await reply(followersOnly, stranger.token, { body: "hi" })).status, 404);

    const publicStory = await publishStory(owner.token);
    assert.equal((await reply(publicStory, owner.token, { body: "me" })).status, 400);

    await client.post(`/api/v1/users/${stranger.username}/block`, undefined, authHeader(owner.token));
    assert.equal((await reply(publicStory, stranger.token, { body: "hi" })).status, 404);
  });

  it("validates the reply: text or one of the quick reactions, not both, not empty", async () => {
    const owner = await signupUser();
    const viewer = await signupUser();
    const storyId = await publishStory(owner.token);
    for (const body of [{}, { body: "   " }, { reaction: "🦄" }, { body: "hi", reaction: "🔥" }, { body: "x".repeat(2001) }]) {
      const res = await reply(storyId, viewer.token, body);
      assert.equal(res.status, 422, JSON.stringify(body));
    }
  });

  it("keeps the reply when the Story is deleted, without a link to it", async () => {
    const owner = await signupUser();
    const viewer = await signupUser();
    const storyId = await publishStory(owner.token);
    const sent = await reply(storyId, viewer.token, { body: "Nice" });
    await query(`DELETE FROM stories WHERE id = :'id'`, { id: storyId });
    const thread = await client.get(`/api/v1/conversations/${sent.body.conversationId}/messages`, authHeader(viewer.token));
    const message = thread.body.messages.find((m: { id: string }) => m.id === sent.body.message.id);
    assert.deepEqual(message.storyReply, { storyId: null, kind: "reply" });
  });
});
