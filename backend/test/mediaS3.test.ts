// The S3 store against a real S3 implementation (Versity S3 gateway), which verifies
// AWS SigV4 signatures, signed headers and expiry exactly as Amazon S3 does.
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";

const S3_PORT = Number(execFileSync(process.execPath, ["-e",
  "const s=require('net').createServer().listen(0,'127.0.0.1',()=>{process.stdout.write(String(s.address().port));s.close()})"]).toString());
process.env.MEDIA_STORE = "s3";
process.env.MEDIA_S3_BUCKET = "katkee-media-test";
process.env.MEDIA_S3_ENDPOINT = `http://127.0.0.1:${S3_PORT}`;
process.env.MEDIA_S3_FORCE_PATH_STYLE = "true";
process.env.AWS_REGION = "ap-south-1";
process.env.AWS_ACCESS_KEY_ID = "katkeetestkey";
process.env.AWS_SECRET_ACCESS_KEY = "katkee-test-secret-not-real";
process.env.MEDIA_UPLOAD_PART_BYTES = String(5 * 1024 * 1024);

import "./env";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { spawn, type ChildProcess } from "node:child_process";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { HeadObjectCommand, ListMultipartUploadsCommand } from "@aws-sdk/client-s3";
import { buildApp } from "../src/app";
import { query, queryOne } from "../src/db/psql";
import { mediaStorage } from "../src/modules/media/instance";
import { S3ObjectStore } from "../src/modules/media/s3-store";
import { MediaWorker } from "../src/modules/media/worker";
import { deletedStoryMedia, unusedMedia } from "../src/modules/media/retention";
import { LocalObjectStore } from "../src/modules/media/storage";
import { copyLocalMediaToS3 } from "../scripts/copy-local-media-to-s3";
import { authHeader, makeClient, uniqueUser } from "./helpers";
import { clientUploadId, completeUpload, createUploadSession, jpegWithGps, makeVideo, putPart, uploadDirect, VERSITYGW_BIN, type UploadPlanPart } from "./mediaHelpers";

const available = fs.existsSync(VERSITYGW_BIN);
const skip = available ? false : `S3 test server not installed at ${VERSITYGW_BIN} (scripts/install-media-test-servers.sh)`;
const store = mediaStorage as S3ObjectStore;
const bucket = "katkee-media-test";
let s3Process: ChildProcess | null = null;
let s3Dir = "";
let baseUrl: string;
let client: ReturnType<typeof makeClient>;
const server = buildApp();
const worker = new MediaWorker({ store, workerId: "s3-test-worker", concurrency: 1, leaseSeconds: 60, pollMs: 50, jobTimeoutSeconds: 120 });

before(async () => {
  if (available) {
    s3Dir = fs.mkdtempSync(path.join(os.tmpdir(), "katkee-test-s3-"));
    fs.mkdirSync(path.join(s3Dir, bucket));
    s3Process = spawn(VERSITYGW_BIN, ["--access", process.env.AWS_ACCESS_KEY_ID!, "--secret", process.env.AWS_SECRET_ACCESS_KEY!,
      "--region", "ap-south-1", "--port", `127.0.0.1:${S3_PORT}`, "posix", s3Dir], { stdio: "ignore" });
    for (let i = 0; i < 150; i++) {
      const up = await new Promise<boolean>((resolve) => {
        const socket = net.connect(S3_PORT, "127.0.0.1", () => { socket.end(); resolve(true); });
        socket.once("error", () => resolve(false));
      });
      if (up) break;
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  await new Promise<void>((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  client = makeClient(baseUrl);
});
after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (s3Process && s3Process.exitCode === null) {
    s3Process.kill("SIGTERM");
    await new Promise((r) => s3Process!.once("exit", r));
  }
  if (s3Dir) fs.rmSync(s3Dir, { recursive: true, force: true });
});

async function signup() {
  const input = uniqueUser();
  const res = await client.post("/api/v1/auth/signup", input);
  return { username: input.username, token: res.body.tokens.accessToken as string };
}

async function head(key: string) {
  try {
    return await store.client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
  } catch (error) {
    if ((error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404) return null;
    throw error;
  }
}

describe("S3 media store", { skip }, () => {
  it("uploads a multi-part video straight to S3 with SigV4 part URLs, then processes it from S3", async () => {
    const owner = await signup();
    const bytes = makeVideo({ width: 1280, height: 720, seconds: 3, bitrate: "32M" });
    assert.ok(bytes.length > 10 * 1024 * 1024, `fixture should span 3 parts, is ${bytes.length} bytes`);
    const created = await createUploadSession(baseUrl, owner.token, { clientUploadId: clientUploadId(), kind: "video", mimeType: "video/mp4", byteSize: bytes.length });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const parts = created.body.upload.parts as UploadPlanPart[];
    assert.equal(parts.length, Math.ceil(bytes.length / (5 * 1024 * 1024)));
    for (const part of parts) {
      const url = new URL(part.url!);
      assert.equal(url.origin, `http://127.0.0.1:${S3_PORT}`, "parts go straight to storage, not through the API");
      assert.equal(url.searchParams.get("X-Amz-SignedHeaders"), "content-length;host");
      assert.equal((await putPart(baseUrl, part, bytes, created.body.upload.partSize)).status, 200);
    }
    const done = await completeUpload(baseUrl, owner.token, created.body.media.id);
    assert.equal(done.status, 200, JSON.stringify(done.body));
    const id = created.body.media.id as string;
    assert.equal(Number((await head(`m/${id}/original`))?.ContentLength), bytes.length);

    await worker.drain();
    const ready = (await client.get(`/api/v1/media/${id}`, authHeader(owner.token))).body.media;
    assert.equal(ready.status, "ready", ready.processingError);
    for (const name of ["poster.jpg", "thumb.jpg", "video_720.mp4", "video_480.mp4"]) {
      const object = await head(`m/${id}/${name}`);
      assert.ok(object, `${name} stored in S3`);
      assert.equal(object!.CacheControl, "public, max-age=31536000, immutable");
      assert.equal(object!.ContentType, name.endsWith(".mp4") ? "video/mp4" : "image/jpeg");
    }
    // Without a CDN configured the API streams from S3, ranges included.
    const ranged = await fetch(`${baseUrl}${ready.delivery.videos[0].url}`, { headers: { ...authHeader(owner.token), Range: "bytes=0-15" } });
    assert.equal(ranged.status, 206);
    assert.equal((await ranged.arrayBuffer()).byteLength, 16);
  });

  it("S3 refuses part uploads that don't match their signature, length or expiry", async () => {
    const owner = await signup();
    const bytes = await jpegWithGps(64, 64, 1);
    const created = await createUploadSession(baseUrl, owner.token, { clientUploadId: clientUploadId(), kind: "photo", mimeType: "image/jpeg", byteSize: bytes.length });
    const [part] = created.body.upload.parts as UploadPlanPart[];
    const url = new URL(part!.url!);
    const signature = url.searchParams.get("X-Amz-Signature")!;
    url.searchParams.set("X-Amz-Signature", (signature[0] === "0" ? "1" : "0") + signature.slice(1));
    assert.equal((await fetch(url, { method: "PUT", body: bytes })).status, 403, "tampered signature");
    assert.equal((await fetch(part!.url!, { method: "PUT", body: Buffer.concat([bytes, Buffer.from("extra")]) })).status, 403, "signed Content-Length");
    const row = await queryOne(`SELECT multipart_upload_id FROM media_upload_sessions WHERE media_id = :'id'`, { id: created.body.media.id });
    const shortLived = await store.presignPart({ key: `m/${created.body.media.id}/original`, uploadId: row!.multipart_upload_id as string, partNumber: 1, byteLength: bytes.length, expiresInSeconds: 1, mediaId: created.body.media.id });
    await new Promise((r) => setTimeout(r, 2100));
    assert.equal((await fetch(shortLived, { method: "PUT", body: bytes })).status, 403, "expired URL");
    assert.equal((await fetch(part!.url!, { method: "PUT", body: bytes })).status, 200);
    assert.equal((await completeUpload(baseUrl, owner.token, created.body.media.id)).status, 200);
    await worker.drain();
  });

  it("resumes from S3's own record of uploaded parts, and abort removes the multipart upload", async () => {
    const owner = await signup();
    const bytes = makeVideo({ width: 1280, height: 720, seconds: 2, bitrate: "32M", audio: false });
    const created = await createUploadSession(baseUrl, owner.token, { clientUploadId: clientUploadId(), kind: "video", mimeType: "video/mp4", byteSize: bytes.length });
    const id = created.body.media.id as string;
    const [first] = created.body.upload.parts as UploadPlanPart[];
    assert.equal((await putPart(baseUrl, first!, bytes, created.body.upload.partSize)).status, 200);
    const resumed = (await client.get(`/api/v1/media/uploads/${id}`, authHeader(owner.token))).body.upload.parts as UploadPlanPart[];
    assert.deepEqual(resumed.map((p) => p.uploaded), resumed.map((_, i) => i === 0));
    const open = async () => ((await store.client.send(new ListMultipartUploadsCommand({ Bucket: bucket }))).Uploads ?? []).filter((u) => u.Key === `m/${id}/original`).length;
    assert.equal(await open(), 1);
    assert.equal((await client.post(`/api/v1/media/uploads/${id}/abort`, undefined, authHeader(owner.token))).status, 204);
    assert.equal(await open(), 0, "the incomplete upload is gone from S3");
  });

  it("retention deletes media objects from S3", async () => {
    const owner = await signup();
    const used = await uploadDirect(baseUrl, owner.token, await jpegWithGps(80, 60, 1), "photo", "image/jpeg");
    const unused = await uploadDirect(baseUrl, owner.token, await jpegWithGps(60, 80, 1), "photo", "image/jpeg");
    await worker.drain();
    const story = await client.post("/api/v1/stories", { mediaId: used.id, caption: "", audience: "public", allowComments: "everyone", allowSharing: true }, authHeader(owner.token));
    assert.equal(story.status, 201);
    await client.delete(`/api/v1/stories/${story.body.story.id}`, authHeader(owner.token));
    await query(`UPDATE stories SET deleted_at = now() - interval '31 days' WHERE id = :'id'`, { id: story.body.story.id });
    await query(`UPDATE media SET created_at = now() - interval '49 hours' WHERE id = :'id'`, { id: unused.id });
    for (const key of [`m/${used.id}/original`, `m/${used.id}/display.jpg`, `m/${unused.id}/thumb.jpg`]) assert.ok(await head(key), key);

    assert.ok((await deletedStoryMedia(store, 50, 30)) >= 1);
    assert.ok((await unusedMedia(store, 50, 48)) >= 1);
    for (const key of [`m/${used.id}/original`, `m/${used.id}/display.jpg`, `m/${used.id}/thumb.jpg`, `m/${unused.id}/original`, `m/${unused.id}/thumb.jpg`]) {
      assert.equal(await head(key), null, `${key} deleted from S3`);
    }
    assert.notEqual((await queryOne(`SELECT purged_at FROM media WHERE id = :'id'`, { id: used.id }))?.purged_at, null);
    assert.equal(await queryOne(`SELECT id FROM media WHERE id = :'id'`, { id: unused.id }), null);
  });
  it("copies media from the old local-disk layout into S3, idempotently and without inventing missing files", async () => {
    const owner = await signup();
    const localRoot = fs.mkdtempSync(path.join(os.tmpdir(), "katkee-local-media-"));
    const local = new LocalObjectStore(localRoot);
    const legacyKey = (await import("node:crypto")).randomUUID(); // pre-pipeline flat key
    const file = path.join(localRoot, "source.jpg");
    fs.writeFileSync(file, await jpegWithGps(32, 24, 1));
    await local.putFile(legacyKey, file, "image/jpeg");
    const user = await queryOne(`SELECT id FROM users WHERE username = :'u'`, { u: owner.username });
    await query(`INSERT INTO media (owner_id, kind, mime_type, byte_size, checksum_sha256, storage_key, status) VALUES (:'o', 'photo', 'image/jpeg', :'size', 'x', :'key', 'ready')`,
      { o: user!.id as string, size: fs.statSync(file).size, key: legacyKey });
    const lost = (await import("node:crypto")).randomUUID();
    await query(`INSERT INTO media (owner_id, kind, mime_type, byte_size, checksum_sha256, storage_key, status) VALUES (:'o', 'photo', 'image/jpeg', 10, 'x', :'key', 'ready')`, { o: user!.id as string, key: lost });

    const dry = await copyLocalMediaToS3(local, store, { dryRun: true });
    assert.equal(await head(legacyKey), null, "dry run writes nothing");
    assert.ok(dry.copied >= 1);
    const first = await copyLocalMediaToS3(local, store);
    assert.equal(Number((await head(legacyKey))?.ContentLength), fs.statSync(file).size);
    assert.ok(first.missing.includes(lost), "a file missing on disk is reported");
    const second = await copyLocalMediaToS3(local, store);
    assert.equal(second.copied, 0, "already-copied objects are skipped");
    fs.rmSync(localRoot, { recursive: true, force: true });
  });
});
