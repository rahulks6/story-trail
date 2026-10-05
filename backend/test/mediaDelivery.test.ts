// CloudFront signed-URL delivery. A throwaway RSA key pair stands in for the
// CloudFront key group; signatures are verified with its public key using
// CloudFront's canned-policy format.
import { createVerify, generateKeyPairSync } from "node:crypto";

const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
process.env.MEDIA_CDN_DOMAIN = "media.katkee.test";
process.env.CLOUDFRONT_KEY_PAIR_ID = "K2KATKEETESTKEY";
// Supplied as base64 of the PEM, one of the two accepted forms.
process.env.CLOUDFRONT_PRIVATE_KEY = Buffer.from(keys.privateKey.export({ type: "pkcs1", format: "pem" }).toString()).toString("base64");
process.env.MEDIA_URL_TTL_SECONDS = "3600";
process.env.MEDIA_STORAGE_ROOT_TEST ??= require("node:fs").mkdtempSync(require("node:path").join(require("node:os").tmpdir(), "katkee-cdn-"));

import "./env";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import * as http from "node:http";
import type { AddressInfo } from "node:net";
import { buildApp } from "../src/app";
import { mediaStorage } from "../src/modules/media/instance";
import { findMediaById } from "../src/modules/media/media.repository";
import { sendMediaFile, signedCdnUrl, urlExpiry } from "../src/modules/media/delivery";
import { MediaWorker } from "../src/modules/media/worker";
import { authHeader, makeClient, uniqueUser } from "./helpers";
import { jpegWithGps, makeVideo, uploadDirect } from "./mediaHelpers";

let baseUrl: string;
let client: ReturnType<typeof makeClient>;
const server = buildApp();
const worker = new MediaWorker({ store: mediaStorage, workerId: "cdn-test", concurrency: 1, leaseSeconds: 60, pollMs: 50, jobTimeoutSeconds: 60 });

before(async () => {
  await new Promise<void>((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  client = makeClient(baseUrl);
});
after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const fromCloudFrontBase64 = (s: string) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "=").replace(/~/g, "/"), "base64");

/** Verifies a canned-policy signed URL exactly as CloudFront does. */
function verifySignedUrl(signed: string, algorithm: "RSA-SHA1" | "RSA-SHA256" = "RSA-SHA1"): { resource: string; expires: number } {
  const url = new URL(signed);
  const expires = Number(url.searchParams.get("Expires"));
  const signature = url.searchParams.get("Signature")!;
  assert.equal(url.searchParams.get("Key-Pair-Id"), "K2KATKEETESTKEY");
  for (const p of ["Expires", "Signature", "Key-Pair-Id", "Hash-Algorithm"]) url.searchParams.delete(p);
  const resource = url.toString();
  const policy = JSON.stringify({ Statement: [{ Resource: resource, Condition: { DateLessThan: { "AWS:EpochTime": expires } } }] });
  const verifier = createVerify(algorithm);
  verifier.update(policy);
  assert.ok(verifier.verify(keys.publicKey, fromCloudFrontBase64(signature)), "signature verifies with the key group's public key");
  return { resource, expires };
}

async function signup() {
  const input = uniqueUser();
  const res = await client.post("/api/v1/auth/signup", input);
  return { username: input.username, token: res.body.tokens.accessToken as string };
}

describe("CDN delivery", () => {
  it("signs CloudFront canned-policy URLs whose expiry is rounded so URLs stay cacheable", () => {
    const now = Date.UTC(2026, 9, 5, 10, 15, 0);
    const expiry = urlExpiry(now, 3600);
    assert.equal(expiry % 3600, 0);
    assert.ok(expiry - now / 1000 >= 3600 && expiry - now / 1000 <= 7200, "valid for between one and two TTLs");
    const key = "m/0b8a7c1e-2f3d-4e5f-8a9b-0c1d2e3f4a5b/display.jpg";
    const a = signedCdnUrl(key, now);
    const b = signedCdnUrl(key, now + 40 * 60_000);
    assert.equal(a.url, b.url, "identical within the hour, so the device cache hits");
    assert.notEqual(signedCdnUrl(key, Date.UTC(2026, 9, 5, 11, 0, 1)).url, a.url, "a new URL once per hour");
    const { resource, expires } = verifySignedUrl(a.url);
    assert.equal(resource, "https://media.katkee.test/m/0b8a7c1e-2f3d-4e5f-8a9b-0c1d2e3f4a5b/display.jpg");
    assert.equal(expires, expiry);
    assert.equal(a.expiresAt, new Date(expiry * 1000).toISOString());
  });

  it("can sign with SHA-256 for FIPS deployments", () => {
    process.env.CLOUDFRONT_SIGNING_ALGORITHM = "SHA256";
    try {
      const { url } = signedCdnUrl("m/0b8a7c1e-2f3d-4e5f-8a9b-0c1d2e3f4a5b/thumb.jpg");
      assert.equal(new URL(url).searchParams.get("Hash-Algorithm"), "SHA256");
      verifySignedUrl(url, "RSA-SHA256");
    } finally {
      delete process.env.CLOUDFRONT_SIGNING_ALGORITHM;
    }
  });

  it("embeds signed CDN URLs in Story responses and redirects file requests to the CDN", async () => {
    const owner = await signup();
    const viewer = await signup();
    const photo = await uploadDirect(baseUrl, owner.token, await jpegWithGps(400, 300, 1), "photo", "image/jpeg");
    const video = await uploadDirect(baseUrl, owner.token, makeVideo({ width: 1280, height: 720, seconds: 1 }), "video", "video/mp4");
    await worker.drain();
    for (const media of [photo, video]) {
      const res = await client.post("/api/v1/stories", { mediaId: media.id, caption: "", audience: "public", allowComments: "everyone", allowSharing: true }, authHeader(owner.token));
      assert.equal(res.status, 201);
    }
    const stories = (await client.get(`/api/v1/users/${owner.username}/stories`, authHeader(viewer.token))).body.stories;
    const photoStory = stories.find((s: { mediaId: string }) => s.mediaId === photo.id);
    const videoStory = stories.find((s: { mediaId: string }) => s.mediaId === video.id);
    assert.equal(verifySignedUrl(photoStory.media.imageUrl).resource, `https://media.katkee.test/m/${photo.id}/display.jpg`);
    assert.equal(verifySignedUrl(photoStory.media.thumbnailUrl).resource, `https://media.katkee.test/m/${photo.id}/thumb.jpg`);
    assert.ok(photoStory.media.urlsExpireAt);
    assert.deepEqual(videoStory.media.videos.map((v: { variant: string; url: string }) => [v.variant, verifySignedUrl(v.url).resource]), [
      ["video_720", `https://media.katkee.test/m/${video.id}/video_720.mp4`],
      ["video_480", `https://media.katkee.test/m/${video.id}/video_480.mp4`],
    ]);
    assert.equal(verifySignedUrl(videoStory.media.imageUrl).resource, `https://media.katkee.test/m/${video.id}/poster.jpg`);

    const redirect = await fetch(`${baseUrl}/api/v1/media/${photo.id}/file?variant=thumbnail`, { headers: authHeader(viewer.token), redirect: "manual" });
    assert.equal(redirect.status, 302);
    assert.equal(redirect.headers.get("cache-control"), "private, no-store");
    assert.equal(verifySignedUrl(redirect.headers.get("location")!).resource, `https://media.katkee.test/m/${photo.id}/thumb.jpg`);
    const ownerOriginal = await fetch(`${baseUrl}/api/v1/media/${photo.id}/file?variant=original`, { headers: authHeader(owner.token), redirect: "manual" });
    assert.equal(verifySignedUrl(ownerOriginal.headers.get("location")!).resource, `https://media.katkee.test/m/${photo.id}/original`);
    const viewerOriginal = await fetch(`${baseUrl}/api/v1/media/${photo.id}/file?variant=original`, { headers: authHeader(viewer.token), redirect: "manual" });
    assert.equal(viewerOriginal.status, 404, "never signs an original for anyone but its owner");
  });

  it("streams instead of redirecting where the caller needs same-origin bytes (Admin console)", async () => {
    const owner = await signup();
    const photo = await uploadDirect(baseUrl, owner.token, await jpegWithGps(120, 90, 1), "photo", "image/jpeg");
    await worker.drain();
    const media = (await findMediaById(photo.id))!;
    const probe = http.createServer((req, res) => void sendMediaFile(req, res, media, null, false, mediaStorage, { redirect: false }));
    await new Promise<void>((resolve) => probe.listen(0, resolve));
    try {
      const res = await fetch(`http://127.0.0.1:${(probe.address() as AddressInfo).port}/`, { redirect: "manual" });
      assert.equal(res.status, 200);
      assert.equal(res.headers.get("content-type"), "image/jpeg");
      assert.ok((await res.arrayBuffer()).byteLength > 0);
    } finally {
      await new Promise<void>((resolve) => probe.close(() => resolve()));
    }
  });
});
