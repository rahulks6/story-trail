// Replies to comments and likes on comments (stories/engagement.service.ts, migration 0085):
// a reply is filed under its top-level comment and tells the person answered; a comment's likes
// count once per person and tell its author once; deleting a comment takes its replies with it;
// and nobody can like a comment on a Story they can't see.
import "./env";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { buildApp } from "../src/app";
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

async function person() {
  const input = uniqueUser();
  const res = await client.post("/api/v1/auth/signup", input);
  return { username: input.username, id: res.body.user.id as string, auth: authHeader(res.body.tokens.accessToken as string) };
}
type Person = Awaited<ReturnType<typeof person>>;
async function story(owner: Person, audience = "public"): Promise<string> {
  const up = await fetch(`${baseUrl}/api/v1/media/photos`, { method: "POST", headers: { "Content-Type": "image/png", ...owner.auth }, body: buildTestPng(4, 4) });
  const mediaId = ((await up.json()) as { media: { id: string } }).media.id;
  const res = await client.post("/api/v1/stories", { mediaId, caption: "", audience, allowComments: "everyone", allowSharing: true }, owner.auth);
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.story.id as string;
}
async function comment(who: Person, storyId: string, body: string, replyTo?: string) {
  const res = await client.post(`/api/v1/stories/${storyId}/comments`, replyTo ? { body, replyTo } : { body }, who.auth);
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.comment as { id: string; parentId: string | null; likeCount: number; likedByMe: boolean };
}
async function list(who: Person, storyId: string) {
  const res = await client.get(`/api/v1/stories/${storyId}/comments`, who.auth);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body.comments as Array<{ id: string; body: string; parentId: string | null; likeCount: number; likedByMe: boolean; username: string }>;
}
async function notificationsOf(who: Person) {
  const res = await client.get("/api/v1/notifications", who.auth);
  return res.body.notifications as Array<{ type: string; actor: { username: string } | null; comment: { id: string; body: string } | null }>;
}

describe("replies to comments", () => {
  it("files a reply (and a reply to a reply) under the top-level comment, and tells who was answered", async () => {
    const [owner, asha, ravi] = [await person(), await person(), await person()];
    const storyId = await story(owner);
    const top = await comment(asha, storyId, "Where is this?");
    assert.equal(top.parentId, null);
    const reply = await comment(owner, storyId, `@${asha.username} Lonavala!`, top.id);
    assert.equal(reply.parentId, top.id);
    const nested = await comment(ravi, storyId, `@${owner.username} so jealous`, reply.id);
    assert.equal(nested.parentId, top.id, "a reply to a reply stays under the top-level comment");

    const all = await list(asha, storyId);
    assert.deepEqual(all.map((c) => [c.id, c.parentId]), [[top.id, null], [reply.id, top.id], [nested.id, top.id]]);

    const ashaHeard = await notificationsOf(asha);
    assert.ok(ashaHeard.some((n) => n.type === "comment_reply" && n.actor?.username === owner.username && n.comment?.id === reply.id), JSON.stringify(ashaHeard));
    const ownerHeard = await notificationsOf(owner);
    assert.ok(ownerHeard.some((n) => n.type === "comment_reply" && n.actor?.username === ravi.username), "the owner was answered by Ravi");
    assert.equal(ownerHeard.filter((n) => n.type === "comment" && n.actor?.username === ravi.username).length, 0, "told once, as a reply, not twice");
    assert.ok(ownerHeard.some((n) => n.type === "comment" && n.actor?.username === asha.username), "the owner still hears about top-level comments");
  });

  it("refuses a reply to a comment on another Story, or one that's gone; deleting a comment hides its replies", async () => {
    const [owner, asha] = [await person(), await person()];
    const [storyA, storyB] = [await story(owner), await story(owner)];
    const onA = await comment(asha, storyA, "Nice");
    const wrong = await client.post(`/api/v1/stories/${storyB}/comments`, { body: "hi", replyTo: onA.id }, owner.auth);
    assert.equal(wrong.status, 404);
    const reply = await comment(owner, storyA, "Thanks!", onA.id);
    assert.equal((await client.delete(`/api/v1/comments/${onA.id}`, asha.auth)).status, 204);
    assert.deepEqual(await list(owner, storyA), [], "the reply went with the comment");
    const gone = await client.post(`/api/v1/stories/${storyA}/comments`, { body: "late", replyTo: onA.id }, owner.auth);
    assert.equal(gone.status, 404);
    void reply;
  });
});

describe("likes on comments", () => {
  it("counts once per person, shows who liked, tells the author once, and can be undone", async () => {
    const [owner, asha, ravi] = [await person(), await person(), await person()];
    const storyId = await story(owner);
    const c = await comment(asha, storyId, "Beautiful sky");
    for (const who of [owner, ravi, ravi]) {
      assert.equal((await client.post(`/api/v1/comments/${c.id}/like`, undefined, who.auth)).status, 204);
    }
    let seen = (await list(ravi, storyId))[0]!;
    assert.deepEqual([seen.likeCount, seen.likedByMe], [2, true]);
    assert.equal((await list(asha, storyId))[0]!.likedByMe, false);
    const heard = (await notificationsOf(asha)).filter((n) => n.type === "comment_like");
    assert.deepEqual(heard.map((n) => n.actor?.username).sort(), [owner.username, ravi.username].sort());

    assert.equal((await client.delete(`/api/v1/comments/${c.id}/like`, ravi.auth)).status, 204);
    assert.equal((await client.post(`/api/v1/comments/${c.id}/like`, undefined, ravi.auth)).status, 204);
    assert.equal((await notificationsOf(asha)).filter((n) => n.type === "comment_like" && n.actor?.username === ravi.username).length, 1, "liking again doesn't notify again");
    seen = (await list(owner, storyId))[0]!;
    assert.equal(seen.likeCount, 2);
  });

  it("only for people who can see the Story", async () => {
    const [owner, friend, stranger] = [await person(), await person(), await person()];
    assert.equal((await client.put(`/api/v1/close-friends/${friend.username}`, undefined, owner.auth)).status < 300, true);
    const storyId = await story(owner, "close_friends");
    const c = await comment(friend, storyId, "Only us");
    const res = await client.post(`/api/v1/comments/${c.id}/like`, undefined, stranger.auth);
    assert.equal(res.status >= 400 && res.status < 500, true, `got ${res.status}`);
    assert.equal((await client.post(`/api/v1/comments/${c.id}/like`, undefined, friend.auth)).status, 204);
  });
});
