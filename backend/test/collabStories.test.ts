import "./env";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { buildApp } from "../src/app";
import { query } from "../src/db/psql";
import { renderPush } from "../src/modules/push/dispatcher";
import { authHeader, makeClient, uniqueUser } from "./helpers";
import { buildTestPng } from "./fixtures";

// Collab Stories: invite, accept or decline, both rings and both audiences, blocks and privacy.
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

type User = { username: string; token: string; id: string };
async function signup(): Promise<User> {
  const input = uniqueUser();
  const res = await client.post("/api/v1/auth/signup", input);
  return { username: input.username, token: res.body.tokens.accessToken as string, id: res.body.user.id as string };
}
const follow = (a: User, b: User) => client.post(`/api/v1/users/${b.username}/follow`, undefined, authHeader(a.token));
const block = (a: User, b: User) => client.post(`/api/v1/users/${b.username}/block`, undefined, authHeader(a.token));
async function publish(owner: User, extra: Record<string, unknown>): Promise<{ status: number; body: any }> {
  const up = await fetch(`${baseUrl}/api/v1/media/photos`, { method: "POST", headers: { "Content-Type": "image/png", ...authHeader(owner.token) }, body: buildTestPng(4, 4) });
  const mediaId = ((await up.json()) as { media: { id: string } }).media.id;
  return client.post("/api/v1/stories", { mediaId, caption: "", audience: "public", allowComments: "everyone", allowSharing: true, ...extra }, authHeader(owner.token));
}
async function collabStory(owner: User, collaborator: User, extra: Record<string, unknown> = {}): Promise<string> {
  const res = await publish(owner, { collaboratorId: collaborator.id, ...extra });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.story.id as string;
}
const ring = async (owner: User, viewer: User) =>
  ((await client.get(`/api/v1/users/${owner.username}/stories`, authHeader(viewer.token))).body.stories ?? []).map((s: { id: string }) => s.id);
const accept = (story: string, who: User) => client.post(`/api/v1/stories/${story}/collab/accept`, undefined, authHeader(who.token));
const homeOwners = async (viewer: User) => ((await client.get("/api/v1/stories/feed/home", authHeader(viewer.token))).body.feed as { owner: { username: string }; stories: { id: string }[] }[]);

describe("inviting", () => {
  it("only someone who follows you or whom you follow, never with Close Friends, and never someone blocked", async () => {
    const owner = await signup();
    const fan = await signup();
    const stranger = await signup();
    await follow(fan, owner);
    assert.equal((await publish(owner, { collaboratorId: stranger.id })).status, 422);
    assert.equal((await publish(owner, { collaboratorId: owner.id })).status, 422);
    assert.equal((await publish(owner, { collaboratorId: fan.id, audience: "close_friends" })).status, 422);

    const candidates = await client.get(`/api/v1/collab-candidates?q=${fan.username.slice(0, 8)}`, authHeader(owner.token));
    assert.deepEqual(candidates.body.people.map((p: { id: string }) => p.id), [fan.id]);
    assert.deepEqual((await client.get(`/api/v1/collab-candidates?q=${stranger.username}`, authHeader(owner.token))).body.people, []);

    await block(fan, owner);
    assert.equal((await publish(owner, { collaboratorId: fan.id })).status, 422);
  });

  it("notifies the invited person once, who can see the Story while deciding", async () => {
    const owner = await signup();
    const friend = await signup();
    await follow(owner, friend);
    // A followers-only Story of someone the friend doesn't follow: still theirs to look at.
    const story = await collabStory(owner, friend, { audience: "followers" });
    const notes = (await client.get("/api/v1/notifications", authHeader(friend.token))).body.notifications as any[];
    const invite = notes.find((n) => n.type === "collab_invite");
    assert.ok(invite);
    assert.equal(invite.story.id, story);
    assert.deepEqual(invite.collab, { status: "pending" });
    assert.equal((await client.get(`/api/v1/stories/${story}`, authHeader(friend.token))).status, 200);
    const view = (await client.get(`/api/v1/stories/${story}`, authHeader(owner.token))).body.story.collab;
    assert.equal(view.status, "pending");
    assert.equal(view.collaborator.username, friend.username);

    const rendered = await renderPush({ id: "x", userId: friend.id, kind: "collab_invite", actorId: owner.id, refId: story, attempts: 1 });
    assert.ok("message" in rendered && rendered.message.body === `@${owner.username} invited you to a collab Story`);
    assert.ok("message" in rendered && rendered.message.data.url === `katkee://story/${story}`);
  });

  it("reaches the invitation through a publish the media worker completes (SQL path)", async () => {
    const owner = await signup();
    const friend = await signup();
    await follow(friend, owner);
    const up = await fetch(`${baseUrl}/api/v1/media/photos`, { method: "POST", headers: { "Content-Type": "image/png", ...authHeader(owner.token) }, body: buildTestPng(4, 4) });
    const mediaId = ((await up.json()) as { media: { id: string } }).media.id;
    const res = await client.post("/api/v1/stories", { requestId: `collab_req_${Date.now()}_abcdef`, mediaId, audience: "public", collaboratorId: friend.id }, authHeader(owner.token));
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.story.collab.status, "pending");
    assert.ok(((await client.get("/api/v1/notifications", authHeader(friend.token))).body.notifications as any[]).some((n) => n.type === "collab_invite"));
  });
});

describe("accepting", () => {
  it("puts the Story in both rings, both feeds and both followers' views, with both names", async () => {
    const owner = await signup();
    const collaborator = await signup();
    const theirFan = await signup();
    await follow(collaborator, owner);
    await follow(theirFan, collaborator);
    const story = await collabStory(owner, collaborator, { audience: "followers" });

    assert.equal((await client.get(`/api/v1/stories/${story}`, authHeader(theirFan.token))).status, 403, "not before it's accepted");
    assert.deepEqual(await ring(collaborator, theirFan), []);

    const res = await accept(story, collaborator);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.collab.status, "accepted");
    assert.equal((await accept(story, collaborator)).status, 409, "answered once");
    assert.ok(((await client.get("/api/v1/notifications", authHeader(owner.token))).body.notifications as any[]).some((n) => n.type === "collab_accepted"));

    const seen = await client.get(`/api/v1/stories/${story}`, authHeader(theirFan.token));
    assert.equal(seen.status, 200, "the collaborator's followers see a followers-only collab");
    assert.deepEqual([seen.body.story.collab.owner.username, seen.body.story.collab.collaborator.username], [owner.username, collaborator.username]);
    assert.deepEqual(await ring(collaborator, theirFan), [story], "in the collaborator's ring");
    assert.ok((await client.get("/api/v1/stories/mine/active", authHeader(collaborator.token))).body.stories.some((s: { id: string }) => s.id === story));
    const home = await homeOwners(theirFan);
    assert.deepEqual(home.find((e) => e.owner.username === collaborator.username)?.stories.map((s) => s.id), [story], "and on Home");
    const following = (await client.get("/api/v1/stories/feed/following", authHeader(theirFan.token))).body.feed as { owner: { username: string }; stories: { id: string }[] }[];
    assert.deepEqual(following.find((e) => e.owner.username === collaborator.username)?.stories.map((s) => s.id), [story]);
  });

  it("never gets past a private owner, a block with either creator, or a decline", async () => {
    const owner = await signup();
    const collaborator = await signup();
    const theirFan = await signup();
    const blocker = await signup();
    await follow(owner, collaborator);
    await follow(theirFan, collaborator);
    await follow(blocker, owner);
    const story = await collabStory(owner, collaborator);
    await accept(story, collaborator);

    await block(blocker, collaborator);
    assert.equal((await client.get(`/api/v1/stories/${story}`, authHeader(blocker.token))).status, 404, "blocking the collaborator hides their collabs");
    assert.deepEqual(await ring(owner, blocker), [], "even in the owner's ring");

    await query(`UPDATE users SET is_private = true WHERE id = :'id'`, { id: owner.id });
    assert.equal((await client.get(`/api/v1/stories/${story}`, authHeader(theirFan.token))).status, 403, "a private owner's collab stays with their followers");
    assert.deepEqual(await ring(collaborator, theirFan), []);
    assert.equal((await homeOwners(theirFan)).find((e) => e.owner.username === collaborator.username), undefined);
    await query(`UPDATE users SET is_private = false WHERE id = :'id'`, { id: owner.id });
    assert.deepEqual(await ring(collaborator, theirFan), [story]);

    // A block between the two creators ends the collab on its own.
    await block(owner, collaborator);
    assert.deepEqual(await ring(collaborator, theirFan), []);
    assert.equal((await client.get(`/api/v1/stories/${story}`, authHeader(theirFan.token))).body.story.collab, null);
  });

  it("can be declined, left by the collaborator, or ended by the owner", async () => {
    const owner = await signup();
    const collaborator = await signup();
    const stranger = await signup();
    await follow(owner, collaborator);
    const declined = await collabStory(owner, collaborator);
    assert.equal((await accept(declined, stranger)).status, 404, "only the invited person answers");
    assert.equal((await client.post(`/api/v1/stories/${declined}/collab/decline`, undefined, authHeader(collaborator.token))).body.collab.status, "declined");
    assert.equal((await client.get(`/api/v1/stories/${declined}`, authHeader(stranger.token))).body.story.collab, null, "a decline is between the two of them");
    const notes = (await client.get("/api/v1/notifications", authHeader(collaborator.token))).body.notifications as any[];
    assert.equal(notes.find((n) => n.story?.id === declined).collab.status, "declined");

    const left = await collabStory(owner, collaborator);
    await accept(left, collaborator);
    assert.equal((await client.delete(`/api/v1/stories/${left}/collab`, authHeader(stranger.token))).status, 404);
    assert.equal((await client.delete(`/api/v1/stories/${left}/collab`, authHeader(collaborator.token))).status, 204);
    assert.deepEqual(await ring(collaborator, owner), []);

    const ended = await collabStory(owner, collaborator);
    await accept(ended, collaborator);
    assert.equal((await client.delete(`/api/v1/stories/${ended}/collab`, authHeader(owner.token))).status, 204);
    assert.equal((await client.get(`/api/v1/stories/${ended}`, authHeader(owner.token))).body.story.collab, null);
  });
});
