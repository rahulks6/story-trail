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
async function uploadPhoto(token: string): Promise<string> {
  const res = await fetch(`${baseUrl}/api/v1/media/photos`, { method: "POST", headers: { "Content-Type": "image/png", ...authHeader(token) }, body: buildTestPng(4, 4) });
  return ((await res.json()) as { media: { id: string } }).media.id;
}
async function openChat(from: { token: string }, to: { username: string }): Promise<string> {
  const res = await client.post(`/api/v1/users/${to.username}/conversation`, undefined, authHeader(from.token));
  return res.body.conversation.id as string;
}

describe("photos and videos in direct messages", () => {
  it("sends a photo the other person can open, shows it in the inbox, and keeps it from cleanup", async () => {
    const a = await signupUser();
    const b = await signupUser();
    const outsider = await signupUser();
    const chat = await openChat(a, b);
    const mediaId = await uploadPhoto(a.token);

    // Before it's sent, only its uploader can open it.
    assert.equal((await client.get(`/api/v1/media/${mediaId}`, authHeader(b.token))).status, 404);

    const sent = await client.post(`/api/v1/conversations/${chat}/messages`, { mediaId, clientMessageId: `media_${Date.now().toString(36)}_abcdefgh` }, authHeader(a.token));
    assert.equal(sent.status, 201, JSON.stringify(sent.body));
    assert.equal(sent.body.message.body, null);
    assert.equal(sent.body.message.media.id, mediaId);
    assert.equal(sent.body.message.media.kind, "photo");

    const thread = await client.get(`/api/v1/conversations/${chat}/messages`, authHeader(b.token));
    assert.equal(thread.body.messages[0].media.id, mediaId);
    assert.equal((await client.get(`/api/v1/media/${mediaId}`, authHeader(b.token))).status, 200);
    assert.equal((await client.get(`/api/v1/media/${mediaId}`, authHeader(outsider.token))).status, 404);

    const inbox = await client.get(`/api/v1/conversations`, authHeader(b.token));
    assert.equal(inbox.body.conversations[0].lastMessage.mediaKind, "photo");

    // The unused-media cleanup leaves it alone even when it's old.
    await query(`UPDATE media SET created_at = now() - interval '10 days' WHERE id = :'id'`, { id: mediaId });
    const claimed = await query(`SELECT id FROM claim_unused_media_for_purge(:'id'::uuid, 48)`, { id: mediaId });
    assert.equal(claimed.length, 0);
  });

  it("only sends your own upload", async () => {
    const a = await signupUser();
    const b = await signupUser();
    const chat = await openChat(a, b);
    const theirs = await uploadPhoto(b.token);
    const res = await client.post(`/api/v1/conversations/${chat}/messages`, { mediaId: theirs }, authHeader(a.token));
    assert.equal(res.status, 422);
    const bad = await client.post(`/api/v1/conversations/${chat}/messages`, { mediaId: "nope" }, authHeader(a.token));
    assert.equal(bad.status, 422);
  });
});

describe("voice notes", () => {
  it("records as M4A, processes to small AAC, plays for both people, and is never a Story", async () => {
    const { execFileSync } = await import("node:child_process");
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const { claimMediaJob } = await import("../src/modules/media/jobs");
    const { processClaimedJob } = await import("../src/modules/media/worker");
    const { mediaStorage } = await import("../src/modules/media/instance");
    const a = await signupUser();
    const b = await signupUser();
    const chat = await openChat(a, b);
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "voice-")), "note.m4a");
    execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=330:duration=3", "-c:a", "aac", "-b:a", "96k", file]);
    const up = await fetch(`${baseUrl}/api/v1/media/audio`, { method: "POST", headers: { "Content-Type": "audio/mp4", ...authHeader(a.token) }, body: fs.readFileSync(file) });
    assert.equal(up.status, 201);
    const uploaded = (await up.json()) as { media: { id: string; kind: string; status: string } };
    const mediaId = uploaded.media.id;
    // Handed to the worker (it has ffmpeg) at once, not tried in the request first.
    assert.equal(uploaded.media.status, "processing");
    // A picture isn't a voice note.
    const bad = await fetch(`${baseUrl}/api/v1/media/audio`, { method: "POST", headers: { "Content-Type": "audio/mp4", ...authHeader(a.token) }, body: buildTestPng(4, 4) });
    assert.equal(bad.status, 415);

    const job = await claimMediaJob("voice-test", 60, mediaId);
    if (job) assert.equal(await processClaimedJob(job, mediaStorage, { workerId: "voice-test", leaseSeconds: 60, jobTimeoutSeconds: 60 }), "done");
    const ready = await client.get(`/api/v1/media/${mediaId}`, authHeader(a.token));
    assert.equal(ready.body.media.status, "ready");
    assert.ok(Math.abs(ready.body.media.durationMs - 3000) < 300);

    const sent = await client.post(`/api/v1/conversations/${chat}/messages`, { mediaId }, authHeader(a.token));
    assert.equal(sent.status, 201);
    assert.equal(sent.body.message.media.kind, "audio");
    const sound = await fetch(`${baseUrl}/api/v1/media/${mediaId}/file?variant=audio`, { headers: authHeader(b.token) });
    assert.equal(sound.status, 200);
    assert.equal(sound.headers.get("content-type"), "audio/mp4");
    const inbox = await client.get(`/api/v1/conversations`, authHeader(b.token));
    assert.equal(inbox.body.conversations[0].lastMessage.mediaKind, "audio");

    const story = await client.post("/api/v1/stories", { mediaId, caption: "", audience: "public" }, authHeader(a.token));
    assert.equal(story.status, 422);
  });
});
