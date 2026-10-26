// Sharing your own Story to other apps: the overlay upload, the export job (a real ffmpeg encode),
// polling, who may ask, the daily limit and retention.
process.env.MEDIA_UPLOAD_PART_BYTES = "65536";
process.env.MEDIA_STORAGE_ROOT_TEST ??= require("node:fs").mkdtempSync(require("node:path").join(require("node:os").tmpdir(), "katkee-exports-"));

import "./env";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import type { AddressInfo } from "node:net";
import sharp from "sharp";
import { buildApp } from "../src/app";
import { query, queryOne } from "../src/db/psql";
import { mediaStorage } from "../src/modules/media/instance";
import { MediaWorker } from "../src/modules/media/worker";
import { EXPORTS_PER_DAY, expiredExports } from "../src/modules/media/exports";
import { cropRegion } from "../src/modules/media/processing";
import { authHeader, makeClient, uniqueUser } from "./helpers";
import { buildTestPng } from "./fixtures";
import { makeVideo, probe, tempDir, uploadDirect } from "./mediaHelpers";

let baseUrl: string;
let client: ReturnType<typeof makeClient>;
const server = buildApp();
const worker = new MediaWorker({ store: mediaStorage, workerId: "export-worker", concurrency: 1, leaseSeconds: 60, pollMs: 50, jobTimeoutSeconds: 120 });
const trackId = randomUUID();

before(async () => {
  await new Promise<void>((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  client = makeClient(baseUrl);
  // A real MP3 in the catalogue, as music-import makes them.
  const dir = tempDir("katkee-test-song-");
  const song = path.join(dir, "song.mp3");
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=660:sample_rate=44100", "-t", "8", "-c:a", "libmp3lame", "-b:a", "128k", song]);
  await mediaStorage.putFile(`m/${trackId}/audio.mp3`, song, "audio/mpeg");
  await query(
    `INSERT INTO music_tracks (id, title, artist, mood, duration_ms, storage_key, byte_size, license, license_url, attribution, active) VALUES
     (:'id', 'Export Song', 'Test Artist', 'Happy', 8000, :'key', :'size', 'CC BY 4.0', 'https://creativecommons.org/licenses/by/4.0/', 'Export Song by Test Artist (CC BY 4.0)', true)`,
    { id: trackId, key: `m/${trackId}/audio.mp3`, size: fs.statSync(song).size },
  );
  fs.rmSync(dir, { recursive: true, force: true });
});
after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function signup() {
  const input = uniqueUser();
  const res = await client.post("/api/v1/auth/signup", input);
  return { id: res.body.user.id as string, username: input.username, token: res.body.tokens.accessToken as string };
}
type Person = Awaited<ReturnType<typeof signup>>;

/** What the app draws: transparent, with a solid red block where the Katkee mark goes (bottom right). */
async function overlayPng(width = 720, height = 1280): Promise<Buffer> {
  const mark = await sharp({ create: { width: 160, height: 80, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } } }).png().toBuffer();
  return sharp({ create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: mark, left: width - 180, top: height - 100 }]).png().toBuffer();
}

async function uploadOverlay(token: string, bytes: Buffer, type = "image/png") {
  const res = await fetch(`${baseUrl}/api/v1/media/overlays`, { method: "POST", headers: { "Content-Type": type, ...authHeader(token) }, body: bytes });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function videoStory(owner: Person, extra: Record<string, unknown> = {}, video = makeVideo({ width: 320, height: 180, seconds: 2 })): Promise<string> {
  const uploaded = await uploadDirect(baseUrl, owner.token, video, "video", "video/mp4");
  await worker.drain();
  const res = await client.post("/api/v1/stories", { mediaId: uploaded.id, caption: "", audience: "public", allowComments: "everyone", allowSharing: true, ...extra }, authHeader(owner.token));
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.story.id;
}

async function photoStory(owner: Person): Promise<string> {
  const photo = await fetch(`${baseUrl}/api/v1/media/photos`, { method: "POST", headers: { "Content-Type": "image/png", ...authHeader(owner.token) }, body: buildTestPng(8, 8) });
  const mediaId = ((await photo.json()) as { media: { id: string } }).media.id;
  const res = await client.post("/api/v1/stories", { mediaId, caption: "", audience: "public", allowComments: "everyone", allowSharing: true }, authHeader(owner.token));
  return res.body.story.id;
}

const startExport = (who: Person, storyId: string, overlayMediaId: string | null) =>
  client.post(`/api/v1/stories/${storyId}/export`, { overlayMediaId }, authHeader(who.token));
const exportStatus = (who: Person, storyId: string, exportId: string) =>
  client.get(`/api/v1/stories/${storyId}/export/${exportId}`, authHeader(who.token));

async function download(token: string, url: string): Promise<Buffer> {
  const res = await fetch(url.startsWith("/") ? `${baseUrl}${url}` : url, { headers: authHeader(token) });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "video/mp4");
  return Buffer.from(await res.arrayBuffer());
}

/** The RGB of one pixel of the frame at `seconds`. */
async function pixelAt(video: Buffer, seconds: number, x: number, y: number): Promise<[number, number, number]> {
  const dir = tempDir("katkee-test-frame-");
  try {
    fs.writeFileSync(path.join(dir, "v.mp4"), video);
    execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-ss", String(seconds), "-i", path.join(dir, "v.mp4"), "-frames:v", "1", path.join(dir, "f.png")]);
    const { data, info } = await sharp(path.join(dir, "f.png")).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const i = (y * info.width + x) * info.channels;
    return [data[i]!, data[i + 1]!, data[i + 2]!];
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe("the overlay", () => {
  it("is a 9:16 PNG kept with its transparency, served to nobody and usable for nothing else", async () => {
    const owner = await signup();
    const up = await uploadOverlay(owner.token, await overlayPng());
    assert.equal(up.status, 201, JSON.stringify(up.body));
    assert.deepEqual([up.body.overlay.width, up.body.overlay.height], [720, 1280]);
    const row = await queryOne(`SELECT storage_key, export_overlay, mime_type, status FROM media WHERE id = :'id'`, { id: up.body.overlay.id });
    assert.deepEqual([row!.export_overlay, row!.mime_type, row!.status], ["t", "image/png", "ready"]);
    const dir = tempDir("katkee-test-overlay-");
    await mediaStorage.downloadToFile(row!.storage_key!, path.join(dir, "o.png"), 10_000_000);
    const meta = await sharp(path.join(dir, "o.png")).metadata();
    assert.equal(meta.hasAlpha, true, "the transparency survives");
    fs.rmSync(dir, { recursive: true, force: true });

    assert.equal((await client.get(`/api/v1/media/${up.body.overlay.id}`, authHeader(owner.token))).status, 404, "not even its owner can fetch it");
    assert.equal((await client.get(`/api/v1/media/${up.body.overlay.id}/file`, authHeader(owner.token))).status, 404);
    const asStory = await client.post("/api/v1/stories", { mediaId: up.body.overlay.id, caption: "", audience: "public", allowComments: "everyone", allowSharing: true }, authHeader(owner.token));
    assert.equal(asStory.status, 404, "never a Story");
    assert.equal((await client.patch("/api/v1/users/me", { avatarMediaId: up.body.overlay.id }, authHeader(owner.token))).status, 400, "never an avatar");

    assert.equal((await uploadOverlay(owner.token, await overlayPng(720, 720))).status, 422, "not 9:16");
    assert.equal((await uploadOverlay(owner.token, await overlayPng(2160, 3840))).status, 422, "too large");
    assert.equal((await uploadOverlay(owner.token, await sharp(await overlayPng()).jpeg().toBuffer(), "image/jpeg")).status, 415);
    assert.equal((await uploadOverlay(owner.token, await sharp(await overlayPng()).jpeg().toBuffer())).status, 415, "a JPEG sent as PNG");
    assert.equal((await fetch(`${baseUrl}/api/v1/media/overlays`, { method: "POST", headers: { "Content-Type": "image/png" }, body: await overlayPng() })).status, 401);
  });
});

describe("a video Story shared to other apps", () => {
  it("is put together as an H.264/AAC MP4 at 720p: framed like the Story, the overlay on top, its sound and song mixed", async () => {
    const owner = await signup();
    const storyId = await videoStory(owner, { crop: { zoom: 2, offsetX: 1, offsetY: 0 }, music: { trackId, startMs: 1000, durationMs: 5000 } });
    const overlay = (await uploadOverlay(owner.token, await overlayPng())).body.overlay.id as string;
    const started = await startExport(owner, storyId, overlay);
    assert.equal(started.status, 202, JSON.stringify(started.body));
    assert.equal(started.body.export.status, "processing");
    const exportId = started.body.export.id as string;
    assert.equal((await exportStatus(owner, storyId, exportId)).body.export.status, "processing");

    await worker.drain();
    const ready = (await exportStatus(owner, storyId, exportId)).body.export;
    assert.equal(ready.status, "ready", JSON.stringify(ready));
    assert.ok(Date.parse(ready.expiresAt) - Date.now() > 23 * 3600 * 1000);
    const bytes = await download(owner.token, ready.url);
    const info = probe(bytes);
    const video = info.streams.find((s) => s.codec_type === "video") as { codec_name?: string; width?: number; height?: number };
    const audio = info.streams.find((s) => s.codec_type === "audio") as { codec_name?: string } | undefined;
    assert.deepEqual([video.codec_name, video.width, video.height], ["h264", 720, 1280]);
    assert.equal(audio?.codec_name, "aac");
    assert.ok(bytes.indexOf("moov") < bytes.indexOf("mdat"), "faststart: the index comes first");
    // The mark the app drew is in every frame.
    const [r, g, b] = await pixelAt(bytes, 1.5, 720 - 100, 1280 - 60);
    assert.ok(r > 200 && g < 60 && b < 60, `overlay composited: ${r},${g},${b}`);
    // The overlay has done its job.
    assert.equal(await queryOne(`SELECT id FROM media WHERE id = :'id'`, { id: overlay }), null);
  });

  it("leaves out the video's own sound when the creator muted it, and needs no overlay", async () => {
    const owner = await signup();
    const storyId = await videoStory(owner, { audioMuted: true });
    const started = await startExport(owner, storyId, null);
    assert.equal(started.status, 202);
    await worker.drain();
    const ready = (await exportStatus(owner, storyId, started.body.export.id)).body.export;
    assert.equal(ready.status, "ready");
    const info = probe(await download(owner.token, ready.url));
    assert.equal(info.streams.filter((s) => s.codec_type === "audio").length, 0);
  });

  it("frames a crop the way the app shows it", () => {
    assert.deepEqual(cropRegion({ zoom: 1, offsetX: 0, offsetY: 0 }), { width: 720, height: 1280, x: 0, y: 0 });
    assert.deepEqual(cropRegion({ zoom: 2, offsetX: 0, offsetY: 0 }), { width: 360, height: 640, x: 180, y: 320 });
    // Panned all the way right shows the left edge, and all the way down the top.
    assert.deepEqual(cropRegion({ zoom: 2, offsetX: 1, offsetY: 1 }), { width: 360, height: 640, x: 0, y: 0 });
    assert.deepEqual(cropRegion({ zoom: 2, offsetX: -1, offsetY: -1 }), { width: 360, height: 640, x: 360, y: 640 });
    assert.deepEqual(cropRegion({ zoom: 9, offsetX: 5, offsetY: Number.NaN }), cropRegion({ zoom: 4, offsetX: 1, offsetY: 0 }));
  });

  it("reports a failure calmly, after one retry", async () => {
    const owner = await signup();
    const storyId = await videoStory(owner);
    const media = await queryOne(`SELECT m.variants FROM stories s JOIN media m ON m.id = s.media_id WHERE s.id = :'id'`, { id: storyId });
    const keys = Object.values(JSON.parse(media!.variants!) as Record<string, { key: string }>).map((v) => v.key);
    await mediaStorage.deleteObjects(keys);
    const started = await startExport(owner, storyId, null);
    await worker.drain();
    const failed = (await exportStatus(owner, storyId, started.body.export.id)).body.export;
    assert.deepEqual([failed.status, failed.error, failed.url], ["failed", "We couldn't prepare this video. Try again.", undefined]);
    const row = await queryOne(`SELECT attempts, last_error FROM story_exports WHERE id = :'id'`, { id: started.body.export.id });
    assert.equal(row!.attempts, "2");
    assert.ok(row!.last_error);
  });
});

describe("who may ask", () => {
  it("only the owner, only for a video Story that isn't deleted, and only with their own overlay", async () => {
    const [owner, stranger] = await Promise.all([signup(), signup()]);
    const storyId = await videoStory(owner);
    const overlay = (await uploadOverlay(owner.token, await overlayPng())).body.overlay.id as string;
    const strangersOverlay = (await uploadOverlay(stranger.token, await overlayPng())).body.overlay.id as string;

    assert.equal((await startExport(stranger, storyId, null)).status, 404, "someone else's Story");
    assert.equal((await startExport(owner, randomUUID(), null)).status, 404);
    assert.equal((await client.post(`/api/v1/stories/not-a-uuid/export`, {}, authHeader(owner.token))).status, 404);
    assert.equal((await startExport(owner, storyId, strangersOverlay)).status, 404, "someone else's overlay");
    assert.equal((await startExport(owner, storyId, randomUUID())).status, 404);
    assert.equal((await client.post(`/api/v1/stories/${storyId}/export`, { overlayMediaId: 42 }, authHeader(owner.token))).status, 422);
    const photo = await fetch(`${baseUrl}/api/v1/media/photos`, { method: "POST", headers: { "Content-Type": "image/png", ...authHeader(owner.token) }, body: buildTestPng(8, 8) });
    const ordinary = ((await photo.json()) as { media: { id: string } }).media.id;
    assert.equal((await startExport(owner, storyId, ordinary)).status, 422, "an ordinary photo isn't an overlay");
    assert.equal((await startExport(owner, await photoStory(owner), overlay)).status, 422, "photos are done on the phone");

    const first = await startExport(owner, storyId, overlay);
    assert.equal(first.status, 202);
    assert.equal((await startExport(owner, storyId, overlay)).status, 409, "one export per overlay");
    assert.equal((await exportStatus(stranger, storyId, first.body.export.id)).status, 404, "a stranger can't poll it");
    assert.equal((await client.get(`/api/v1/stories/${storyId}/export/${first.body.export.id}/file`, authHeader(stranger.token))).status, 404);
    assert.equal((await exportStatus(owner, storyId, randomUUID())).status, 404);

    // An expired (archived) Story of your own can still be shared; a deleted one can't.
    await query(`UPDATE stories SET expires_at = now() - interval '1 hour' WHERE id = :'id'`, { id: storyId });
    assert.equal((await startExport(owner, storyId, null)).status, 202);
    assert.equal((await client.delete(`/api/v1/stories/${storyId}`, authHeader(owner.token))).status, 204);
    assert.equal((await startExport(owner, storyId, null)).status, 404);
    assert.equal((await exportStatus(owner, storyId, first.body.export.id)).status, 404, "nor polled once deleted");
    await worker.drain();
    const outcomes = await query(`SELECT status, error FROM story_exports WHERE story_id = :'id'`, { id: storyId });
    assert.ok(outcomes.every((o) => o.status === "failed" && o.error === "This Story is no longer available."), JSON.stringify(outcomes));
  });

  it(`allows ${EXPORTS_PER_DAY} a day`, async () => {
    const owner = await signup();
    const storyId = await videoStory(owner, {}, makeVideo({ width: 160, height: 90, seconds: 1, audio: false }));
    for (let i = 0; i < EXPORTS_PER_DAY; i++) assert.equal((await startExport(owner, storyId, null)).status, 202);
    const limited = await startExport(owner, storyId, null);
    assert.equal(limited.status, 429);
    assert.match(limited.body.error?.message ?? limited.body.message ?? JSON.stringify(limited.body), /shared a lot of videos today/);
    // Not encoded here: the job itself is covered above.
    await query(`UPDATE story_exports SET status = 'failed', error = 'skipped' WHERE owner_id = :'owner'`, { owner: owner.id });
  });
});

describe("retention", () => {
  it("deletes a prepared video and its record once it expires", async () => {
    const owner = await signup();
    const storyId = await videoStory(owner, {}, makeVideo({ width: 160, height: 90, seconds: 1, audio: false }));
    const started = await startExport(owner, storyId, null);
    await worker.drain();
    const id = started.body.export.id as string;
    const row = await queryOne(`SELECT storage_key FROM story_exports WHERE id = :'id' AND status = 'ready'`, { id });
    assert.ok(row?.storage_key);
    assert.ok(await mediaStorage.head(row.storage_key));
    assert.equal(await expiredExports(mediaStorage, 100), 0, "nothing before it expires");
    await query(`UPDATE story_exports SET expires_at = now() - interval '1 minute' WHERE id = :'id'`, { id });
    assert.equal((await exportStatus(owner, storyId, id)).status, 404, "an expired export is gone for the app at once");
    assert.ok((await expiredExports(mediaStorage, 100)) >= 1);
    assert.equal(await mediaStorage.head(row.storage_key), null);
    assert.equal(await queryOne(`SELECT id FROM story_exports WHERE id = :'id'`, { id }), null);
  });

  it("removes an overlay nobody used with the other unused media", async () => {
    const owner = await signup();
    const overlay = (await uploadOverlay(owner.token, await overlayPng())).body.overlay.id as string;
    await query(`UPDATE media SET created_at = now() - interval '3 days' WHERE id = :'id'`, { id: overlay });
    const { unusedMedia } = await import("../src/modules/media/retention");
    await unusedMedia(mediaStorage, 1000, 48);
    assert.equal(await queryOne(`SELECT id FROM media WHERE id = :'id'`, { id: overlay }), null);
  });
});
