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

type User = { username: string; token: string; id: string };
async function signup(): Promise<User> {
  const input = uniqueUser();
  const res = await client.post("/api/v1/auth/signup", input);
  return { username: input.username, token: res.body.tokens.accessToken as string, id: res.body.user.id as string };
}
async function publish(owner: User, audience: string): Promise<string> {
  const upload = await fetch(`${baseUrl}/api/v1/media/photos`, { method: "POST", headers: { "Content-Type": "image/png", ...authHeader(owner.token) }, body: buildTestPng(4, 4) });
  const mediaId = ((await upload.json()) as { media: { id: string } }).media.id;
  const res = await client.post("/api/v1/stories", { mediaId, caption: "", audience, allowComments: "everyone", allowSharing: true }, authHeader(owner.token));
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.story.id as string;
}
const follow = (a: User, b: User) => client.post(`/api/v1/users/${b.username}/follow`, undefined, authHeader(a.token));
const addFriend = (owner: User, friend: User) => client.put(`/api/v1/close-friends/${friend.username}`, undefined, authHeader(owner.token));
const removeFriend = (owner: User, friend: User) => client.delete(`/api/v1/close-friends/${friend.username}`, authHeader(owner.token));
const getStory = (id: string, viewer: User) => client.get(`/api/v1/stories/${id}`, authHeader(viewer.token));
const userStoryIds = async (owner: User, viewer: User) =>
  ((await client.get(`/api/v1/users/${owner.username}/stories`, authHeader(viewer.token))).body.stories as { id: string }[]).map((s) => s.id);

describe("Close Friends list", () => {
  it("is managed by its owner only: add, list, remove, idempotently", async () => {
    const owner = await signup();
    const a = await signup();
    const b = await signup();
    assert.equal((await addFriend(owner, a)).status, 204);
    assert.equal((await addFriend(owner, a)).status, 204, "adding twice is fine");
    assert.equal((await addFriend(owner, b)).status, 204);
    const list = await client.get("/api/v1/close-friends", authHeader(owner.token));
    assert.deepEqual(list.body.closeFriends.map((f: { username: string }) => f.username).sort(), [a.username, b.username].sort());
    // Someone else's list is theirs: a's own list is empty, and the friends never see the owner's.
    assert.deepEqual((await client.get("/api/v1/close-friends", authHeader(a.token))).body.closeFriends, []);
    assert.equal((await removeFriend(owner, b)).status, 204);
    assert.equal((await removeFriend(owner, b)).status, 204, "removing twice is fine");
    assert.equal((await client.get("/api/v1/close-friends", authHeader(owner.token))).body.closeFriends.length, 1);
    assert.equal((await client.put(`/api/v1/close-friends/${owner.username}`, undefined, authHeader(owner.token))).status, 400);
    assert.equal((await client.put("/api/v1/close-friends/nobody_here_xyz", undefined, authHeader(owner.token))).status, 404);
  });

  it("drops a person from the list when either side blocks, and can't add a blocked person", async () => {
    const owner = await signup();
    const friend = await signup();
    await addFriend(owner, friend);
    await client.post(`/api/v1/users/${owner.username}/block`, undefined, authHeader(friend.token));
    assert.equal((await client.get("/api/v1/close-friends", authHeader(owner.token))).body.closeFriends.length, 0);
    assert.equal((await addFriend(owner, friend)).status, 404);
  });
});

describe("Close Friends Stories", () => {
  it("are seen only by people on the list, not by other followers or strangers", async () => {
    const owner = await signup();
    const friend = await signup();
    const follower = await signup();
    const stranger = await signup();
    await follow(follower, owner);
    await addFriend(owner, friend);
    const story = await publish(owner, "close_friends");

    assert.equal((await getStory(story, owner)).status, 200);
    const seen = await getStory(story, friend);
    assert.equal(seen.status, 200, "on the list, even without following");
    assert.equal(seen.body.story.audience, "close_friends");
    assert.equal((await getStory(story, follower)).status, 404, "a follower not on the list doesn't learn it exists");
    assert.equal((await getStory(story, stranger)).status, 404);

    assert.deepEqual(await userStoryIds(owner, friend), [story]);
    assert.deepEqual(await userStoryIds(owner, follower), []);
    assert.deepEqual(await userStoryIds(owner, stranger), []);

    // Engagement goes through the same rule.
    assert.equal((await client.post(`/api/v1/stories/${story}/like`, undefined, authHeader(follower.token))).status, 404);
    assert.equal((await client.post(`/api/v1/stories/${story}/replies`, { body: "hi" }, authHeader(follower.token))).status, 404);
    assert.equal((await client.post(`/api/v1/stories/${story}/replies`, { reaction: "🔥" }, authHeader(friend.token))).status, 201);
  });

  it("stay out of followers' feeds, and reach a friend who follows", async () => {
    const owner = await signup();
    const follower = await signup();
    const friend = await signup();
    await follow(follower, owner);
    await follow(friend, owner);
    await addFriend(owner, friend);
    const story = await publish(owner, "close_friends");

    const ownerIn = (feed: { owner: { id: string }; stories: { id: string }[] }[]) => feed.find((e) => e.owner.id === owner.id);
    const followingFeed = async (viewer: User) => (await client.get("/api/v1/stories/feed/following", authHeader(viewer.token))).body.feed;
    const homeFeed = async (viewer: User) => (await client.get("/api/v1/stories/feed/home", authHeader(viewer.token))).body.feed;
    assert.equal(ownerIn(await followingFeed(follower)), undefined);
    assert.equal(ownerIn(await homeFeed(follower)), undefined);
    assert.deepEqual(ownerIn(await followingFeed(friend))?.stories.map((s) => s.id), [story]);
    assert.deepEqual(ownerIn(await homeFeed(friend))?.stories.map((s) => s.id), [story]);
  });

  it("disappear as soon as the person is taken off the list", async () => {
    const owner = await signup();
    const friend = await signup();
    await addFriend(owner, friend);
    const story = await publish(owner, "close_friends");
    assert.equal((await getStory(story, friend)).status, 200);
    await removeFriend(owner, friend);
    assert.equal((await getStory(story, friend)).status, 404);
  });

  it("keep their audience inside a Highlight", async () => {
    const owner = await signup();
    const friend = await signup();
    const follower = await signup();
    await follow(follower, owner);
    await addFriend(owner, friend);
    const open = await publish(owner, "public");
    const close = await publish(owner, "close_friends");
    const created = await client.post("/api/v1/highlights", { title: "Trip", storyIds: [open, close] }, authHeader(owner.token));
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const id = created.body.highlight.id as string;
    const items = async (viewer: User) => ((await client.get(`/api/v1/highlights/${id}`, authHeader(viewer.token))).body.highlight.items as { storyId: string }[]).map((i) => i.storyId).sort();
    assert.deepEqual(await items(friend), [open, close].sort());
    assert.deepEqual(await items(follower), [open]);
    assert.equal((await client.get(`/api/v1/highlights/${id}/items/${close}`, authHeader(follower.token))).status, 404);
  });

  it("never notify a person outside the audience who is mentioned in a comment", async () => {
    const owner = await signup();
    const friend = await signup();
    const outsider = await signup();
    await addFriend(owner, friend);
    const story = await publish(owner, "close_friends");
    const comment = await client.post(`/api/v1/stories/${story}/comments`, { body: `@${outsider.username} @${friend.username} look` }, authHeader(owner.token));
    assert.equal(comment.status, 201, JSON.stringify(comment.body));
    const mentions = async (u: User) => ((await client.get("/api/v1/notifications", authHeader(u.token))).body.notifications as { type: string }[]).filter((n) => n.type === "mention").length;
    assert.equal(await mentions(friend), 1);
    assert.equal(await mentions(outsider), 0);
  });
});
