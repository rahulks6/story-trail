// Every list that shows people carries their avatar id, so the app shows their photo
// (fetched through the access-checked /users/:username/avatar/file) instead of an initial.
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

async function signup() {
  const input = uniqueUser();
  const res = await client.post("/api/v1/auth/signup", input);
  return { username: input.username, id: res.body.user.id as string, token: res.body.tokens.accessToken as string };
}
async function uploadPhoto(token: string): Promise<string> {
  const res = await fetch(`${baseUrl}/api/v1/media/photos`, { method: "POST", headers: { "Content-Type": "image/png", ...authHeader(token) }, body: buildTestPng(8, 8) });
  assert.equal(res.status, 201);
  return ((await res.json()) as { media: { id: string } }).media.id;
}
async function publishStory(token: string): Promise<string> {
  const mediaId = await uploadPhoto(token);
  const story = await client.post("/api/v1/stories", { mediaId, caption: "", audience: "public", allowComments: "everyone", allowSharing: true }, authHeader(token));
  assert.equal(story.status, 201, JSON.stringify(story.body));
  return story.body.story.id as string;
}

type Person = { username: string; avatarMediaId?: string | null; otherUser?: unknown };
const find = (list: Person[], username: string) => list.find((p) => p.username === username);

describe("avatars in lists", () => {
  it("search, follow lists, requests, mutes, comments, viewers, DMs, Activity and both feeds carry the avatar", async () => {
    const [alice, bob, carol] = [await signup(), await signup(), await signup()];
    const avatar = await uploadPhoto(alice.token);
    assert.equal((await client.patch("/api/v1/users/me", { avatarMediaId: avatar }, authHeader(alice.token))).status, 200);
    const bobAuth = authHeader(bob.token);

    const search = await client.get(`/api/v1/search/users?q=${alice.username}`, bobAuth);
    assert.equal(find(search.body.results, alice.username)?.avatarMediaId, avatar, "search");

    await client.post(`/api/v1/users/${alice.username}/follow`, undefined, bobAuth);
    assert.equal(find((await client.get(`/api/v1/users/${bob.username}/following`, bobAuth)).body.following, alice.username)?.avatarMediaId, avatar, "following");
    const followers = (await client.get(`/api/v1/users/${alice.username}/followers`, bobAuth)).body.followers;
    assert.equal(find(followers, bob.username)?.avatarMediaId, null, "no avatar is null, not missing");

    await client.patch("/api/v1/users/me", { isPrivate: true }, authHeader(carol.token));
    await client.post(`/api/v1/users/${carol.username}/follow`, undefined, authHeader(alice.token));
    assert.equal(find((await client.get("/api/v1/follow-requests", authHeader(carol.token))).body.requests, alice.username)?.avatarMediaId, avatar, "follow requests");

    await client.post(`/api/v1/users/${bob.username}/follow`, undefined, authHeader(alice.token));
    const activity = (await client.get("/api/v1/notifications", bobAuth)).body.notifications as { actor: Person }[];
    assert.equal(activity.find((n) => n.actor?.username === alice.username)?.actor.avatarMediaId, avatar, "Activity");

    const opened = await client.post(`/api/v1/users/${alice.username}/conversation`, undefined, bobAuth);
    assert.equal(opened.body.conversation.otherUser.avatarMediaId, avatar, "opening a DM");
    const conversation = opened.body.conversation.id as string;
    await client.post(`/api/v1/conversations/${conversation}/messages`, { body: "hi" }, authHeader(alice.token));
    const inbox = (await client.get("/api/v1/conversations", bobAuth)).body.conversations as { id: string; otherUser: Person }[];
    assert.equal(inbox.find((c) => c.id === conversation)?.otherUser.avatarMediaId, avatar, "DM inbox");
    assert.equal((await client.get(`/api/v1/conversations/${conversation}`, bobAuth)).body.conversation.otherUser.avatarMediaId, avatar, "DM thread");

    const bobStory = await publishStory(bob.token);
    await client.post(`/api/v1/stories/${bobStory}/view`, undefined, authHeader(alice.token));
    await client.post(`/api/v1/stories/${bobStory}/comments`, { body: "Nice" }, authHeader(alice.token));
    assert.equal(find((await client.get(`/api/v1/stories/${bobStory}/viewers`, bobAuth)).body.viewers, alice.username)?.avatarMediaId, avatar, "viewers (owner only)");
    assert.equal(find((await client.get(`/api/v1/stories/${bobStory}/comments`, bobAuth)).body.comments, alice.username)?.avatarMediaId, avatar, "comments");

    await publishStory(alice.token);
    const following = (await client.get("/api/v1/stories/feed/following", bobAuth)).body.feed as { owner: Person }[];
    assert.equal(following.find((e) => e.owner.username === alice.username)?.owner.avatarMediaId, avatar, "following feed");
    const home = (await client.get("/api/v1/stories/feed/home", bobAuth)).body.feed as { owner: Person }[];
    assert.equal(home.find((e) => e.owner.username === alice.username)?.owner.avatarMediaId, avatar, "home feed");

    await client.post(`/api/v1/users/${alice.username}/mute`, undefined, bobAuth);
    assert.equal(find((await client.get("/api/v1/mutes", bobAuth)).body.muted, alice.username)?.avatarMediaId, avatar, "muted accounts");
  });

  it("a blocked person's avatar stays unavailable even though lists carry ids", async () => {
    const [alice, bob] = [await signup(), await signup()];
    const avatar = await uploadPhoto(alice.token);
    await client.patch("/api/v1/users/me", { avatarMediaId: avatar }, authHeader(alice.token));
    const file = () => fetch(`${baseUrl}/api/v1/users/${alice.username}/avatar/file?v=${avatar}`, { headers: authHeader(bob.token) });
    assert.notEqual((await file()).status, 404);
    await client.post(`/api/v1/users/${bob.username}/block`, undefined, authHeader(alice.token));
    assert.equal((await file()).status, 404);
  });
});
