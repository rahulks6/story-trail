// Cross-user access (release gate 26, IDOR). Every route that takes an id or a username is tried
// by someone with no right to what it names: a private account's Story, Highlight, media, upload,
// publish request, sign-in, notifications and follow requests, a conversation between two other
// people, and a Sponsored Story delivered to someone else. A refusal must change nothing and
// leak nothing. The last test fails when a parameterized route exists that no test here tried.
import "./admin-env";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { buildApp } from "../src/app";
import { query, queryOne } from "../src/db/psql";
import { buildTestPng } from "./fixtures";
import { adminSignIn } from "./adminSession";
import { clientUploadId, createUploadSession, uploadDirect } from "./mediaHelpers";

const server = buildApp();
let base = "";
type Reply = { status: number; body: any; text: string };
async function request(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Reply> {
  const res = await fetch(base + path, { method, headers: { "Content-Type": "application/json", ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const text = await res.text();
  let parsed: unknown = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
  return { status: res.status, body: parsed, text };
}

interface Person { id: string; username: string; email: string; password: string; token: string; auth: Record<string, string> }
async function person(label: string): Promise<Person> {
  const tag = randomUUID().slice(0, 8);
  const input = { username: `${label}_${tag}`, email: `${label}_${tag}@example.com`, password: "correcthorsebattery", displayName: `${label} ${tag}` };
  const r = await request("POST", "/api/v1/auth/signup", input);
  assert.equal(r.status, 201, r.text);
  return { id: r.body.user.id, username: input.username, email: input.email, password: input.password, token: r.body.tokens.accessToken, auth: { Authorization: `Bearer ${r.body.tokens.accessToken}` } };
}
async function photo(owner: Person): Promise<string> {
  const r = await fetch(`${base}/api/v1/media/photos`, { method: "POST", headers: { "Content-Type": "image/png", ...owner.auth }, body: buildTestPng(6, 6) });
  assert.equal(r.status, 201);
  return ((await r.json()) as { media: { id: string } }).media.id;
}
async function story(owner: Person, caption: string, audience: "public" | "followers" = "public"): Promise<string> {
  const r = await request("POST", "/api/v1/stories", { mediaId: await photo(owner), caption, audience, allowComments: "everyone", allowSharing: true }, owner.auth);
  assert.equal(r.status, 201, r.text);
  return r.body.story.id;
}

// What the owner's private things say; no refusal may contain any of it.
const SECRET = { caption: `owner-private-caption-${randomUUID()}`, message: `private-note-${randomUUID()}`, comment: `friend-comment-${randomUUID()}`, highlight: "Owner only" };

let owner: Person, friend: Person, requester: Person, stranger: Person, creator: Person, adViewer: Person;
const ids = {} as Record<
  "pendingRequest" | "story" | "storyMedia" | "draftMedia" | "highlight" | "comment" | "notification" | "conversation" | "message" | "session"
  | "upload" | "partUrl" | "processingMedia" | "publishRequest" | "publicStory" | "followersStory" | "delivery",
  string
>;

before(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const people = await Promise.all(["owner", "friend", "requester", "stranger", "creator", "viewer"].map(person));
  [owner, friend, requester, stranger, creator, adViewer] = people as [Person, Person, Person, Person, Person, Person];

  // A private account with one accepted follower and one pending request.
  assert.equal((await request("PATCH", "/api/v1/users/me", { isPrivate: true }, owner.auth)).status, 200);
  await request("POST", `/api/v1/users/${owner.username}/follow`, undefined, friend.auth);
  await request("POST", `/api/v1/users/${owner.username}/follow`, undefined, requester.auth);
  const pending = (await request("GET", "/api/v1/follow-requests", undefined, owner.auth)).body.requests as Array<{ requestId: string; username: string }>;
  assert.equal((await request("POST", `/api/v1/follow-requests/${pending.find((r) => r.username === friend.username)!.requestId}/accept`, undefined, owner.auth)).status, 204);
  ids.pendingRequest = pending.find((r) => r.username === requester.username)!.requestId;

  ids.story = await story(owner, SECRET.caption);
  ids.storyMedia = (await queryOne(`SELECT media_id FROM stories WHERE id = :'id'`, { id: ids.story }))!.media_id!;
  ids.draftMedia = await photo(owner);
  ids.highlight = (await request("POST", "/api/v1/highlights", { title: SECRET.highlight, storyIds: [ids.story] }, owner.auth)).body.highlight.id;
  await request("POST", `/api/v1/stories/${ids.story}/view`, undefined, friend.auth);
  await request("POST", `/api/v1/stories/${ids.story}/like`, undefined, friend.auth);
  ids.comment = (await request("POST", `/api/v1/stories/${ids.story}/comments`, { body: SECRET.comment }, friend.auth)).body.comment.id;
  ids.notification = (await request("GET", "/api/v1/notifications", undefined, owner.auth)).body.notifications.find((n: { readAt: string | null }) => n.readAt === null).id;
  ids.conversation = (await request("POST", `/api/v1/users/${friend.username}/conversation`, undefined, owner.auth)).body.conversation.id;
  ids.message = (await request("POST", `/api/v1/conversations/${ids.conversation}/messages`, { body: SECRET.message }, owner.auth)).body.message.id;
  ids.session = (await request("GET", "/api/v1/auth/sessions", undefined, owner.auth)).body.sessions[0].id;

  // An upload in progress, and one waiting for processing behind a publish request.
  const upload = await createUploadSession(base, owner.token, { clientUploadId: clientUploadId(), kind: "photo", mimeType: "image/png", byteSize: 6_000_000 });
  assert.equal(upload.status, 201, JSON.stringify(upload.body));
  ids.upload = upload.body.media.id;
  ids.partUrl = upload.body.upload.parts[0].url;
  const processing = await uploadDirect(base, owner.token, buildTestPng(8, 8), "photo", "image/png");
  ids.processingMedia = processing.id;
  ids.publishRequest = `ownerpublish_${randomUUID().replace(/-/g, "")}`;
  const queued = await request("POST", "/api/v1/stories", { mediaId: processing.id, caption: SECRET.caption, audience: "public", allowComments: "everyone", allowSharing: true, requestId: ids.publishRequest }, owner.auth);
  assert.equal(queued.status, 202, queued.text);

  // A public creator's Stories: one for everyone, one for followers only.
  ids.publicStory = await story(creator, "for everyone");
  ids.followersStory = await story(creator, `followers-only-${randomUUID()}`, "followers");

  // A Sponsored Story delivered to someone else.
  const grant = (p: Person, permissions: string[]) => query(`INSERT INTO admin_grants(user_id, role, permissions) VALUES (:'id', 'ADMIN', :'p'::jsonb)`, { id: p.id, p: JSON.stringify(permissions) });
  const [adCreator, adReviewer] = await Promise.all([person("adcreator"), person("adreviewer")]);
  await grant(adCreator, ["ads.create", "ads.edit", "ads.pause"]);
  await grant(adReviewer, ["ads.review"]);
  const ch = await adminSignIn(base, adCreator.email, adCreator.password);
  const rh = await adminSignIn(base, adReviewer.email, adReviewer.password);
  const advertiser = (await request("POST", "/api/v1/admin/advertisers", { name: "Access Test Brand", userId: adCreator.id, confirmed: true }, ch)).body.id;
  const campaign = await request("POST", "/api/v1/admin/campaigns", {
    advertiserId: advertiser, mediaId: await photo(adCreator), name: `Access ${randomUUID().slice(0, 6)}`,
    startAt: new Date(Date.now() - 60_000).toISOString(), endAt: new Date(Date.now() + 3_600_000).toISOString(),
    budgetMinor: 50000, currency: "INR", impressionLimit: 100, userCap: 2, dailyCap: 2,
    caption: "Access test", cta: "Learn More", destination: "https://example.com/offer", confirmed: true,
  }, ch);
  assert.equal(campaign.status, 201, campaign.text);
  let state = campaign.body as { id: string; version: number };
  for (const [action, headers] of [["submit", ch], ["approve", rh], ["activate", ch]] as const) {
    const r = await request("POST", `/api/v1/admin/campaigns/${state.id}/transition`, { action, version: state.version, reason: `${action} for access test`, confirmed: true }, headers);
    assert.equal(r.status, 200, r.text);
    state = { id: state.id, version: r.body.version };
  }
  const placements = await request("GET", "/api/v1/ads/placements?organicCount=12", undefined, adViewer.auth);
  ids.delivery = placements.body.items[0].deliveryId;
});

after(async () => {
  await query(`UPDATE ad_campaigns SET status = 'COMPLETED' WHERE status IN ('ACTIVE', 'PAUSED', 'APPROVED')`);
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

// --- the attempts -------------------------------------------------------------------------

const exercised = new Set<string>();
const DENIED = [401, 403, 404];

/** Calls `path` for the route `key` ("METHOD /pattern"), recording that the route was tried. */
async function attempt(key: string, path: string, who: Person | null, body?: unknown, headers: Record<string, string> = {}): Promise<Reply> {
  const [method, pattern] = key.split(" ") as [string, string];
  const segments = pattern.split("/"), actual = path.split("?")[0]!.split("/");
  assert.ok(segments.length === actual.length && segments.every((s, i) => s.startsWith(":") || s === actual[i]), `${path} is not ${pattern}`);
  exercised.add(key);
  return request(method, path, body, { ...(who?.auth ?? {}), ...headers });
}

/** Refused, and nothing private in the answer. */
function refused(reply: Reply, key: string, allowed = DENIED): void {
  assert.ok(allowed.includes(reply.status), `${key}: expected ${allowed.join("/")}, got ${reply.status} ${reply.text.slice(0, 200)}`);
  for (const secret of [...Object.values(SECRET), owner.email]) assert.ok(!reply.text.includes(secret), `${key} leaked ${secret}`);
}
const count = async (sql: string, params: Record<string, string>) => Number((await queryOne(`SELECT count(*) AS n FROM ${sql}`, params))!.n);

describe("a private account's Story", () => {
  it("can't be read, watched, counted, liked, commented on, shared or deleted by a stranger", async () => {
    const s = `/api/v1/stories/${ids.story}`;
    refused(await attempt("GET /api/v1/stories/:id", s, stranger), "story");
    refused(await attempt("GET /api/v1/stories/:id/owner", `${s}/owner`, stranger), "owner");
    refused(await attempt("GET /api/v1/stories/:id/views", `${s}/views`, stranger), "views");
    refused(await attempt("GET /api/v1/stories/:id/viewers", `${s}/viewers`, stranger), "viewers");
    refused(await attempt("GET /api/v1/stories/:id/insights", `${s}/insights`, stranger), "insights");
    refused(await attempt("GET /api/v1/stories/:id/comments", `${s}/comments`, stranger), "comments");
    refused(await attempt("POST /api/v1/stories/:id/view", `${s}/view`, stranger), "view");
    refused(await attempt("POST /api/v1/stories/:id/like", `${s}/like`, stranger), "like");
    refused(await attempt("DELETE /api/v1/stories/:id/like", `${s}/like`, stranger), "unlike");
    refused(await attempt("POST /api/v1/stories/:id/comments", `${s}/comments`, stranger, { body: "hello" }), "comment");
    refused(await attempt("POST /api/v1/stories/:id/share", `${s}/share`, stranger, {}), "share");
    refused(await attempt("DELETE /api/v1/comments/:id", `/api/v1/comments/${ids.comment}`, stranger), "delete comment");
    refused(await attempt("DELETE /api/v1/stories/:id", s, stranger), "delete story");

    const p = { story: ids.story, stranger: stranger.id };
    assert.equal(await count(`story_views WHERE story_id = :'story' AND viewer_id = :'stranger'`, p), 0, "no view recorded");
    assert.equal(await count(`story_likes WHERE story_id = :'story'`, p), 1, "the follower's like is intact, none added");
    assert.equal(await count(`story_comments WHERE story_id = :'story' AND deleted_at IS NULL`, p), 1, "the follower's comment is intact, none added");
    assert.equal((await request("GET", s, undefined, owner.auth)).status, 200, "the Story is still there");
    assert.equal((await request("GET", s, undefined, friend.auth)).status, 200, "and its follower still sees it");
  });

  it("a follow request alone opens nothing", async () => {
    await attempt("POST /api/v1/users/:username/follow", `/api/v1/users/${owner.username}/follow`, stranger);
    refused(await attempt("GET /api/v1/users/:username/stories", `/api/v1/users/${owner.username}/stories`, stranger), "stories while pending", [403]);
    await attempt("DELETE /api/v1/users/:username/follow", `/api/v1/users/${owner.username}/follow`, stranger);
  });

  it("only its owner reads a public Story's viewers and insights; the count is public", async () => {
    const s = `/api/v1/stories/${ids.publicStory}`;
    assert.equal((await request("GET", s, undefined, stranger.auth)).status, 200);
    const views = await request("GET", `${s}/views`, undefined, stranger.auth);
    assert.deepEqual(Object.keys(views.body), ["views"], "an aggregate count, no identities");
    refused(await request("GET", `${s}/viewers`, undefined, stranger.auth), "public viewers");
    refused(await request("GET", `${s}/insights`, undefined, stranger.auth), "public insights");
    refused(await request("GET", `/api/v1/stories/${ids.followersStory}`, undefined, stranger.auth), "followers-only", [403]);
  });

  it("its publish request is the owner's alone", async () => {
    refused(await attempt("GET /api/v1/stories/publish-requests/:requestId", `/api/v1/stories/publish-requests/${ids.publishRequest}`, stranger), "publish request", [404]);
    assert.equal((await request("GET", `/api/v1/stories/publish-requests/${ids.publishRequest}`, undefined, owner.auth)).status, 200);
  });
});

describe("a private account's profile", () => {
  it("shows a profile card, never the email; connections, Stories and Highlights stay closed", async () => {
    const card = await attempt("GET /api/v1/users/:username", `/api/v1/users/${owner.username}`, stranger);
    assert.equal(card.status, 200);
    assert.ok(!card.text.includes(owner.email) && !card.text.includes(SECRET.caption));
    const avatar = await attempt("GET /api/v1/users/:username/avatar/file", `/api/v1/users/${owner.username}/avatar/file`, stranger);
    assert.equal(avatar.status, 404, "no avatar set (avatars are public otherwise, like the card)");
    for (const [key, path] of [
      ["GET /api/v1/users/:username/followers", "followers"], ["GET /api/v1/users/:username/following", "following"],
      ["GET /api/v1/users/:username/stories", "stories"], ["GET /api/v1/users/:username/highlights", "highlights"],
    ] as const) {
      const reply = await attempt(key, `/api/v1/users/${owner.username}/${path}`, stranger);
      refused(reply, key, [403]);
      assert.ok(!reply.text.includes(friend.username), `${key} leaked a follower`);
    }
  });

  it("blocking and muting change only the stranger's own lists", async () => {
    for (const verb of ["mute", "block"] as const) {
      assert.ok([200, 204].includes((await attempt(`POST /api/v1/users/:username/${verb}`, `/api/v1/users/${owner.username}/${verb}`, stranger)).status));
      assert.ok([200, 204].includes((await attempt(`DELETE /api/v1/users/:username/${verb}`, `/api/v1/users/${owner.username}/${verb}`, stranger)).status));
    }
    assert.equal(await count(`blocks WHERE blocker_id = :'owner'`, { owner: owner.id }), 0, "nothing on the owner's side");
  });

  it("someone else's follow request can't be answered", async () => {
    refused(await attempt("POST /api/v1/follow-requests/:id/accept", `/api/v1/follow-requests/${ids.pendingRequest}/accept`, stranger), "accept", [404]);
    refused(await attempt("POST /api/v1/follow-requests/:id/decline", `/api/v1/follow-requests/${ids.pendingRequest}/decline`, stranger), "decline", [404]);
    assert.equal((await queryOne(`SELECT status FROM follow_requests WHERE id = :'id'`, { id: ids.pendingRequest }))!.status, "pending");
  });
});

describe("a private account's Highlight and media", () => {
  it("the Highlight can't be read, changed or deleted", async () => {
    const h = `/api/v1/highlights/${ids.highlight}`;
    refused(await attempt("GET /api/v1/highlights/:id", h, stranger), "highlight");
    refused(await attempt("GET /api/v1/highlights/:id/items/:storyId", `${h}/items/${ids.story}`, stranger), "item");
    refused(await attempt("PATCH /api/v1/highlights/:id", h, stranger, { title: "Taken over" }), "rename");
    refused(await attempt("DELETE /api/v1/highlights/:id", h, stranger), "delete");
    assert.equal((await queryOne(`SELECT title FROM highlights WHERE id = :'id'`, { id: ids.highlight }))!.title, SECRET.highlight);
  });

  it("media, files and uploads are refused, and the upload carries on", async () => {
    for (const media of [ids.storyMedia, ids.draftMedia]) {
      refused(await attempt("GET /api/v1/media/:id", `/api/v1/media/${media}`, stranger), "media");
      refused(await attempt("GET /api/v1/media/:id/file", `/api/v1/media/${media}/file`, stranger), "file");
    }
    refused(await attempt("POST /api/v1/media/:id/retry-processing", `/api/v1/media/${ids.processingMedia}/retry-processing`, stranger), "retry");
    const u = `/api/v1/media/uploads/${ids.upload}`;
    refused(await attempt("GET /api/v1/media/uploads/:id", u, stranger), "upload");
    refused(await attempt("POST /api/v1/media/uploads/:id/complete", `${u}/complete`, stranger), "complete");
    refused(await attempt("POST /api/v1/media/uploads/:id/abort", `${u}/abort`, stranger), "abort");
    // Parts go to a signed URL; a guessed or altered signature is refused.
    const forged = ids.partUrl.replace(/signature=[^&]+/, "signature=" + "0".repeat(64));
    refused(await attempt("PUT /api/v1/media/uploads/:id/parts/:partNumber", forged, stranger, undefined), "forged part", [403]);
    const status = await request("GET", u, undefined, owner.auth);
    assert.deepEqual([status.status, status.body.media.status], [200, "uploading"], "the owner's upload is untouched");
  });
});

describe("a conversation between two other people", () => {
  it("can't be opened, read, written to, marked read or reported from", async () => {
    const c = `/api/v1/conversations/${ids.conversation}`;
    refused(await attempt("GET /api/v1/conversations/:id", c, stranger), "conversation", [404]);
    refused(await attempt("GET /api/v1/conversations/:id/messages", `${c}/messages`, stranger), "messages", [404]);
    refused(await attempt("POST /api/v1/conversations/:id/messages", `${c}/messages`, stranger, { body: "let me in" }), "send", [404]);
    refused(await attempt("POST /api/v1/conversations/:id/read", `${c}/read`, stranger), "read", [404]);
    refused(await attempt("POST /api/v1/conversations/:id/report", `${c}/report`, stranger, { messageId: ids.message, reason: "spam" }), "report", [404]);
    assert.equal(await count(`messages WHERE conversation_id = :'c'`, { c: ids.conversation }), 1);
    assert.equal(await count(`report_message_evidence e JOIN reports r ON r.id = e.report_id WHERE r.reporter_id = :'s'`, { s: stranger.id }), 0);
  });

  it("starting a conversation with the owner gives the stranger their own thread", async () => {
    const own = await attempt("POST /api/v1/users/:username/conversation", `/api/v1/users/${owner.username}/conversation`, stranger);
    assert.equal(own.status, 200);
    assert.notEqual(own.body.conversation.id, ids.conversation);
    assert.ok(!own.text.includes(SECRET.message));
  });
});

describe("another person's account", () => {
  it("their sign-ins and notifications are out of reach", async () => {
    refused(await attempt("DELETE /api/v1/auth/sessions/:id", `/api/v1/auth/sessions/${ids.session}`, stranger), "session", [404]);
    assert.equal((await request("GET", "/api/v1/auth/sessions", undefined, owner.auth)).status, 200, "the owner is still signed in");
    const read = await attempt("POST /api/v1/notifications/:id/read", `/api/v1/notifications/${ids.notification}/read`, stranger);
    assert.ok([204, 404].includes(read.status));
    assert.equal((await queryOne(`SELECT read_at FROM notifications WHERE id = :'id'`, { id: ids.notification }))!.read_at, null, "still unread for the owner");
  });

  it("moderator actions need an Admin session, not a consumer token", async () => {
    const report = (await queryOne(`INSERT INTO reports (reporter_id, target_type, target_id, reason) VALUES (:'r', 'story', :'s', 'spam') RETURNING id`, { r: friend.id, s: ids.story }))!.id!;
    for (const [key, path] of [
      ["POST /api/v1/moderation/reports/:id/resolve", `/api/v1/moderation/reports/${report}/resolve`],
      ["POST /api/v1/moderation/users/:username/suspend", `/api/v1/moderation/users/${owner.username}/suspend`],
      ["POST /api/v1/moderation/users/:username/unsuspend", `/api/v1/moderation/users/${owner.username}/unsuspend`],
    ] as const) refused(await attempt(key, path, stranger, { action: "remove", reason: "test" }), key, [401, 403]);
    assert.equal((await queryOne(`SELECT is_active FROM users WHERE id = :'id'`, { id: owner.id }))!.is_active, "t");
    assert.notEqual((await queryOne(`SELECT status FROM reports WHERE id = :'id'`, { id: report }))!.status, "ACTIONED");
  });

  it("a Sponsored Story delivered to someone else can't be read or reported", async () => {
    const d = `/api/v1/ads/deliveries/${ids.delivery}`;
    refused(await attempt("GET /api/v1/ads/deliveries/:id", d, stranger), "delivery", [404]);
    refused(await attempt("GET /api/v1/ads/deliveries/:id/media", `${d}/media`, stranger), "delivery media", [404]);
    refused(await attempt("POST /api/v1/ads/deliveries/:id/report", `${d}/report`, stranger, { reason: "scam" }), "delivery report", [404]);
    assert.equal(await count(`reports WHERE reporter_id = :'s' AND target_type = 'ad'`, { s: stranger.id }), 0);
    assert.equal((await request("GET", d, undefined, adViewer.auth)).status, 200, "its viewer still can");
  });
});

describe("the Admin API", () => {
  it("answers no consumer token, on any route", async () => {
    const admin = server.routes().filter((r) => r.path.startsWith("/api/v1/admin"));
    assert.ok(admin.length > 40, `${admin.length} Admin routes`);
    const opened: string[] = [];
    for (const route of admin) {
      const path = route.path.replace(/:id\b/g, ids.story).replace(/:username\b/g, owner.username).replace(/:[A-Za-z]+/g, "x");
      const reply = await attempt(`${route.method} ${route.path}`, path, stranger, route.method === "GET" ? undefined : { confirmed: true });
      if (reply.status < 400) opened.push(`${route.method} ${route.path} -> ${reply.status}`);
      for (const secret of [...Object.values(SECRET), owner.email]) assert.ok(!reply.text.includes(secret), `${route.path} leaked ${secret}`);
    }
    assert.deepEqual(opened, [], "every Admin route refuses a consumer bearer token");
  });

  it("the console's assets are public files, served only by their versioned names", async () => {
    refused(await attempt("GET /admin/assets/:file", "/admin/assets/..%2F..%2Fpackage.json", null), "asset traversal", [404]);
  });
});

describe("coverage", () => {
  it("every route that takes an id or a username was tried above", () => {
    const parameterized = server.routes().filter((r) => r.path.includes("/:")).map((r) => `${r.method} ${r.path}`);
    const untried = parameterized.filter((key) => !exercised.has(key));
    assert.deepEqual(untried, [], "add a case for each new route that takes an id or a username");
    assert.ok(parameterized.length >= 68, `${parameterized.length} parameterized routes`);
  });
});
