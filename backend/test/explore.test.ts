// Explore (the Search tab before you type): one tile per new person, from their newest public
// Story, never someone you follow, never yourself, never a Story kept to followers.
import "./env";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { buildApp } from "../src/app";
import { buildTestPng } from "./fixtures";
import { authHeader, makeClient, uniqueUser } from "./helpers";

const server = buildApp();
let baseUrl: string;
let client: ReturnType<typeof makeClient>;
before(async () => {
  await new Promise<void>((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  client = makeClient(baseUrl);
});
after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

interface Person { id: string; username: string; auth: Record<string, string> }
async function person(): Promise<Person> {
  const input = uniqueUser();
  const res = await client.post("/api/v1/auth/signup", input);
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return { id: res.body.user.id, username: input.username, auth: authHeader(res.body.tokens.accessToken) };
}
async function story(owner: Person, audience = "public"): Promise<string> {
  const upload = await fetch(`${baseUrl}/api/v1/media/photos`, { method: "POST", headers: { "Content-Type": "image/png", ...owner.auth }, body: buildTestPng(4, 4) });
  const mediaId = ((await upload.json()) as { media: { id: string } }).media.id;
  const res = await client.post("/api/v1/stories", { mediaId, caption: "", audience, allowComments: "everyone", allowSharing: true }, owner.auth);
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.story.id as string;
}
const explore = async (who: Person) => {
  const res = await client.get("/api/v1/explore", who.auth);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body.explore as Array<{ owner: { username: string }; story: { id: string; kind: string; thumbnailUrl: string | null; imageUrl: string | null } }>;
};

describe("Explore", () => {
  it("shows a new person's newest public Story, ready to open, and not people you follow or yourself", async () => {
    const viewer = await person();
    const creator = await person();
    const friend = await person();
    await story(creator);
    const newest = await story(creator);
    await story(friend);
    await story(viewer);
    await client.post(`/api/v1/users/${friend.username}/follow`, undefined, viewer.auth);

    const tiles = await explore(viewer);
    const mine = tiles.find((t) => t.owner.username === creator.username);
    assert.ok(mine, `the new person is on Explore: ${JSON.stringify(tiles.map((t) => t.owner.username))}`);
    assert.equal(mine.story.id, newest, "their newest Story");
    assert.equal(mine.story.kind, "photo");
    assert.ok(mine.story.thumbnailUrl || mine.story.imageUrl, "a picture for the tile");
    assert.equal(tiles.filter((t) => t.owner.username === creator.username).length, 1, "one tile each");
    assert.ok(!tiles.some((t) => t.owner.username === friend.username), "not someone you already follow");
    assert.ok(!tiles.some((t) => t.owner.username === viewer.username), "never yourself");
  });

  it("never shows a Story kept to followers", async () => {
    const viewer = await person();
    const quiet = await person();
    await story(quiet, "followers");
    assert.ok(!(await explore(viewer)).some((t) => t.owner.username === quiet.username));
  });

  it("needs a signed-in person", async () => {
    assert.equal((await client.get("/api/v1/explore")).status, 401);
  });
});
