import "./env";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { buildApp } from "../src/app";
import { query } from "../src/db/psql";
import { mediaStorage } from "../src/modules/media/instance";
import { authHeader, makeClient, uniqueUser } from "./helpers";
import { buildTestPng } from "./fixtures";

let client: ReturnType<typeof makeClient>;
let baseUrl: string;
const server = buildApp();
const trackId = randomUUID();
const hiddenId = randomUUID();

before(async () => {
  await new Promise<void>((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  client = makeClient(baseUrl);
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "music-")), "song.mp3");
  fs.writeFileSync(file, Buffer.alloc(2048, 7));
  await mediaStorage.putFile(`m/${trackId}/audio.mp3`, file, "audio/mpeg");
  await query(
    `INSERT INTO music_tracks (id, title, artist, mood, duration_ms, storage_key, byte_size, license, license_url, attribution, active) VALUES
     (:'id', 'Sunny Walk', 'Test Artist', 'Happy', 60000, :'key', 2048, 'CC BY 4.0', 'https://creativecommons.org/licenses/by/4.0/', 'Sunny Walk by Test Artist (CC BY 4.0)', true),
     (:'hidden', 'Old Song', 'Someone', 'Chill', 30000, :'hkey', 10, 'CC0', 'https://creativecommons.org/publicdomain/zero/1.0/', 'Old Song by Someone', false)`,
    { id: trackId, key: `m/${trackId}/audio.mp3`, hidden: hiddenId, hkey: `m/${hiddenId}/audio.mp3` },
  );
});
after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function signupUser() {
  const input = uniqueUser();
  const res = await client.post("/api/v1/auth/signup", input);
  return { username: input.username, token: res.body.tokens.accessToken as string };
}
async function uploadPhoto(token: string): Promise<string> {
  const res = await fetch(`${baseUrl}/api/v1/media/photos`, { method: "POST", headers: { "Content-Type": "image/png", ...authHeader(token) }, body: buildTestPng(4, 4) });
  return ((await res.json()) as { media: { id: string } }).media.id;
}

describe("music", () => {
  it("lists the catalogue with credits, searches it, and plays a song", async () => {
    const me = await signupUser();
    const list = await client.get("/api/v1/music", authHeader(me.token));
    assert.equal(list.status, 200);
    const ids = list.body.tracks.map((t: { id: string }) => t.id);
    assert.ok(ids.includes(trackId));
    assert.ok(!ids.includes(hiddenId), "a track taken out of the catalogue isn't offered");
    assert.ok(list.body.moods.includes("Happy"), "moods come from the catalogue");
    const track = list.body.tracks.find((t: { id: string }) => t.id === trackId);
    assert.equal(track.attribution, "Sunny Walk by Test Artist (CC BY 4.0)");
    assert.equal((await client.get("/api/v1/music?q=nothing-like-this", authHeader(me.token))).body.tracks.length, 0);
    const file = await fetch(`${baseUrl}${track.url}`, { headers: authHeader(me.token) });
    assert.equal(file.status, 200);
    assert.equal((await file.arrayBuffer()).byteLength, 2048);
  });

  it("puts a song on a Story, keeps the part that plays within the song, and shows it to viewers", async () => {
    const owner = await signupUser();
    const viewer = await signupUser();
    const mediaId = await uploadPhoto(owner.token);
    const res = await client.post("/api/v1/stories", { mediaId, caption: "", audience: "public", music: { trackId, startMs: 58000, durationMs: 90000 } }, authHeader(owner.token));
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.deepEqual([res.body.story.music.startMs, res.body.story.music.durationMs], [30000, 30000]);
    const stories = await client.get(`/api/v1/users/${owner.username}/stories`, authHeader(viewer.token));
    assert.equal(stories.body.stories[0].music.title, "Sunny Walk");
    assert.equal(stories.body.stories[0].music.attribution, "Sunny Walk by Test Artist (CC BY 4.0)");
  });

  it("refuses a song that isn't in the catalogue", async () => {
    const owner = await signupUser();
    const mediaId = await uploadPhoto(owner.token);
    const res = await client.post("/api/v1/stories", { mediaId, caption: "", audience: "public", music: { trackId: hiddenId, startMs: 0, durationMs: 15000 } }, authHeader(owner.token));
    assert.equal(res.status, 422);
  });
});
