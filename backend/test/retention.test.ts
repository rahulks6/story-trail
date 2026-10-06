process.env.MEDIA_UPLOAD_PART_BYTES = "65536";
process.env.MEDIA_STORAGE_ROOT_TEST ??= require("node:fs").mkdtempSync(require("node:path").join(require("node:os").tmpdir(), "katkee-retention-"));

import "./env";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { buildApp } from "../src/app";
import { openDedicatedConnection, query, queryOne } from "../src/db/psql";
import { mediaStorage } from "../src/modules/media/instance";
import { MediaWorker } from "../src/modules/media/worker";
import {
  abandonedUploads, deletedAccounts, deletedStoryMedia, expiredRecords, processedOriginals, removedContentMedia,
  runRetentionIfDue, scratchFiles, unusedMedia,
} from "../src/modules/media/retention";
import { authHeader, makeClient, uniqueUser } from "./helpers";
import { clientUploadId, createUploadSession, jpegWithGps, makeVideo, putPart, uploadDirect, type UploadPlanPart } from "./mediaHelpers";

let baseUrl: string;
let client: ReturnType<typeof makeClient>;
const server = buildApp();
const root = process.env.MEDIA_STORAGE_ROOT as string;
const worker = new MediaWorker({ store: mediaStorage, workerId: "retention-test", concurrency: 1, leaseSeconds: 60, pollMs: 50, jobTimeoutSeconds: 60 });

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
  return { username: input.username, token: res.body.tokens.accessToken as string, id: res.body.user.id as string };
}

/** A processed photo owned by `token`. */
async function photo(token: string): Promise<string> {
  const res = await fetch(`${baseUrl}/api/v1/media/photos`, { method: "POST", headers: { "Content-Type": "image/jpeg", ...authHeader(token) }, body: await jpegWithGps(64, 48, 1) });
  assert.equal(res.status, 201);
  return ((await res.json()) as { media: { id: string } }).media.id;
}

async function publish(token: string, mediaId: string): Promise<string> {
  const res = await client.post("/api/v1/stories", { mediaId, caption: "", audience: "public", allowComments: "everyone", allowSharing: true }, authHeader(token));
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.story.id as string;
}

const filesOf = async (mediaId: string) => {
  const row = await queryOne(`SELECT storage_key, variants FROM media WHERE id = :'id'`, { id: mediaId });
  if (!row) return [] as string[];
  const keys = [row.storage_key as string, ...Object.values(JSON.parse(row.variants as string) as Record<string, { key: string }>).map((v) => v.key)];
  return keys.map((k) => path.join(root, ...k.split("/")));
};
const purgedAt = async (mediaId: string) => (await queryOne(`SELECT purged_at FROM media WHERE id = :'id'`, { id: mediaId }))?.purged_at ?? null;

describe("retention", () => {
  it("removes expired upload sessions and the parts they stored", async () => {
    const owner = await signup();
    const bytes = await jpegWithGps(400, 300, 1);
    const stale = await createUploadSession(baseUrl, owner.token, { clientUploadId: clientUploadId(), kind: "photo", mimeType: "image/jpeg", byteSize: bytes.length });
    const live = await createUploadSession(baseUrl, owner.token, { clientUploadId: clientUploadId(), kind: "photo", mimeType: "image/jpeg", byteSize: bytes.length });
    await putPart(baseUrl, (stale.body.upload.parts as UploadPlanPart[])[0]!, bytes, stale.body.upload.partSize);
    const upload = (await queryOne(`SELECT multipart_upload_id FROM media_upload_sessions WHERE media_id = :'id'`, { id: stale.body.media.id }))!.multipart_upload_id as string;
    assert.ok(fs.existsSync(path.join(root, ".multipart", upload)));
    await query(`UPDATE media_upload_sessions SET expires_at = now() - interval '1 minute' WHERE media_id = :'id'`, { id: stale.body.media.id });

    assert.ok((await abandonedUploads(mediaStorage, 50)) >= 1);
    assert.equal(await queryOne(`SELECT id FROM media WHERE id = :'id'`, { id: stale.body.media.id }), null);
    assert.equal(fs.existsSync(path.join(root, ".multipart", upload)), false);
    assert.equal((await queryOne(`SELECT status FROM media WHERE id = :'id'`, { id: live.body.media.id }))?.status, "uploading", "live uploads untouched");
  });

  it("deletes media nobody uses after 48 hours, and never media in use", async () => {
    const owner = await signup();
    const [unused, published, avatar, recent] = [await photo(owner.token), await photo(owner.token), await photo(owner.token), await photo(owner.token)];
    await publish(owner.token, published);
    await query(`UPDATE users SET avatar_media_id = :'m' WHERE id = :'id'`, { m: avatar, id: owner.id });
    const waiting = await uploadDirect(baseUrl, owner.token, makeVideo({ width: 160, height: 90, seconds: 1 }), "video", "video/mp4");
    const rid = `ret_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    assert.equal((await client.post("/api/v1/stories", { mediaId: waiting.id, caption: "", audience: "public", allowComments: "everyone", allowSharing: true, requestId: rid }, authHeader(owner.token))).status, 202);
    await query(`UPDATE media SET created_at = now() - interval '49 hours' WHERE id = ANY (string_to_array(:'ids', ',')::uuid[])`, { ids: [unused, published, avatar, waiting.id].join(",") });
    const unusedFiles = await filesOf(unused);
    assert.ok(unusedFiles.every((f) => fs.existsSync(f)));

    assert.ok((await unusedMedia(mediaStorage, 200, 48)) >= 1);
    assert.equal(await queryOne(`SELECT id FROM media WHERE id = :'id'`, { id: unused }), null);
    assert.ok(unusedFiles.every((f) => !fs.existsSync(f)), "objects deleted");
    for (const kept of [published, avatar, recent, waiting.id]) {
      assert.ok(await queryOne(`SELECT id FROM media WHERE id = :'id' AND purged_at IS NULL`, { id: kept }), `${kept} kept`);
    }
    await worker.drain();
  });

  it("can't purge media out from under a publish: claiming re-checks references under the row lock", async () => {
    const owner = await signup();
    const media = await photo(owner.token);
    await query(`UPDATE media SET created_at = now() - interval '49 hours' WHERE id = :'id'`, { id: media });
    await publish(owner.token, media);
    assert.equal(await queryOne(`SELECT id FROM claim_unused_media_for_purge(:'id'::uuid, 48)`, { id: media }), null);

    const other = await photo(owner.token);
    await query(`UPDATE media SET created_at = now() - interval '49 hours' WHERE id = :'id'`, { id: other });
    assert.ok(await queryOne(`SELECT id FROM claim_unused_media_for_purge(:'id'::uuid, 48)`, { id: other }));
    const late = await client.post("/api/v1/stories", { mediaId: other, caption: "", audience: "public", allowComments: "everyone", allowSharing: true }, authHeader(owner.token));
    assert.equal(late.status, 409, "a claimed media can no longer be published");
  });

  it("purges a deleted Story's media after 30 days unless an open report still needs it", async () => {
    const owner = await signup();
    const reporter = await signup();
    const [m1, m2] = [await photo(owner.token), await photo(owner.token)];
    const [s1, s2] = [await publish(owner.token, m1), await publish(owner.token, m2)];
    for (const s of [s1, s2]) assert.equal((await client.delete(`/api/v1/stories/${s}`, authHeader(owner.token))).status, 204);
    await query(`UPDATE stories SET deleted_at = now() - interval '31 days' WHERE id IN (:'a', :'b')`, { a: s1, b: s2 });
    const report = await queryOne(`INSERT INTO reports (reporter_id, target_type, target_id, reason) VALUES (:'r', 'story', :'s', 'harassment') RETURNING id`, { r: reporter.id, s: s2 });
    const m1Files = await filesOf(m1);

    assert.ok((await deletedStoryMedia(mediaStorage, 200, 30)) >= 1);
    assert.notEqual(await purgedAt(m1), null);
    assert.ok(m1Files.every((f) => !fs.existsSync(f)), "objects deleted");
    assert.equal(await purgedAt(m2), null, "held while the report is open");
    assert.equal((await fetch(`${baseUrl}/api/v1/media/${m1}/file`, { headers: authHeader(owner.token) })).status, 404);

    await query(`UPDATE reports SET status = 'ACTIONED' WHERE id = :'id'`, { id: report!.id as string });
    await deletedStoryMedia(mediaStorage, 200, 30);
    assert.notEqual(await purgedAt(m2), null);
  });

  it("keeps content removed by moderation as evidence for 180 days, then purges it", async () => {
    const owner = await signup();
    const media = await photo(owner.token);
    const story = await publish(owner.token, media);
    await query(`UPDATE stories SET moderation_removed_at = now() - interval '100 days' WHERE id = :'id'`, { id: story });
    await removedContentMedia(mediaStorage, 200, 180);
    assert.equal(await purgedAt(media), null, "still evidence");
    await query(`UPDATE stories SET moderation_removed_at = now() - interval '181 days' WHERE id = :'id'`, { id: story });
    await removedContentMedia(mediaStorage, 200, 180);
    assert.notEqual(await purgedAt(media), null);
  });

  it("purges and scrubs accounts deleted 30 days ago, keeping media still held as evidence", async () => {
    const user = await signup();
    const [normal, held, avatar] = [await photo(user.token), await photo(user.token), await photo(user.token)];
    await publish(user.token, normal);
    const heldStory = await publish(user.token, held);
    await query(`UPDATE stories SET moderation_removed_at = now() - interval '10 days' WHERE id = :'id'`, { id: heldStory });
    // An earlier rename: the old name is personal data too.
    await query(`UPDATE users SET username = :'name' WHERE id = :'id'`, { name: `renamed_${randomUUID().slice(0, 8)}`, id: user.id });
    await query(`UPDATE users SET avatar_media_id = :'m', bio = 'hello', deleted_at = now() - interval '31 days', is_active = false WHERE id = :'id'`, { m: avatar, id: user.id });
    await query(`INSERT INTO auth_identities (user_id, provider, subject) VALUES (:'id', 'GOOGLE', :'sub')`, { id: user.id, sub: `google-${randomUUID()}` });
    assert.ok(Number((await queryOne(`SELECT count(*) AS n FROM refresh_tokens WHERE user_id = :'id'`, { id: user.id }))?.n) > 0);
    await query(`INSERT INTO analytics_active_days (day, platform, user_id) VALUES (current_date - 40, 'ios', :'id') ON CONFLICT DO NOTHING`, { id: user.id });
    await query(`INSERT INTO analytics_events (id, user_id, name, platform, occurred_at) VALUES (gen_random_uuid(), :'id', 'app_session_started', 'ios', now() - interval '35 days')`, { id: user.id });

    assert.ok((await deletedAccounts(mediaStorage, 200, 30, 180)) >= 1);
    const row = await queryOne(`SELECT username, email, password_hash, display_name, bio, avatar_media_id, data_purged_at FROM users WHERE id = :'id'`, { id: user.id });
    assert.match(String(row?.username), /^deleted_[0-9a-f]{12}$/);
    assert.deepEqual([row?.email, row?.password_hash, row?.display_name, row?.bio, row?.avatar_media_id], [null, null, "Deleted account", "", null]);
    assert.notEqual(row?.data_purged_at, null);
    for (const table of ["auth_identities", "refresh_tokens", "auth_security_events", "analytics_events", "analytics_active_days", "username_changes"]) {
      assert.equal((await queryOne(`SELECT count(*) AS n FROM ${table} WHERE user_id = :'id'`, { id: user.id }))?.n, "0", table);
    }
    assert.notEqual(await purgedAt(normal), null);
    assert.notEqual(await purgedAt(avatar), null);
    assert.equal(await purgedAt(held), null, "moderation evidence outlives the account");
    assert.equal(await deletedAccounts(mediaStorage, 200, 30, 180), 0, "done once");
  });

  it("deletes originals 30 days after processing; the stripped variants keep serving", async () => {
    const owner = await signup();
    const media = await photo(owner.token);
    const [original] = await filesOf(media);
    await query(`UPDATE media SET processed_at = now() - interval '31 days' WHERE id = :'id'`, { id: media });
    assert.ok((await processedOriginals(mediaStorage, 200, 30)) >= 1);
    assert.equal(fs.existsSync(original!), false);
    assert.notEqual((await queryOne(`SELECT original_purged_at FROM media WHERE id = :'id'`, { id: media }))?.original_purged_at, null);
    for (const url of [`/api/v1/media/${media}/file`, `/api/v1/media/${media}/file?variant=original`]) {
      const res = await fetch(`${baseUrl}${url}`, { headers: authHeader(owner.token) });
      assert.deepEqual([res.status, res.headers.get("content-type")], [200, "image/jpeg"], url);
    }
  });

  it("clears expired security records and stale scratch files, keeping live ones", async () => {
    const user = await signup();
    await query(`INSERT INTO rate_limit_buckets (key, window_started_at, hits) VALUES ('ret-old', now() - interval '2 days', 1), ('ret-new', now(), 1)`);
    await query(`INSERT INTO password_reset_requests (user_id, code_hash, expires_at) VALUES (:'u', 'old', now() - interval '2 days'), (:'u', 'new', now() + interval '10 minutes')`, { u: user.id });
    await query(`INSERT INTO home_feed_snapshots (id, viewer_id, items, expires_at) VALUES (gen_random_uuid(), :'u', '[]', now() - interval '2 hours'), (gen_random_uuid(), :'u', '[]', now() + interval '2 minutes')`, { u: user.id });
    await query(`INSERT INTO auth_security_events (user_id, kind, created_at) VALUES (:'u', 'login_failed', now() - interval '401 days')`, { u: user.id });
    await query(`UPDATE refresh_tokens SET expires_at = now() - interval '8 days' WHERE user_id = :'u'`, { u: user.id });

    assert.ok((await expiredRecords()) >= 5);
    assert.deepEqual((await query(`SELECT key FROM rate_limit_buckets WHERE key LIKE 'ret-%'`)).map((r) => r.key), ["ret-new"]);
    assert.deepEqual((await query(`SELECT code_hash FROM password_reset_requests WHERE user_id = :'u'`, { u: user.id })).map((r) => r.code_hash), ["new"]);
    assert.equal((await queryOne(`SELECT count(*) AS n FROM home_feed_snapshots WHERE viewer_id = :'u'`, { u: user.id }))?.n, "1");
    assert.equal((await queryOne(`SELECT count(*) AS n FROM auth_security_events WHERE user_id = :'u' AND created_at < now() - interval '400 days'`, { u: user.id }))?.n, "0");
    assert.equal((await queryOne(`SELECT count(*) AS n FROM refresh_tokens WHERE user_id = :'u'`, { u: user.id }))?.n, "0");

    const oldDir = fs.mkdtempSync(path.join(os.tmpdir(), "katkee-media-"));
    const freshDir = fs.mkdtempSync(path.join(os.tmpdir(), "katkee-media-"));
    const past = new Date(Date.now() - 2 * 24 * 3600 * 1000);
    fs.utimesSync(oldDir, past, past);
    assert.ok((await scratchFiles(mediaStorage)) >= 1);
    assert.deepEqual([fs.existsSync(oldDir), fs.existsSync(freshDir)], [false, true]);
    fs.rmSync(freshDir, { recursive: true, force: true });
  });

  it("clears expired realtime tickets, old finished pushes and long-disabled devices, keeping current ones", async () => {
    const user = await signup();
    await query(
      `INSERT INTO realtime_tickets (token_hash, user_id, access_issued_at, access_expires_at, expires_at)
       VALUES ('ret-ticket-old', :'u', now(), now() + interval '15 minutes', now() - interval '2 hours'),
              ('ret-ticket-new', :'u', now(), now() + interval '15 minutes', now() + interval '1 minute')`,
      { u: user.id },
    );
    await query(
      `INSERT INTO push_outbox (user_id, kind, status, created_at, finished_at) VALUES
         (:'u', 'follow', 'sent', now() - interval '40 days', now() - interval '31 days'),
         (:'u', 'follow', 'skipped', now() - interval '40 days', now() - interval '31 days'),
         (:'u', 'follow', 'sent', now() - interval '2 days', now() - interval '2 days'),
         (:'u', 'follow', 'queued', now() - interval '40 days', NULL)`,
      { u: user.id },
    );
    await query(
      `INSERT INTO push_devices (user_id, provider, platform, token, disabled_at, disabled_reason) VALUES
         (:'u', 'fcm', 'android', 'ret-device-old-0123456789', now() - interval '91 days', 'signed_out'),
         (:'u', 'fcm', 'android', 'ret-device-recent-0123456', now() - interval '3 days', 'signed_out'),
         (:'u', 'fcm', 'android', 'ret-device-live-012345678', NULL, NULL)`,
      { u: user.id },
    );
    assert.ok((await expiredRecords()) >= 4);
    assert.deepEqual((await query(`SELECT token_hash FROM realtime_tickets WHERE user_id = :'u'`, { u: user.id })).map((r) => r.token_hash), ["ret-ticket-new"]);
    assert.deepEqual(
      (await query(`SELECT status FROM push_outbox WHERE user_id = :'u' ORDER BY status`, { u: user.id })).map((r) => r.status),
      ["queued", "sent"],
      "an unsent push is never dropped by age",
    );
    assert.deepEqual(
      (await query(`SELECT token FROM push_devices WHERE user_id = :'u' ORDER BY token`, { u: user.id })).map((r) => r.token),
      ["ret-device-live-012345678", "ret-device-recent-0123456"],
    );
  });

  it("runs on one worker at a time, at most once per interval, and records every task", async () => {
    const [a, b] = [await openDedicatedConnection(), await openDedicatedConnection()];
    try {
      await b.query("SELECT pg_advisory_lock(7315220001)");
      assert.equal(await runRetentionIfDue(a, mediaStorage, 60), null, "another worker holds the lock");
      await b.query("SELECT pg_advisory_unlock(7315220001)");
      await query(`DELETE FROM retention_runs`);
      const reports = await runRetentionIfDue(a, mediaStorage, 60);
      assert.ok(reports);
      assert.deepEqual(reports!.map((r) => r.task), ["abandoned_uploads", "unused_media", "deleted_story_media", "removed_content_media", "deleted_accounts", "processed_originals", "report_message_evidence", "ad_campaign_completion", "analytics_rollup", "analytics_raw_retention", "expired_records", "scratch_files"]);
      assert.ok(reports!.every((r) => !r.error), JSON.stringify(reports));
      assert.equal(await runRetentionIfDue(a, mediaStorage, 60), null, "not again within the interval");
      const runs = await query(`SELECT task, finished_at FROM retention_runs`);
      assert.equal(runs.length, 12);
      assert.ok(runs.every((r) => r.finished_at !== null));
    } finally {
      await a.end();
      await b.end();
    }
  });
});
