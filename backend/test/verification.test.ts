import "./admin-env";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { buildApp } from "../src/app";
import { query, queryOne } from "../src/db/psql";
import { uniqueUser } from "./helpers";
import { buildTestPng } from "./fixtures";
import { adminSignIn, type AdminHeaders } from "./adminSession";
import { renderPush } from "../src/modules/push/dispatcher";
import { unusedMedia, verificationPhotos } from "../src/modules/media/retention";
import { mediaStorage } from "../src/modules/media/instance";

// The verified badge: who may apply, the private ID photo, the admin queue, and where the badge shows.
const server = buildApp();
let base = "";
before(async () => {
  await new Promise<void>((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); });

async function request(path: string, method: string, body: unknown, headers: Record<string, string>) {
  const r = await fetch(base + path, { method, headers: { "Content-Type": "application/json", ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const text = await r.text();
  return { status: r.status, body: text && r.headers.get("content-type")?.includes("json") ? JSON.parse(text) : text, type: r.headers.get("content-type") };
}
interface Person { id: string; username: string; email: string; password: string; displayName: string; auth: Record<string, string> }
async function person(over: Record<string, unknown> = {}): Promise<Person> {
  const input = { ...uniqueUser(), ...over };
  const res = await request("/api/v1/auth/signup", "POST", input, {});
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return { ...input, id: res.body.user.id as string, auth: { Authorization: `Bearer ${res.body.tokens.accessToken}` } } as Person;
}
async function photo(p: Person): Promise<string> {
  const r = await fetch(base + "/api/v1/media/photos", { method: "POST", headers: { Authorization: p.auth.Authorization!, "Content-Type": "image/png" }, body: buildTestPng(8, 8) });
  assert.equal(r.status, 201);
  return ((await r.json()) as { media: { id: string } }).media.id;
}
/** Everything the rules ask for: a verified email, 30 days, a profile photo and a bio. */
async function eligible(over: Record<string, unknown> = {}): Promise<Person> {
  const p = await person(over);
  const avatar = await photo(p);
  await query(`UPDATE users SET email_verified_at = now(), created_at = now() - interval '40 days', avatar_media_id = :'a', bio = 'Singer from Pune' WHERE id = :'id'`, { id: p.id, a: avatar });
  return p;
}
const application = (idMediaId: string, over: Record<string, unknown> = {}) =>
  ({ category: "creator", fullName: "Asha Rao", links: ["https://example.com/asha", "https://news.example.org/story"], idMediaId, ...over });
async function apply(p: Person, over: Record<string, unknown> = {}) {
  return request("/api/v1/me/verification", "POST", application(await photo(p), over), p.auth);
}
async function admin(grant: string[]): Promise<AdminHeaders> {
  const p = await person();
  await query(`INSERT INTO admin_grants(user_id, role, permissions) VALUES (:'id', 'ADMIN', :'p'::jsonb)`, { id: p.id, p: JSON.stringify(grant) });
  return adminSignIn(base, p.email, p.password);
}
const status = async (p: Person) => (await request("/api/v1/me/verification", "GET", undefined, p.auth)).body;
const audited = async (action: string, target: string) =>
  Number((await queryOne(`SELECT count(*) AS n FROM admin_audit WHERE action = :'a' AND target_id = :'t'`, { a: action, t: target }))!.n);
const latestNotification = async (p: Person) => (await request("/api/v1/notifications", "GET", undefined, p.auth)).body.notifications[0];

describe("applying", () => {
  it("a new account is told what it still needs, and can't apply", async () => {
    const p = await person();
    const s = await status(p);
    assert.deepEqual([s.verified, s.onHold, s.category, s.request, s.eligibility.eligible], [false, false, null, null, false]);
    const reasons = s.eligibility.reasons as string[];
    assert.ok(reasons.includes("Verify your email address."));
    assert.ok(reasons.some((r) => /^Your account needs to be 30 days old \(on \d{1,2} [A-Z][a-z]{2} \d{4}\)\.$/.test(r)), reasons.join("|"));
    assert.ok(reasons.includes("Add a profile photo.") && reasons.includes("Add a bio."));
    const refused = await apply(p);
    assert.equal(refused.status, 403);
    assert.deepEqual(refused.body.reasons, reasons);

    // An upheld report in the last 90 days, or a restriction, keeps an otherwise ready account out.
    const q = await eligible();
    assert.deepEqual((await status(q)).eligibility, { eligible: true, reasons: [] });
    await query(`INSERT INTO reports (reporter_id, target_type, target_id, reason, status, reviewed_at) VALUES (:'r', 'user', :'t', 'spam', 'ACTIONED', now() - interval '10 days')`, { r: p.id, t: q.id });
    assert.deepEqual((await status(q)).eligibility.reasons, ["Your account has a recent upheld report."]);
    await query(`UPDATE reports SET reviewed_at = now() - interval '100 days' WHERE target_id = :'t'`, { t: q.id });
    await query(`UPDATE users SET moderation_state = 'RESTRICTED' WHERE id = :'id'`, { id: q.id });
    assert.deepEqual((await status(q)).eligibility.reasons, ["Your account is restricted."]);
  });

  it("checks the request, takes one at a time, and can be withdrawn", async () => {
    const p = await eligible();
    for (const over of [{ category: "celebrity" }, { fullName: "" }, { fullName: "x".repeat(81) }, { links: [] }, { links: ["http://example.com"] },
      { links: Array.from({ length: 6 }, (_, i) => `https://e${i}.example.com`) }, { links: ["https://example.com/" + "x".repeat(300)] }, { idMediaId: "nope" }]) {
      const r = await request("/api/v1/me/verification", "POST", application("00000000-0000-4000-8000-000000000000", over), p.auth);
      assert.equal(r.status, 422, JSON.stringify(over));
      assert.ok(r.body.fields, "field errors");
    }
    // Only a fresh upload of your own: not someone else's, not your profile photo.
    const other = await person();
    assert.equal((await request("/api/v1/me/verification", "POST", application(await photo(other)), p.auth)).status, 422);
    const avatar = (await queryOne(`SELECT avatar_media_id FROM users WHERE id = :'id'`, { id: p.id }))!.avatar_media_id!;
    assert.equal((await request("/api/v1/me/verification", "POST", application(avatar), p.auth)).status, 422);

    const sent = await apply(p, { category: "public_figure", fullName: "  Asha   Rao " });
    assert.equal(sent.status, 201, JSON.stringify(sent.body));
    const r = sent.body.request;
    assert.deepEqual({ ...r, id: undefined, createdAt: undefined },
      { id: undefined, createdAt: undefined, status: "pending", category: "public_figure", fullName: "Asha Rao", links: ["https://example.com/asha", "https://news.example.org/story"], decidedAt: null, denialReason: null, canReapplyAt: null });
    assert.ok(!Number.isNaN(Date.parse(r.createdAt)));
    assert.equal((await apply(p)).status, 409, "one request at a time");
    const s = await status(p);
    assert.deepEqual([s.request.id, s.eligibility.eligible, s.eligibility.reasons], [r.id, false, ["Your request is being reviewed."]]);

    assert.equal((await request("/api/v1/me/verification", "DELETE", undefined, p.auth)).status, 204);
    assert.equal((await request("/api/v1/me/verification", "DELETE", undefined, p.auth)).status, 404);
    assert.equal((await status(p)).request.status, "withdrawn");
    assert.equal((await request("/api/v1/me/verification", "GET", undefined, {})).status, 401);
  });

  it("five requests a day at most", async () => {
    const p = await eligible();
    for (let i = 0; i < 5; i++) {
      assert.equal((await apply(p)).status, 201);
      assert.equal((await request("/api/v1/me/verification", "DELETE", undefined, p.auth)).status, 204);
    }
    assert.equal((await apply(p)).status, 429);
  });
});

describe("the ID photo", () => {
  it("is never served by the media routes, even to its owner, nor used anywhere else", async () => {
    const p = await eligible();
    const id = await photo(p);
    assert.equal((await request(`/api/v1/media/${id}`, "GET", undefined, p.auth)).status, 200, "an ordinary upload until attached");
    assert.equal((await request("/api/v1/me/verification", "POST", application(id), p.auth)).status, 201);
    assert.equal((await request(`/api/v1/media/${id}`, "GET", undefined, p.auth)).status, 404);
    for (const variant of ["", "?variant=original", "?variant=display", "?variant=thumbnail"]) {
      assert.equal((await fetch(`${base}/api/v1/media/${id}/file${variant}`, { headers: p.auth })).status, 404, variant);
    }
    assert.equal((await request("/api/v1/users/me", "PATCH", { avatarMediaId: id }, p.auth)).status, 400);
    assert.equal((await request("/api/v1/stories", "POST", { mediaId: id, caption: "", audience: "public", allowComments: "everyone", allowSharing: true }, p.auth)).status, 404);
    assert.equal((await request("/api/v1/feedback", "POST", { body: "look", screenshotMediaId: id }, { ...p.auth, "X-Katkee-Platform": "ios" })).status, 422);
    const friend = await person();
    const chat = (await request(`/api/v1/users/${friend.username}/conversation`, "POST", undefined, p.auth)).body.conversation.id as string;
    assert.equal((await request(`/api/v1/conversations/${chat}/messages`, "POST", { mediaId: id }, p.auth)).status, 422);

    // Unused-media cleanup leaves it for the verification retention job.
    await query(`UPDATE media SET created_at = now() - interval '49 hours' WHERE id = :'id'`, { id });
    await unusedMedia(mediaStorage, 500, 48);
    assert.ok(await queryOne(`SELECT id FROM media WHERE id = :'id' AND purged_at IS NULL AND verification_document`, { id }));
  });

  it("is deleted 30 days after the decision; a pending one stays", async () => {
    const [a, b] = [await eligible(), await eligible()];
    const old = (await apply(a)).body.request.id as string;
    await request("/api/v1/me/verification", "DELETE", undefined, a.auth);
    const waiting = (await apply(b)).body.request.id as string;
    await query(`UPDATE verification_requests SET decided_at = now() - interval '31 days', created_at = now() - interval '40 days' WHERE id = :'id'`, { id: old });
    await query(`UPDATE verification_requests SET created_at = now() - interval '60 days' WHERE id = :'id'`, { id: waiting });
    const media = (await queryOne(`SELECT id_media_id FROM verification_requests WHERE id = :'id'`, { id: old }))!.id_media_id!;
    assert.ok((await verificationPhotos(mediaStorage, 100, 30)) >= 1);
    const row = await queryOne(`SELECT id_media_id, id_deleted_at FROM verification_requests WHERE id = :'id'`, { id: old });
    assert.equal(row!.id_media_id, null);
    assert.ok(row!.id_deleted_at);
    assert.equal(await queryOne(`SELECT id FROM media WHERE id = :'id'`, { id: media }), null);
    assert.ok((await queryOne(`SELECT id_media_id FROM verification_requests WHERE id = :'id'`, { id: waiting }))!.id_media_id);
  });

  it("goes at once when the account is deleted", async () => {
    const p = await eligible();
    await apply(p);
    const media = (await queryOne(`SELECT id_media_id FROM verification_requests WHERE user_id = :'id'`, { id: p.id }))!.id_media_id!;
    assert.equal((await fetch(`${base}/api/v1/users/me`, { method: "DELETE", headers: { ...p.auth, "Content-Type": "application/json" }, body: JSON.stringify({ password: p.password }) })).status, 204);
    assert.equal(await queryOne(`SELECT id FROM verification_requests WHERE user_id = :'id'`, { id: p.id }), null);
    assert.equal(await queryOne(`SELECT id FROM media WHERE id = :'id'`, { id: media }), null);
  });
});

describe("the admin queue", () => {
  it("needs verification.review; approving shows the badge everywhere and tells the person", async () => {
    const p = await eligible();
    const req = (await apply(p, { category: "news_media" })).body.request.id as string;
    const none = await admin(["reports.read"]);
    for (const [path, method] of [["/api/v1/admin/verification", "GET"], [`/api/v1/admin/verification/requests/${req}`, "GET"],
      [`/api/v1/admin/verification/requests/${req}/id-photo`, "GET"], [`/api/v1/admin/verification/requests/${req}/approve`, "POST"]] as const) {
      assert.equal((await request(path, method, method === "POST" ? {} : undefined, none)).status, 403, path);
    }
    assert.equal(await audited("VERIFICATION_ID_VIEWED", p.id), 0);

    const h = await admin(["verification.review"]);
    const q = (await request("/api/v1/admin/verification", "GET", undefined, h)).body;
    const item = (q.pending as Array<{ id: string; user: { username: string; hasAvatar: boolean } }>).find((x) => x.id === req)!;
    assert.deepEqual([item.user.username, item.user.hasAvatar], [p.username, true]);
    const detail = (await request(`/api/v1/admin/verification/requests/${req}`, "GET", undefined, h)).body.request;
    assert.deepEqual([detail.fullName, detail.hasIdPhoto, detail.user.emailVerified, detail.user.upheldReports90d], ["Asha Rao", true, true, 0]);
    const avatar = await fetch(`${base}/api/v1/admin/verification/users/${p.id}/avatar`, { headers: h });
    assert.equal(avatar.status, 200);

    const image = await fetch(`${base}/api/v1/admin/verification/requests/${req}/id-photo`, { headers: h });
    assert.equal(image.status, 200);
    assert.match(String(image.headers.get("content-type")), /^image\//);
    assert.match(String(image.headers.get("cache-control")), /no-store/);
    assert.equal(await audited("VERIFICATION_ID_VIEWED", p.id), 1, "each view is audited");

    // Someone who follows the person, to see the badge on the follow notification's actor.
    const fan = await person();
    assert.equal((await request(`/api/v1/admin/verification/requests/${req}/approve`, "POST", {}, h)).status, 204);
    assert.equal((await request(`/api/v1/admin/verification/requests/${req}/approve`, "POST", {}, h)).status, 409);
    assert.equal(await audited("VERIFICATION_APPROVED", p.id), 1);

    const s = await status(p);
    assert.deepEqual([s.verified, s.onHold, s.category, s.request.status], [true, false, "news_media", "approved"]);
    const note = await latestNotification(p);
    assert.deepEqual([note.type, note.actor, note.verification], ["verification", null, { status: "approved", reason: null }]);
    const push = await queryOne(`SELECT id, user_id, kind, actor_id, ref_id, attempts, body, link FROM push_outbox WHERE user_id = :'id' AND kind = 'verification'`, { id: p.id });
    assert.deepEqual([push!.body, push!.link], ["You're verified. Your badge now shows on your profile.", "katkee://verification"]);
    const rendered = await renderPush({ id: push!.id!, userId: p.id, kind: "verification", actorId: null, refId: null, attempts: 0, body: push!.body ?? null, link: push!.link ?? null });
    assert.ok("message" in rendered && rendered.message.data.url === "katkee://verification");

    // The badge on user summaries: profile, me, search, a Story owner in the feed, a notification actor.
    const profile = (await request(`/api/v1/users/${p.username}`, "GET", undefined, fan.auth)).body.profile;
    assert.deepEqual([profile.verified, profile.verifiedCategory], [true, "news_media"]);
    const me = (await request("/api/v1/auth/me", "GET", undefined, p.auth)).body;
    assert.equal((me.user ?? me).verified, true);
    const found = (await request(`/api/v1/search/users?q=${p.username}`, "GET", undefined, fan.auth)).body.results as Array<{ id: string; verified: boolean }>;
    assert.equal(found.find((x) => x.id === p.id)?.verified, true);
    assert.equal((await request(`/api/v1/users/${p.username}/follow`, "POST", undefined, fan.auth)).status < 300, true);
    assert.equal((await request(`/api/v1/users/${fan.username}/follow`, "POST", undefined, p.auth)).status < 300, true);
    const story = await request("/api/v1/stories", "POST", { mediaId: await photo(p), caption: "", audience: "public", allowComments: "everyone", allowSharing: true }, p.auth);
    assert.equal(story.status, 201, JSON.stringify(story.body));
    const feed = (await request("/api/v1/stories/feed/following", "GET", undefined, fan.auth)).body;
    const entry = (feed.feed ?? feed.entries ?? feed) as Array<{ owner: { id: string; verified: boolean } }>;
    assert.equal(entry.find((e) => e.owner.id === p.id)?.owner.verified, true);
    const followNote = await latestNotification(fan);
    assert.deepEqual([followNote.type, followNote.actor.id, followNote.actor.verified], ["follow", p.id, true]);
    const followers = (await request(`/api/v1/users/${fan.username}/followers`, "GET", undefined, fan.auth)).body.followers as Array<{ id: string; verified: boolean }>;
    assert.equal(followers.find((x) => x.id === p.id)?.verified, true);
    assert.equal((await apply(p)).status, 409, "already verified");
  });

  it("a rename puts the badge on hold until an admin restores or removes it", async () => {
    const p = await eligible();
    const h = await admin(["verification.review"]);
    await request(`/api/v1/admin/verification/requests/${(await apply(p)).body.request.id}/approve`, "POST", {}, h);
    // A bio edit changes nothing.
    assert.equal((await request("/api/v1/users/me", "PATCH", { bio: "New bio" }, p.auth)).body.user.verified, true);
    const renamed = await request("/api/v1/users/me", "PATCH", { displayName: "Asha R" }, p.auth);
    assert.equal(renamed.status, 200);
    assert.equal(renamed.body.user.verified, false);
    const s = await status(p);
    assert.deepEqual([s.verified, s.onHold, s.eligibility.eligible], [false, true, true]);
    assert.equal((await request(`/api/v1/users/${p.username}`, "GET", undefined, p.auth)).body.profile.verifiedCategory, null);

    const held = ((await request("/api/v1/admin/verification", "GET", undefined, h)).body.held as Array<{ id: string; previous: { displayName: string } }>).find((u) => u.id === p.id)!;
    assert.equal(held.previous.displayName, p.displayName);
    assert.equal((await request(`/api/v1/admin/verification/users/${p.id}/restore`, "POST", {}, h)).status, 204);
    assert.equal((await status(p)).verified, true);
    assert.deepEqual((await latestNotification(p)).verification, { status: "restored", reason: null });
    assert.equal(await audited("VERIFICATION_RESTORED", p.id), 1);
    assert.equal((await request(`/api/v1/admin/verification/users/${p.id}/restore`, "POST", {}, h)).status, 404, "nothing on hold");

    // A username change holds it too; then the admin removes it, with a reason the person sees.
    await request("/api/v1/users/me", "PATCH", { username: `${p.username}_x`.slice(0, 30) }, p.auth);
    assert.equal((await status(p)).onHold, true);
    assert.equal((await request(`/api/v1/admin/verification/users/${p.id}/remove`, "POST", {}, h)).status, 422, "reason required");
    assert.equal((await request(`/api/v1/admin/verification/users/${p.id}/remove`, "POST", { reason: "The new name isn't the verified one." }, h)).status, 204);
    const after = await status(p);
    assert.deepEqual([after.verified, after.onHold, after.category], [false, false, null]);
    assert.deepEqual((await latestNotification(p)).verification, { status: "removed", reason: "The new name isn't the verified one." });
    assert.equal(await audited("VERIFICATION_REMOVED", p.id), 1);
  });

  it("a denial is explained, and the person can try again after 30 days", async () => {
    const p = await eligible();
    const h = await admin(["verification.review"]);
    const req = (await apply(p)).body.request.id as string;
    assert.equal((await request(`/api/v1/admin/verification/requests/${req}/deny`, "POST", { reason: "" }, h)).status, 422);
    assert.equal((await request(`/api/v1/admin/verification/requests/${req}/deny`, "POST", { reason: "The links don't show you're notable yet." }, h)).status, 204);
    assert.equal(await audited("VERIFICATION_DENIED", p.id), 1);
    const s = await status(p);
    assert.deepEqual([s.request.status, s.request.denialReason], ["denied", "The links don't show you're notable yet."]);
    assert.equal(Date.parse(s.request.canReapplyAt) - Date.parse(s.request.decidedAt), 30 * 86_400_000);
    assert.match(s.eligibility.reasons[0], /^You can apply again on /);
    assert.deepEqual((await latestNotification(p)).verification, { status: "denied", reason: "The links don't show you're notable yet." });
    assert.equal((await apply(p)).status, 403);
    await query(`UPDATE verification_requests SET decided_at = now() - interval '31 days', created_at = now() - interval '31 days' WHERE id = :'id'`, { id: req });
    assert.equal((await apply(p)).status, 201);
  });

  it("a suspension or restriction takes the badge away", async () => {
    const h = await admin(["verification.review"]);
    for (const change of ["moderation_state = 'SUSPENDED', is_active = false", "moderation_state = 'RESTRICTED'"]) {
      const p = await eligible();
      await request(`/api/v1/admin/verification/requests/${(await apply(p)).body.request.id}/approve`, "POST", {}, h);
      assert.ok((await queryOne(`SELECT verified_at FROM users WHERE id = :'id'`, { id: p.id }))!.verified_at);
      await query(`UPDATE users SET ${change} WHERE id = :'id'`, { id: p.id });
      await query(`UPDATE users SET moderation_state = 'ACTIVE', is_active = true WHERE id = :'id'`, { id: p.id });
      assert.equal((await status(p)).verified, false, change);
    }
  });
});

describe("names", () => {
  it("can't include check marks, at sign-up or in Edit Profile", async () => {
    for (const name of ["Asha ✓", "✔ Asha", "Asha ✅", "Asha ☑", "Asha 🗸", "Asha ✓︎"]) {
      const r = await request("/api/v1/auth/signup", "POST", { ...uniqueUser(), displayName: name }, {});
      assert.equal(r.status, 422, name);
      assert.equal(r.body.fields.displayName, "Names can't include check marks.");
    }
    const r = await request("/api/v1/auth/signup", "POST", { ...uniqueUser(), username: "asha✓rao" }, {});
    assert.equal(r.body.fields.username, "Names can't include check marks.");
    const p = await person();
    const edit = await request("/api/v1/users/me", "PATCH", { displayName: "Asha ✔" }, p.auth);
    assert.deepEqual([edit.status, edit.body.fields?.displayName], [422, "Names can't include check marks."]);
    assert.equal((await request("/api/v1/users/me", "PATCH", { displayName: "Asha Rao" }, p.auth)).status, 200);
  });
});
