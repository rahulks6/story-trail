// The profile cover photo: the wide banner at the top of a profile. Set, replaced and removed in
// Edit profile like the avatar, served by /users/:username/cover/file to whoever can see the
// profile header (blocked people never), kept from the unused-media purge while in use, removable
// by an admin (audit-logged) and gone with the account.
import "./admin-env";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { buildApp } from "../src/app";
import { query, queryOne } from "../src/db/psql";
import { mediaStorage } from "../src/modules/media/instance";
import { deletedAccounts, unusedMedia } from "../src/modules/media/retention";
import { authHeader, makeClient, uniqueUser } from "./helpers";
import { buildTestPng } from "./fixtures";
import { adminSignIn } from "./adminSession";

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

async function signup() {
  const input = uniqueUser();
  const res = await client.post("/api/v1/auth/signup", input);
  return { ...input, id: res.body.user.id as string, token: res.body.tokens.accessToken as string };
}
async function uploadPhoto(token: string): Promise<string> {
  const res = await fetch(`${baseUrl}/api/v1/media/photos`, { method: "POST", headers: { "Content-Type": "image/png", ...authHeader(token) }, body: buildTestPng(24, 8) });
  assert.equal(res.status, 201);
  return ((await res.json()) as { media: { id: string } }).media.id;
}
async function setCover(token: string, coverMediaId: string | null) {
  return client.patch("/api/v1/users/me", { coverMediaId }, authHeader(token));
}
async function coverFile(username: string, token: string | null, version = "") {
  const res = await fetch(`${baseUrl}/api/v1/users/${username}/cover/file${version ? `?v=${version}` : ""}`, { headers: token ? authHeader(token) : {} });
  await res.arrayBuffer();
  return res.status;
}
const purgedAt = async (id: string) => (await queryOne(`SELECT purged_at FROM media WHERE id = :'id'`, { id }))?.purged_at ?? null;

describe("setting a cover", () => {
  it("set, replace and remove; the profile, your account and the edit response carry it", async () => {
    const alice = await signup();
    const first = await uploadPhoto(alice.token);
    const saved = await setCover(alice.token, first);
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    assert.equal(saved.body.user.coverMediaId, first, "the edit response");
    assert.equal((await client.get("/api/v1/auth/me", authHeader(alice.token))).body.user.coverMediaId, first, "your account");
    assert.equal((await client.get(`/api/v1/users/${alice.username}`, authHeader(alice.token))).body.profile.coverMediaId, first, "your profile");
    assert.equal(await coverFile(alice.username, alice.token, first), 200);

    // Other fields leave the cover alone; the avatar and the cover are separate.
    const bio = await client.patch("/api/v1/users/me", { bio: "Hello", avatarMediaId: null }, authHeader(alice.token));
    assert.equal(bio.body.user.coverMediaId, first);

    const second = await uploadPhoto(alice.token);
    assert.equal((await setCover(alice.token, second)).body.user.coverMediaId, second, "replaced");
    const removed = await setCover(alice.token, null);
    assert.equal(removed.status, 200);
    assert.equal(removed.body.user.coverMediaId, null, "removed");
    assert.equal((await client.get(`/api/v1/users/${alice.username}`, authHeader(alice.token))).body.profile.coverMediaId, null);
    assert.equal(await coverFile(alice.username, alice.token), 404, "no cover, nothing served");
  });

  it("refuses someone else's upload, a video, an unready upload and an ID photo, changing nothing", async () => {
    const [alice, bob] = [await signup(), await signup()];
    const mine = await uploadPhoto(alice.token);
    await setCover(alice.token, mine);
    const refuse = async (id: string, label: string) => {
      const res = await client.patch("/api/v1/users/me", { coverMediaId: id, bio: "Should not save" }, authHeader(alice.token));
      assert.equal(res.status, 400, `${label}: ${JSON.stringify(res.body)}`);
      const me = (await client.get("/api/v1/auth/me", authHeader(alice.token))).body.user;
      assert.deepEqual([me.coverMediaId, me.bio], [mine, ""], label);
    };
    await refuse(await uploadPhoto(bob.token), "not owned");

    const video = await uploadPhoto(alice.token);
    await query(`UPDATE media SET kind = 'video' WHERE id = :'id'`, { id: video });
    await refuse(video, "not a photo");
    const processing = await uploadPhoto(alice.token);
    await query(`UPDATE media SET status = 'processing' WHERE id = :'id'`, { id: processing });
    await refuse(processing, "not ready");
    const idPhoto = await uploadPhoto(alice.token);
    await query(`UPDATE media SET verification_document = true WHERE id = :'id'`, { id: idPhoto });
    await refuse(idPhoto, "a verification document");
    await refuse("00000000-0000-4000-8000-000000000000", "doesn't exist");

    const malformed = await client.patch("/api/v1/users/me", { coverMediaId: "not-a-uuid" }, authHeader(alice.token));
    assert.equal(malformed.status, 422);
    assert.equal(malformed.body.fields.coverMediaId, "Invalid cover photo.");
  });
});

describe("who sees a cover", () => {
  it("anyone who sees the header, a private account's too; signed out never; blocked either way never", async () => {
    const [alice, bob] = [await signup(), await signup()];
    const cover = await uploadPhoto(alice.token);
    await setCover(alice.token, cover);
    await client.patch("/api/v1/users/me", { isPrivate: true }, authHeader(alice.token));

    const profile = await client.get(`/api/v1/users/${alice.username}`, authHeader(bob.token));
    assert.equal(profile.body.profile.coverMediaId, cover, "a private account's header shows its cover, like its avatar");
    assert.equal(await coverFile(alice.username, bob.token, cover), 200);
    assert.equal(await coverFile(alice.username, null, cover), 401, "signed out, like the avatar");

    // Lists of people never carry it: only the profile header shows a cover.
    const search = await client.get(`/api/v1/search/users?q=${alice.username}`, authHeader(bob.token));
    const found = (search.body.results as Array<Record<string, unknown>>).find((p) => p.username === alice.username)!;
    assert.ok(found && !("coverMediaId" in found));

    await client.post(`/api/v1/users/${bob.username}/block`, undefined, authHeader(alice.token));
    assert.equal(await coverFile(alice.username, bob.token, cover), 404, "blocked by its owner");
    assert.equal(await coverFile(alice.username, alice.token, cover), 200, "its owner still sees it");
    await client.delete(`/api/v1/users/${bob.username}/block`, authHeader(alice.token));
    await client.post(`/api/v1/users/${alice.username}/block`, undefined, authHeader(bob.token));
    assert.equal(await coverFile(alice.username, bob.token, cover), 404, "blocked by the viewer");

    // A suspended account's cover isn't served either.
    const carol = await signup();
    assert.equal(await coverFile(alice.username, carol.token, cover), 200);
    await query(`UPDATE users SET is_active = false WHERE id = :'id'`, { id: alice.id });
    assert.equal(await coverFile(alice.username, carol.token, cover), 404);
  });
});

describe("cleanup", () => {
  it("a cover in use is never purged as unused; a replaced one is", async () => {
    const alice = await signup();
    const [kept, replaced] = [await uploadPhoto(alice.token), await uploadPhoto(alice.token)];
    await setCover(alice.token, replaced);
    await setCover(alice.token, kept);
    await query(`UPDATE media SET created_at = now() - interval '49 hours' WHERE id IN (:'a', :'b')`, { a: kept, b: replaced });
    assert.equal((await queryOne(`SELECT media_in_use(:'id') AS used`, { id: kept }))?.used, "t", "an ID photo can't reuse it");
    assert.equal(await queryOne(`SELECT id FROM claim_unused_media_for_purge(:'id'::uuid, 48)`, { id: kept }), null);
    assert.ok((await unusedMedia(mediaStorage, 200, 48)) >= 1);
    assert.equal(await purgedAt(kept), null, "the cover in use is untouched");
    assert.equal(await queryOne(`SELECT id FROM media WHERE id = :'id'`, { id: replaced }), null, "the replaced cover was deleted");
    assert.equal(await coverFile(alice.username, alice.token, kept), 200);
  });

  it("deleting the account takes the cover down at once, and its media with the account's data", async () => {
    const alice = await signup();
    const cover = await uploadPhoto(alice.token);
    await setCover(alice.token, cover);
    const viewer = await signup();
    const deleted = await client.deleteWithBody("/api/v1/users/me", { password: alice.password }, authHeader(alice.token));
    assert.equal(deleted.status, 204, JSON.stringify(deleted.body));
    assert.equal(await coverFile(alice.username, viewer.token, cover), 404);

    await query(`UPDATE users SET deleted_at = now() - interval '31 days' WHERE id = :'id'`, { id: alice.id });
    assert.ok((await deletedAccounts(mediaStorage, 200, 30, 180)) >= 1);
    assert.equal((await queryOne(`SELECT cover_media_id FROM users WHERE id = :'id'`, { id: alice.id }))?.cover_media_id, null);
    assert.notEqual(await purgedAt(cover), null, "the cover's files are gone");
  });
});

describe("moderation", () => {
  it("a reported profile includes its cover; an admin with content.remove takes it off, audit-logged", async () => {
    const [alice, reporter, moderator, viewerOnly] = [await signup(), await signup(), await signup(), await signup()];
    const cover = await uploadPhoto(alice.token);
    await setCover(alice.token, cover);
    const report = await client.post("/api/v1/reports", { targetType: "user", targetId: alice.id, reason: "harassment", details: "the cover photo" }, authHeader(reporter.token));
    assert.equal(report.status, 201, JSON.stringify(report.body));

    await query(`INSERT INTO admin_grants(user_id, role, permissions) VALUES (:'id', 'ADMIN', '["reports.read", "reports.review", "content.remove", "users.view"]'::jsonb)`, { id: moderator.id });
    await query(`INSERT INTO admin_grants(user_id, role, permissions) VALUES (:'id', 'ADMIN', '["users.view"]'::jsonb)`, { id: viewerOnly.id });
    const admin = await adminSignIn(baseUrl, moderator.email, moderator.password);
    const viewer = await adminSignIn(baseUrl, viewerOnly.email, viewerOnly.password);

    const detail = await fetch(`${baseUrl}/api/v1/admin/reports/${report.body.report.id}`, { headers: admin });
    assert.equal(((await detail.json()) as { target: { hasCover: boolean } }).target.hasCover, true);
    const users = (await (await fetch(`${baseUrl}/api/v1/admin/users?search=${alice.username}`, { headers: viewer })).json()) as { items: Array<{ hasCover: boolean }> };
    assert.equal(users.items[0]?.hasCover, true);
    const image = await fetch(`${baseUrl}/api/v1/admin/users/${alice.id}/cover`, { headers: viewer });
    assert.equal(image.status, 200);
    await image.arrayBuffer();

    const remove = (headers: Record<string, string>, body: Record<string, unknown>) =>
      fetch(`${baseUrl}/api/v1/admin/users/${alice.id}/cover/remove`, { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    assert.equal((await remove(viewer, { reason: "Offensive", confirmed: true })).status, 403, "users.view alone can't remove it");
    assert.equal((await remove(admin, { reason: "Offensive" })).status, 422, "needs explicit confirmation");
    const done = await remove(admin, { reason: "Offensive cover photo", confirmed: true });
    assert.equal(done.status, 200);
    assert.deepEqual(await done.json(), { userId: alice.id, mediaId: cover });
    assert.equal((await remove(admin, { reason: "Again", confirmed: true })).status, 404, "nothing left to remove");

    const audit = await queryOne(`SELECT actor_id, metadata FROM admin_audit WHERE action = 'USER_COVER_REMOVED' AND target_id = :'id'`, { id: alice.id });
    assert.equal(audit?.actor_id, moderator.id);
    assert.deepEqual(JSON.parse(String(audit?.metadata)), { mediaId: cover, reason: "Offensive cover photo" });
    assert.equal((await client.get(`/api/v1/users/${alice.username}`, authHeader(reporter.token))).body.profile.coverMediaId, null);
    assert.equal(await coverFile(alice.username, reporter.token, cover), 404);
    assert.equal((await fetch(`${baseUrl}/api/v1/admin/users/${alice.id}/cover`, { headers: viewer })).status, 404);
    // Nothing else on the profile changed.
    assert.equal((await client.get("/api/v1/auth/me", authHeader(alice.token))).body.user.displayName, alice.displayName);
  });
});
