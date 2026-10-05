// Small parts so ordinary test files span several (the local store has no 5 MiB minimum).
process.env.MEDIA_UPLOAD_PART_BYTES = "65536";
process.env.MEDIA_MAX_OPEN_UPLOADS = "3";
process.env.MEDIA_MAX_VIDEO_SECONDS = "3";
process.env.MEDIA_STORAGE_ROOT_TEST ??= require("node:fs").mkdtempSync(require("node:path").join(require("node:os").tmpdir(), "katkee-pipeline-"));

import "./env";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { AddressInfo } from "node:net";
import sharp from "sharp";
import { buildApp } from "../src/app";
import { query, queryOne } from "../src/db/psql";
import { mediaStorage } from "../src/modules/media/instance";
import { localPartSignature } from "../src/modules/media/storage";
import { MediaWorker, processClaimedJob } from "../src/modules/media/worker";
import { claimMediaJob } from "../src/modules/media/jobs";
import { authHeader, makeClient, uniqueUser } from "./helpers";
import { buildTestPng } from "./fixtures";
import {
  clientUploadId, completeUpload, createUploadSession, jpegWithGps, makeVideo, probe, putPart, uploadDirect, type UploadPlanPart,
} from "./mediaHelpers";

let baseUrl: string;
let client: ReturnType<typeof makeClient>;
const server = buildApp();
const storageRoot = process.env.MEDIA_STORAGE_ROOT as string;
const worker = new MediaWorker({ store: mediaStorage, workerId: "test-worker", concurrency: 1, leaseSeconds: 60, pollMs: 50, jobTimeoutSeconds: 120 });

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
  return { username: input.username, token: res.body.tokens.accessToken as string };
}

async function media(token: string, id: string) {
  return client.get(`/api/v1/media/${id}`, authHeader(token));
}

async function fileBytes(token: string, url: string): Promise<{ status: number; type: string | null; bytes: Buffer }> {
  const res = await fetch(url.startsWith("/") ? `${baseUrl}${url}` : url, { headers: authHeader(token) });
  return { status: res.status, type: res.headers.get("content-type"), bytes: Buffer.from(await res.arrayBuffer()) };
}

const storyBody = (mediaId: string, extra: Record<string, unknown> = {}) =>
  ({ mediaId, caption: "", audience: "public", allowComments: "everyone", allowSharing: true, ...extra });

const requestId = () => `pub_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;

/** A noisy JPEG (realistic size) with GPS EXIF and an orientation tag. */
async function photoWithGps(width: number, height: number, orientation: number): Promise<Buffer> {
  const noisy = await sharp({ create: { width, height, channels: 3, background: "#000000", noise: { type: "gaussian", mean: 128, sigma: 40 } } }).png().toBuffer();
  const base = await jpegWithGps(width, height, orientation);
  const gpsExif = (await sharp(base).metadata()).exif;
  assert.ok(gpsExif && gpsExif.includes(Buffer.from("KatkeeTestCam")), "fixture carries camera EXIF");
  return sharp(noisy).jpeg({ quality: 92 }).withMetadata({ orientation }).withExif({
    IFD0: { Make: "KatkeeTestCam", Copyright: "private" },
    IFD3: { GPSLatitudeRef: "N", GPSLatitude: "12/1 58/1 17/1", GPSLongitudeRef: "E", GPSLongitude: "77/1 35/1 40/1" },
  }).toBuffer();
}

describe("direct uploads", () => {
  it("uploads a photo in signed parts, then processing applies orientation and strips EXIF/GPS", async () => {
    const owner = await signup();
    const bytes = await photoWithGps(640, 480, 6);
    assert.ok((await sharp(bytes).metadata()).exif, "the original carries EXIF");

    const created = await createUploadSession(baseUrl, owner.token, { clientUploadId: clientUploadId(), kind: "photo", mimeType: "image/jpeg", byteSize: bytes.length });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.equal(created.body.media.status, "uploading");
    const parts = created.body.upload.parts as UploadPlanPart[];
    assert.ok(parts.length > 1, `expected several parts, got ${parts.length}`);
    assert.equal(parts.reduce((n, p) => n + p.byteLength, 0), bytes.length);
    for (const part of parts) {
      assert.ok(part.url?.startsWith(`/api/v1/media/uploads/${created.body.media.id}/parts/${part.partNumber}?`));
      const res = await putPart(baseUrl, part, bytes, created.body.upload.partSize);
      assert.equal(res.status, 200);
      assert.match(res.headers.get("etag") ?? "", /^"[0-9a-f]{32}"$/);
    }
    const done = await completeUpload(baseUrl, owner.token, created.body.media.id);
    assert.equal(done.status, 200, JSON.stringify(done.body));
    assert.equal(done.body.media.status, "processing");
    assert.equal(done.body.media.delivery.imageUrl, null, "nothing to show until processed");

    assert.ok((await worker.drain()) >= 1);
    const ready = await media(owner.token, created.body.media.id);
    assert.equal(ready.body.media.status, "ready");
    assert.equal(ready.body.media.width, 480, "orientation 6 makes it portrait");
    assert.equal(ready.body.media.height, 640);
    const display = await fileBytes(owner.token, ready.body.media.delivery.imageUrl);
    assert.equal(display.type, "image/jpeg");
    const meta = await sharp(display.bytes).metadata();
    assert.deepEqual([meta.width, meta.height, meta.exif, meta.orientation], [480, 640, undefined, undefined]);
    const thumb = await sharp((await fileBytes(owner.token, ready.body.media.delivery.thumbnailUrl)).bytes).metadata();
    assert.deepEqual([thumb.width, thumb.height, thumb.exif], [360, 480, undefined]);

    const original = await fileBytes(owner.token, `/api/v1/media/${created.body.media.id}/file?variant=original`);
    assert.ok(original.bytes.equals(bytes), "the owner can still download the exact original");
    const row = await queryOne(`SELECT checksum_sha256, variants FROM media WHERE id = :'id'`, { id: created.body.media.id });
    assert.equal(row?.checksum_sha256, createHash("sha256").update(bytes).digest("hex"));
    const variants = JSON.parse(row!.variants as string);
    assert.deepEqual(Object.keys(variants).sort(), ["display", "thumbnail"]);
    assert.ok(fs.existsSync(path.join(storageRoot, ...variants.display.key.split("/"))));
  });

  it("resumes: reports the parts that arrived, re-issues URLs for the rest, and refuses to complete early", async () => {
    const owner = await signup();
    const bytes = await photoWithGps(800, 600, 1);
    const created = await createUploadSession(baseUrl, owner.token, { clientUploadId: clientUploadId(), kind: "photo", mimeType: "image/jpeg", byteSize: bytes.length });
    const id = created.body.media.id as string;
    const partSize = created.body.upload.partSize as number;
    const [first] = created.body.upload.parts as UploadPlanPart[];
    assert.equal((await putPart(baseUrl, first!, bytes, partSize)).status, 200);

    const early = await completeUpload(baseUrl, owner.token, id);
    assert.equal(early.status, 409);
    const missing = String(early.body.fields.missingParts).split(",").map(Number);
    assert.deepEqual(missing, Array.from({ length: created.body.upload.partCount - 1 }, (_, i) => i + 2));

    const resumed = await client.get(`/api/v1/media/uploads/${id}`, authHeader(owner.token));
    assert.equal(resumed.status, 200);
    const resumedParts = resumed.body.upload.parts as UploadPlanPart[];
    assert.deepEqual([resumedParts[0]!.uploaded, resumedParts[0]!.url], [true, null]);
    for (const part of resumedParts.filter((p) => !p.uploaded)) assert.equal((await putPart(baseUrl, part, bytes, partSize)).status, 200);
    const done = await completeUpload(baseUrl, owner.token, id);
    assert.equal(done.status, 200);
    const again = await completeUpload(baseUrl, owner.token, id);
    assert.equal(again.status, 200, "completing twice is harmless");
    assert.equal(again.body.media.status, "processing");
    assert.equal((await client.get(`/api/v1/media/uploads/${id}`, authHeader(owner.token))).body.upload, null);
    await worker.drain();
  });

  it("creating is idempotent per outbox id and refuses a different file under the same id", async () => {
    const owner = await signup();
    const input = { clientUploadId: clientUploadId(), kind: "photo", mimeType: "image/png", byteSize: 1234 };
    const first = await createUploadSession(baseUrl, owner.token, input);
    const second = await createUploadSession(baseUrl, owner.token, input);
    assert.deepEqual([first.status, second.status], [201, 200]);
    assert.equal(second.body.media.id, first.body.media.id);
    assert.equal((await createUploadSession(baseUrl, owner.token, { ...input, byteSize: 999 })).status, 409);
    await client.post(`/api/v1/media/uploads/${first.body.media.id}/abort`, undefined, authHeader(owner.token));
  });

  it("binds each part URL to its part, length and expiry; an aborted upload accepts nothing", async () => {
    const owner = await signup();
    const bytes = await photoWithGps(800, 600, 1);
    const created = await createUploadSession(baseUrl, owner.token, { clientUploadId: clientUploadId(), kind: "photo", mimeType: "image/jpeg", byteSize: bytes.length });
    const id = created.body.media.id as string;
    const [p1, p2] = created.body.upload.parts as UploadPlanPart[];
    const partSize = created.body.upload.partSize as number;
    const put = (url: string, body: Buffer) => fetch(`${baseUrl}${url}`, { method: "PUT", body });

    const tampered = p1!.url!.replace(/signature=([0-9a-f])/, (_m, c: string) => `signature=${c === "0" ? "1" : "0"}`);
    assert.equal((await put(tampered, bytes.subarray(0, p1!.byteLength))).status, 403);
    assert.equal((await put(p1!.url!.replace(`/parts/1?`, `/parts/2?`), bytes.subarray(partSize, partSize + p2!.byteLength))).status, 403, "a URL signed for part 1 cannot write part 2");
    assert.equal((await put(p1!.url!.replace(`length=${p1!.byteLength}`, `length=${p1!.byteLength + 1}`), bytes.subarray(0, p1!.byteLength + 1))).status, 403);
    assert.equal((await put(p1!.url!, bytes.subarray(0, p1!.byteLength - 1))).status, 400, "short body");
    const past = Math.floor(Date.now() / 1000) - 5;
    const expired = `/api/v1/media/uploads/${id}/parts/1?length=${p1!.byteLength}&expires=${past}&signature=${localPartSignature(id, 1, p1!.byteLength, past)}`;
    assert.equal((await put(expired, bytes.subarray(0, p1!.byteLength))).status, 403);
    assert.equal((await put(p1!.url!, bytes.subarray(0, p1!.byteLength))).status, 200);

    const session = await queryOne(`SELECT multipart_upload_id FROM media_upload_sessions WHERE media_id = :'id'`, { id });
    const scratch = path.join(storageRoot, ".multipart", session!.multipart_upload_id as string);
    assert.ok(fs.existsSync(path.join(scratch, "1.part")), "part 1 was stored");
    const aborted = await client.post(`/api/v1/media/uploads/${id}/abort`, undefined, authHeader(owner.token));
    assert.equal(aborted.status, 204);
    assert.equal((await put(p2!.url!, bytes.subarray(partSize, partSize + p2!.byteLength))).status, 409);
    assert.equal((await client.get(`/api/v1/media/uploads/${id}`, authHeader(owner.token))).status, 404);
    assert.equal((await media(owner.token, id)).status, 404);
    assert.equal(fs.existsSync(scratch), false, "abort removes the stored parts");
    const sessionRow = await queryOne(`SELECT count(*) AS n FROM media_upload_sessions WHERE media_id = :'id'`, { id });
    assert.equal(sessionRow?.n, "0");
  });

  it("answers 410 when storage dropped the upload, and a retried create starts afresh", async () => {
    const owner = await signup();
    const input = { clientUploadId: clientUploadId(), kind: "photo", mimeType: "image/jpeg", byteSize: 5000 };
    const created = await createUploadSession(baseUrl, owner.token, input);
    const id = created.body.media.id as string;
    const session = await queryOne(`SELECT multipart_upload_id FROM media_upload_sessions WHERE media_id = :'id'`, { id });
    await mediaStorage.abortMultipartUpload(`m/${id}/original`, session!.multipart_upload_id as string); // e.g. a bucket lifecycle rule
    assert.equal((await client.get(`/api/v1/media/uploads/${id}`, authHeader(owner.token))).status, 410);
    assert.equal((await completeUpload(baseUrl, owner.token, id)).status, 410);
    const again = await createUploadSession(baseUrl, owner.token, input);
    assert.equal(again.status, 201, JSON.stringify(again.body));
    assert.notEqual(again.body.media.id, id, "a new upload");
    assert.equal(await queryOne(`SELECT id FROM media WHERE id = :'id'`, { id }), null, "the dead one is gone");
  });

  it("validates type, size and the number of open uploads", async () => {
    const owner = await signup();
    const create = (input: Record<string, unknown>) => createUploadSession(baseUrl, owner.token, { clientUploadId: clientUploadId(), kind: "photo", mimeType: "image/jpeg", byteSize: 100, ...input });
    assert.equal((await create({ mimeType: "image/heic" })).status, 415);
    assert.match((await create({ mimeType: "image/heic" })).body.message, /HEIC/);
    assert.equal((await create({ kind: "video", mimeType: "video/x-msvideo" })).status, 415);
    assert.equal((await create({ byteSize: 26 * 1024 * 1024 })).status, 413);
    assert.equal((await create({ kind: "video", mimeType: "video/mp4", byteSize: 201 * 1024 * 1024 })).status, 413);
    assert.equal((await create({ byteSize: 0 })).status, 422);
    assert.equal((await create({ clientUploadId: "short" })).status, 422);
    assert.equal((await fetch(`${baseUrl}/api/v1/media/uploads`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).status, 401);

    const open = [await create({}), await create({}), await create({})];
    assert.deepEqual(open.map((r) => r.status), [201, 201, 201]);
    const fourth = await create({});
    assert.equal(fourth.status, 429);
    await client.post(`/api/v1/media/uploads/${open[0]!.body.media.id}/abort`, undefined, authHeader(owner.token));
    assert.equal((await create({})).status, 201);
  });

  it("keeps uploads and unpublished media private to their owner", async () => {
    const owner = await signup();
    const other = await signup();
    const created = await createUploadSession(baseUrl, owner.token, { clientUploadId: clientUploadId(), kind: "photo", mimeType: "image/png", byteSize: 100 });
    const id = created.body.media.id as string;
    assert.equal((await client.get(`/api/v1/media/uploads/${id}`, authHeader(other.token))).status, 404);
    assert.equal((await completeUpload(baseUrl, other.token, id)).status, 404);
    assert.equal((await client.post(`/api/v1/media/uploads/${id}/abort`, undefined, authHeader(other.token))).status, 404);
    assert.equal((await client.post("/api/v1/stories", storyBody(id, { requestId: requestId() }), authHeader(other.token))).status, 404);
    assert.equal((await media(other.token, id)).status, 404);
    assert.equal((await client.post("/api/v1/stories", storyBody(id, { requestId: requestId() }), authHeader(owner.token))).status, 409, "still uploading");
    assert.match((await client.post("/api/v1/stories", storyBody(id, { requestId: requestId() }), authHeader(owner.token))).body.message, /Finish uploading/);
  });
});

describe("processing", () => {
  it("turns a rotated phone video into portrait renditions and a poster, without location metadata", async () => {
    const owner = await signup();
    const bytes = makeVideo({ width: 640, height: 360, seconds: 1, rotation: 90, location: "+12.9716+077.5946/", container: "mov" });
    assert.equal(probe(bytes).format.tags?.location, "+12.9716+077.5946/", "fixture carries a location tag");
    const uploaded = await uploadDirect(baseUrl, owner.token, bytes, "video", "video/quicktime");
    await worker.drain();
    const ready = (await media(owner.token, uploaded.id)).body.media;
    assert.equal(ready.status, "ready", ready.processingError);
    assert.deepEqual([ready.width, ready.height], [360, 640]);
    assert.ok(Math.abs(ready.durationMs - 1000) < 150, String(ready.durationMs));
    assert.equal(ready.delivery.videos.length, 1, "a 360p source gets one rendition at its own size");
    const video = await fileBytes(owner.token, ready.delivery.videos[0].url);
    assert.equal(video.type, "video/mp4");
    const info = probe(video.bytes);
    assert.equal(info.format.tags?.location, undefined, "location stripped");
    const stream = info.streams.find((s) => s.codec_type === "video")!;
    assert.deepEqual([stream.width, stream.height], [360, 640]);
    assert.ok(!(stream.side_data_list ?? []).some((d) => d.rotation), "no rotation left to apply");
    assert.ok(info.streams.some((s) => s.codec_type === "audio"), "audio kept");
    const poster = await sharp((await fileBytes(owner.token, ready.delivery.imageUrl)).bytes).metadata();
    assert.deepEqual([poster.width, poster.height, poster.exif], [360, 640, undefined]);
  });

  it("makes 720p and 480p renditions of larger videos and tone-maps HDR to SDR", async () => {
    const owner = await signup();
    const uploaded = await uploadDirect(baseUrl, owner.token, makeVideo({ width: 1280, height: 720, seconds: 1, hdr: true, audio: false }), "video", "video/mp4");
    await worker.drain();
    const ready = (await media(owner.token, uploaded.id)).body.media;
    assert.equal(ready.status, "ready", ready.processingError);
    assert.deepEqual(ready.delivery.videos.map((v: { variant: string; width: number; height: number }) => [v.variant, v.width, v.height]), [["video_720", 1280, 720], ["video_480", 854, 480]]);
    for (const v of ready.delivery.videos) {
      const s = probe((await fileBytes(owner.token, v.url)).bytes).streams.find((x) => x.codec_type === "video")!;
      assert.equal(s.color_transfer, "bt709");
    }
  });

  it("rejects files that are not what they claim, permanently and with a clear reason", async () => {
    const owner = await signup();
    const fakeVideo = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypisom"), Buffer.alloc(4), Buffer.from("isomiso2"), Buffer.alloc(4000, 7)]);
    const a = await uploadDirect(baseUrl, owner.token, fakeVideo, "video", "video/mp4");
    const b = await uploadDirect(baseUrl, owner.token, buildTestPng(40, 30), "photo", "image/jpeg");
    const c = await uploadDirect(baseUrl, owner.token, makeVideo({ width: 160, height: 90, seconds: 5, audio: false }), "video", "video/mp4");
    await worker.drain();
    const [ma, mb, mc] = await Promise.all([a, b, c].map(async (m) => (await media(owner.token, m.id)).body.media));
    assert.deepEqual([ma.status, ma.retryable], ["failed", false]);
    assert.match(ma.processingError, /couldn't read this video/);
    assert.match(mb.processingError, /isn't the type it claims/);
    assert.match(mc.processingError, /up to 3 seconds/);
    assert.equal((await client.post(`/api/v1/media/${a.id}/retry-processing`, undefined, authHeader(owner.token))).status, 409);
  });

  it("retries transient failures with backoff, then lets the owner retry once they're resolved", async () => {
    const owner = await signup();
    const bytes = await photoWithGps(300, 200, 1);
    const uploaded = await uploadDirect(baseUrl, owner.token, bytes, "photo", "image/jpeg");
    const key = `m/${uploaded.id}/original`;
    await mediaStorage.deleteObjects([key]); // storage hiccup: the worker can't read the original

    await worker.drain();
    let job = await queryOne(`SELECT status, attempts, run_after > now() AS later, last_error FROM media_jobs WHERE media_id = :'id'`, { id: uploaded.id });
    assert.deepEqual([job?.status, job?.attempts, job?.later], ["queued", "1", "t"], "requeued with a delay");
    assert.equal((await media(owner.token, uploaded.id)).body.media.status, "processing");
    for (let attempt = 2; attempt <= 3; attempt++) {
      await query(`UPDATE media_jobs SET run_after = now() WHERE media_id = :'id' AND status = 'queued'`, { id: uploaded.id });
      await worker.drain();
    }
    job = await queryOne(`SELECT status, attempts FROM media_jobs WHERE media_id = :'id' ORDER BY id DESC LIMIT 1`, { id: uploaded.id });
    assert.deepEqual([job?.status, job?.attempts], ["failed", "3"]);
    const failed = (await media(owner.token, uploaded.id)).body.media;
    assert.deepEqual([failed.status, failed.retryable], ["failed", true]);

    const restore = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "katkee-restore-")), "original");
    fs.writeFileSync(restore, bytes);
    await mediaStorage.putFile(key, restore, "image/jpeg");
    const retried = await client.post(`/api/v1/media/${uploaded.id}/retry-processing`, undefined, authHeader(owner.token));
    assert.equal(retried.status, 200);
    assert.equal(retried.body.media.status, "processing");
    await worker.drain();
    assert.equal((await media(owner.token, uploaded.id)).body.media.status, "ready");
  });

  it("picks up a job again after its worker died and its lease expired", async () => {
    const owner = await signup();
    const uploaded = await uploadDirect(baseUrl, owner.token, await photoWithGps(200, 200, 1), "photo", "image/jpeg");
    const lost = await claimMediaJob("crashed-worker", 1, uploaded.id);
    assert.ok(lost);
    assert.equal(await claimMediaJob("other-worker", 60, uploaded.id), null, "leased jobs are not handed out twice");
    await new Promise((r) => setTimeout(r, 1300));
    const reclaimed = await claimMediaJob("other-worker", 60, uploaded.id);
    assert.equal(reclaimed?.id, lost!.id);
    assert.equal(reclaimed?.attempts, 2);
    assert.equal(await processClaimedJob(reclaimed!, mediaStorage, { workerId: "other-worker", leaseSeconds: 60, jobTimeoutSeconds: 60 }), "done");
    assert.equal((await media(owner.token, uploaded.id)).body.media.status, "ready");
  });

  it("never lets two workers process the same job", async () => {
    const owner = await signup();
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) ids.push((await uploadDirect(baseUrl, owner.token, await photoWithGps(200 + i, 150, 1), "photo", "image/jpeg")).id);
    const second = new MediaWorker({ store: mediaStorage, workerId: "second-worker", concurrency: 1, leaseSeconds: 60, pollMs: 50, jobTimeoutSeconds: 60 });
    await Promise.all([worker.drain(), second.drain(), worker.drain()]);
    const rows = await query(`SELECT media_id, status, attempts FROM media_jobs WHERE media_id = ANY (string_to_array(:'ids', ',')::uuid[])`, { ids: ids.join(",") });
    assert.equal(rows.length, 4, "one job per media");
    assert.ok(rows.every((r) => r.status === "done" && r.attempts === "1"), JSON.stringify(rows));
  });
});

describe("publishing while media processes", () => {
  it("publishes the moment processing finishes, and the 24-hour clock starts then", async () => {
    const owner = await signup();
    const uploaded = await uploadDirect(baseUrl, owner.token, makeVideo({ width: 320, height: 180, seconds: 1 }), "video", "video/mp4");
    const rid = requestId();
    const requestedAt = Date.now();
    const first = await client.post("/api/v1/stories", storyBody(uploaded.id, { requestId: rid, caption: "later" }), authHeader(owner.token));
    assert.equal(first.status, 202, JSON.stringify(first.body));
    assert.deepEqual(first.body.publish, { state: "processing", requestId: rid, mediaId: uploaded.id });
    assert.equal((await client.post("/api/v1/stories", storyBody(uploaded.id, { requestId: rid, caption: "later" }), authHeader(owner.token))).status, 202, "retries are idempotent");
    assert.equal((await client.post("/api/v1/stories", storyBody(uploaded.id, { requestId: rid, caption: "changed" }), authHeader(owner.token))).status, 409);
    assert.equal((await client.post("/api/v1/stories", storyBody(uploaded.id, { requestId: requestId() }), authHeader(owner.token))).status, 409, "one Story per media");
    assert.equal((await client.get(`/api/v1/stories/publish-requests/${rid}`, authHeader(owner.token))).body.publish.state, "processing");
    assert.equal((await client.get("/api/v1/stories/mine/active", authHeader(owner.token))).body.stories.length, 0);

    await new Promise((r) => setTimeout(r, 50));
    await worker.drain();
    const status = (await client.get(`/api/v1/stories/publish-requests/${rid}`, authHeader(owner.token))).body.publish;
    assert.equal(status.state, "published");
    const story = (await client.get(`/api/v1/stories/${status.storyId}`, authHeader(owner.token))).body.story;
    assert.equal(story.caption, "later");
    assert.ok(Date.parse(story.createdAt) > requestedAt, "published when processing finished, not when requested");
    assert.equal(Date.parse(story.expiresAt) - Date.parse(story.createdAt), 24 * 3600 * 1000);
    assert.equal(story.media.status, "ready");
    assert.ok(story.media.videos.length >= 1 && story.media.imageUrl && story.media.thumbnailUrl);
    const replay = await client.post("/api/v1/stories", storyBody(uploaded.id, { requestId: rid, caption: "later" }), authHeader(owner.token));
    assert.deepEqual([replay.status, replay.body.story.id], [201, status.storyId]);
  });

  it("fails a waiting publish when processing fails, and re-arms it after a successful retry", async () => {
    const owner = await signup();
    const fake = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypisom"), Buffer.alloc(4), Buffer.from("isomiso2"), Buffer.alloc(2000, 3)]);
    const broken = await uploadDirect(baseUrl, owner.token, fake, "video", "video/mp4");
    const rid = requestId();
    assert.equal((await client.post("/api/v1/stories", storyBody(broken.id, { requestId: rid }), authHeader(owner.token))).status, 202);
    await worker.drain();
    const status = (await client.get(`/api/v1/stories/publish-requests/${rid}`, authHeader(owner.token))).body.publish;
    assert.deepEqual([status.state, status.retryable], ["failed", false]);
    assert.match(status.error, /couldn't read this video/);
    const again = await client.post("/api/v1/stories", storyBody(broken.id, { requestId: rid }), authHeader(owner.token));
    assert.deepEqual([again.status, again.body.error, again.body.retryable], [422, "media_failed", false]);

    const bytes = await photoWithGps(320, 240, 1);
    const flaky = await uploadDirect(baseUrl, owner.token, bytes, "photo", "image/jpeg");
    await query(`UPDATE media_jobs SET max_attempts = 1 WHERE media_id = :'id'`, { id: flaky.id });
    await mediaStorage.deleteObjects([`m/${flaky.id}/original`]);
    const rid2 = requestId();
    assert.equal((await client.post("/api/v1/stories", storyBody(flaky.id, { requestId: rid2 }), authHeader(owner.token))).status, 202);
    await worker.drain();
    const failed = await client.post("/api/v1/stories", storyBody(flaky.id, { requestId: rid2 }), authHeader(owner.token));
    assert.deepEqual([failed.status, failed.body.retryable], [422, true]);
    const restore = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "katkee-restore-")), "original");
    fs.writeFileSync(restore, bytes);
    await mediaStorage.putFile(`m/${flaky.id}/original`, restore, "image/jpeg");
    assert.equal((await client.post(`/api/v1/media/${flaky.id}/retry-processing`, undefined, authHeader(owner.token))).status, 200);
    assert.equal((await client.post("/api/v1/stories", storyBody(flaky.id, { requestId: rid2 }), authHeader(owner.token))).status, 202, "the same request waits again");
    await worker.drain();
    assert.equal((await client.get(`/api/v1/stories/publish-requests/${rid2}`, authHeader(owner.token))).body.publish.state, "published");
  });
});

describe("delivery and legacy uploads", () => {
  it("processes legacy photo uploads before responding and serves viewers only stripped variants", async () => {
    const owner = await signup();
    const viewer = await signup();
    const bytes = await photoWithGps(500, 300, 8);
    const res = await fetch(`${baseUrl}/api/v1/media/photos`, { method: "POST", headers: { "Content-Type": "image/jpeg", ...authHeader(owner.token) }, body: bytes });
    const body = await res.json() as { media: { id: string; status: string; width: number; height: number } };
    assert.equal(res.status, 201);
    assert.deepEqual([body.media.status, body.media.width, body.media.height], ["ready", 300, 500]);
    assert.equal((await client.post("/api/v1/stories", storyBody(body.media.id), authHeader(owner.token))).status, 201);

    const stories = await client.get(`/api/v1/users/${owner.username}/stories`, authHeader(viewer.token));
    const delivery = stories.body.stories[0].media;
    assert.match(delivery.imageUrl, new RegExp(`^/api/v1/media/${body.media.id}/file\\?variant=display$`));
    const shown = await fileBytes(viewer.token, delivery.imageUrl);
    const meta = await sharp(shown.bytes).metadata();
    assert.deepEqual([shown.status, meta.width, meta.height, meta.exif], [200, 300, 500, undefined]);
    assert.ok(!shown.bytes.includes(Buffer.from("KatkeeTestCam")), "no camera metadata anywhere in the file");
    assert.equal((await fileBytes(viewer.token, `/api/v1/media/${body.media.id}/file?variant=original`)).status, 404);
    assert.equal((await fileBytes(viewer.token, `/api/v1/media/${body.media.id}/file?variant=bogus`)).status, 400);
    assert.ok((await fileBytes(owner.token, `/api/v1/media/${body.media.id}/file?variant=original`)).bytes.equals(bytes));
  });

  it("queues legacy video uploads and reports them as processing until ready", async () => {
    const owner = await signup();
    const res = await fetch(`${baseUrl}/api/v1/media/videos`, { method: "POST", headers: { "Content-Type": "video/mp4", ...authHeader(owner.token) }, body: makeVideo({ seconds: 1 }) });
    const body = await res.json() as { media: { id: string; status: string } };
    assert.deepEqual([res.status, body.media.status], [201, "processing"]);
    assert.equal((await client.post("/api/v1/stories", storyBody(body.media.id), authHeader(owner.token))).status, 409, "not publishable yet");
    await worker.drain();
    assert.equal((await media(owner.token, body.media.id)).body.media.status, "ready");
    assert.equal((await client.post("/api/v1/stories", storyBody(body.media.id), authHeader(owner.token))).status, 201);
  });

  it("keeps serving media from before the pipeline until its backfill succeeds, and stays ready if it fails", async () => {
    const owner = await signup();
    const viewer = await signup();
    const png = buildTestPng(12, 8);
    const res = await fetch(`${baseUrl}/api/v1/media/photos`, { method: "POST", headers: { "Content-Type": "image/png", ...authHeader(owner.token) }, body: png });
    const id = ((await res.json()) as { media: { id: string } }).media.id;
    assert.equal((await client.post("/api/v1/stories", storyBody(id), authHeader(owner.token))).status, 201);
    // As it was before migration 0030: ready, no variants.
    await query(`UPDATE media SET variants = '{}'::jsonb, processed_at = NULL WHERE id = :'id'`, { id });
    const legacy = await fileBytes(viewer.token, `/api/v1/media/${id}/file`);
    assert.ok(legacy.bytes.equals(png), "unprocessed legacy media keeps serving its original");

    await query(`INSERT INTO media_jobs (media_id) VALUES (:'id')`, { id });
    await worker.drain();
    const after = await fileBytes(viewer.token, `/api/v1/media/${id}/file`);
    assert.equal(after.type, "image/jpeg", "now the stripped variant");

    await query(`UPDATE media SET variants = '{}'::jsonb, processed_at = NULL, mime_type = 'image/jpeg' WHERE id = :'id'`, { id });
    await query(`INSERT INTO media_jobs (media_id) VALUES (:'id')`, { id });
    await worker.drain();
    const row = await queryOne(`SELECT status, processing_error FROM media WHERE id = :'id'`, { id });
    assert.equal(row?.status, "ready", "a failed backfill never takes published media down");
    assert.match(String(row?.processing_error), /claims/);
    assert.equal((await fileBytes(viewer.token, `/api/v1/media/${id}/file`)).status, 200);
  });

  it("hides media that is not ready from everyone but its owner", async () => {
    const owner = await signup();
    const viewer = await signup();
    const uploaded = await uploadDirect(baseUrl, owner.token, await photoWithGps(100, 100, 1), "photo", "image/jpeg");
    assert.equal((await media(viewer.token, uploaded.id)).status, 404);
    assert.equal((await fileBytes(viewer.token, `/api/v1/media/${uploaded.id}/file`)).status, 404);
    assert.equal((await media(owner.token, uploaded.id)).body.media.status, "processing");
    await worker.drain();
  });
});
