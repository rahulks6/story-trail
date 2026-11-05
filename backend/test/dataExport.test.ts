// "Download your data": one archive of what someone put into Katkee, and nothing of anyone else's.
import "./env";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { buildApp } from "../src/app";
import { query } from "../src/db/psql";
import { mediaStorage } from "../src/modules/media/instance";
import { MediaWorker } from "../src/modules/media/worker";
import { expiredDataExports } from "../src/modules/users/data-export";
import { authHeader, makeClient, uniqueUser } from "./helpers";
import { buildTestPng } from "./fixtures";

let client: ReturnType<typeof makeClient>;
let baseUrl: string;
const server = buildApp();
const worker = new MediaWorker({ store: mediaStorage, workerId: "test-export-worker", concurrency: 1, leaseSeconds: 60, pollMs: 50, jobTimeoutSeconds: 120 });

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
async function postStory(owner: User, caption: string): Promise<string> {
  const up = await fetch(`${baseUrl}/api/v1/media/photos`, { method: "POST", headers: { "Content-Type": "image/png", ...authHeader(owner.token) }, body: buildTestPng(4, 4) });
  const mediaId = ((await up.json()) as { media: { id: string } }).media.id;
  const res = await client.post("/api/v1/stories", { mediaId, requestId: `story_${randomUUID().replace(/-/g, "")}`, caption, audience: "public", allowComments: "everyone", allowSharing: true }, authHeader(owner.token));
  assert.ok(res.status === 201 || res.status === 202, JSON.stringify(res.body));
  return (res.body.story?.id ?? res.body.publish?.storyId) as string;
}

/** The entries of a stored (uncompressed) ZIP: name → bytes. */
function unzip(bytes: Buffer): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  let at = 0;
  while (bytes.readUInt32LE(at) === 0x04034b50) {
    const size = bytes.readUInt32LE(at + 18), nameLength = bytes.readUInt16LE(at + 26), extra = bytes.readUInt16LE(at + 28);
    const name = bytes.subarray(at + 30, at + 30 + nameLength).toString("utf8");
    const start = at + 30 + nameLength + extra;
    out.set(name, bytes.subarray(start, start + size));
    at = start + size;
  }
  return out;
}

describe("download your data", () => {
  it("collects your account, Stories with their photos, comments, likes, follows and the messages you sent", async () => {
    const me = await signup();
    const friend = await signup();
    const story = await postStory(me, "Chai at five");
    const theirs = await postStory(friend, "Their Story");
    await client.post(`/api/v1/users/${friend.username}/follow`, undefined, authHeader(me.token));
    await client.post(`/api/v1/users/${me.username}/follow`, undefined, authHeader(friend.token));
    await query(`INSERT INTO story_comments (story_id, user_id, body) VALUES (:'s', :'u', 'Lovely')`, { s: theirs, u: me.id });
    await query(`INSERT INTO story_likes (story_id, user_id) VALUES (:'s', :'u')`, { s: theirs, u: me.id });
    const chat = await query(`INSERT INTO conversations (user_a_id, user_b_id) VALUES (LEAST(:'a'::uuid, :'b'::uuid), GREATEST(:'a'::uuid, :'b'::uuid)) RETURNING id`, { a: me.id, b: friend.id });
    const conversation = chat[0]!.id as string;
    await query(`INSERT INTO conversation_members (conversation_id, user_id) VALUES (:'c', :'a'), (:'c', :'b') ON CONFLICT DO NOTHING`, { c: conversation, a: me.id, b: friend.id });
    await query(`INSERT INTO messages (conversation_id, sender_id, body) VALUES (:'c', :'a', 'My words'), (:'c', :'b', 'Their private words')`, { c: conversation, a: me.id, b: friend.id });

    const asked = await client.post("/api/v1/users/me/data-export", undefined, authHeader(me.token));
    assert.equal(asked.status, 202);
    assert.equal(asked.body.export.status, "queued");
    const again = await client.post("/api/v1/users/me/data-export", undefined, authHeader(me.token));
    assert.equal(again.status, 200, "one on its way already");
    assert.equal(again.body.export.id, asked.body.export.id);

    await worker.drain();
    const status = (await client.get("/api/v1/users/me/data-export", authHeader(me.token))).body.export;
    assert.equal(status.status, "ready");
    assert.ok(status.byteSize > 0);
    const file = await fetch(`${baseUrl}${status.downloadUrl}`, { headers: authHeader(me.token) });
    assert.equal(file.status, 200);
    const zip = unzip(Buffer.from(await file.arrayBuffer()));

    const read = (name: string) => JSON.parse(zip.get(name)!.toString("utf8"));
    assert.ok(zip.has("README.txt"));
    assert.equal(read("account.json").username, me.username);
    const stories = read("stories.json");
    assert.equal(stories.length, 1);
    assert.equal(stories[0].caption, "Chai at five");
    assert.equal(stories[0].id, story);
    assert.ok(zip.get(stories[0].file)!.length > 0, "the Story's photo is in the archive");
    assert.deepEqual(read("comments.json").map((c: { comment: string }) => c.comment), ["Lovely"]);
    assert.deepEqual(read("likes.json").map((l: { storyId: string }) => l.storyId), [theirs]);
    assert.deepEqual(read("following.json").map((p: { username: string }) => p.username), [friend.username]);
    assert.deepEqual(read("followers.json").map((p: { username: string }) => p.username), [friend.username]);
    const messages = read("messages.json");
    assert.deepEqual(messages.map((m: { message: string }) => m.message), ["My words"]);
    assert.equal(messages[0].chat, friend.username);
    assert.ok(![...zip.values()].some((b) => b.includes("Their private words")), "never someone else's messages");
    assert.ok(![...zip.values()].some((b) => b.includes("Their Story")), "never someone else's Stories");
  });

  it("is yours alone, and is deleted when it expires or the account goes", async () => {
    const me = await signup();
    const other = await signup();
    await client.post("/api/v1/users/me/data-export", undefined, authHeader(me.token));
    await worker.drain();
    const status = (await client.get("/api/v1/users/me/data-export", authHeader(me.token))).body.export;
    assert.equal((await fetch(`${baseUrl}${status.downloadUrl}`, { headers: authHeader(other.token) })).status, 404);
    assert.equal((await client.get("/api/v1/users/me/data-export", authHeader(other.token))).body.export, null);
    const key = (await query(`SELECT storage_key FROM data_exports WHERE id = :'id'`, { id: status.id }))[0]!.storage_key as string;
    assert.ok(await mediaStorage.head(key));
    await query(`UPDATE data_exports SET expires_at = now() - interval '1 minute' WHERE id = :'id'`, { id: status.id });
    assert.ok((await expiredDataExports(mediaStorage, 100)) >= 1);
    assert.equal(await mediaStorage.head(key), null, "its file is gone");
    assert.equal((await client.get("/api/v1/users/me/data-export", authHeader(me.token))).body.export, null);
  });
});
