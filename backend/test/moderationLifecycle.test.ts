import "./admin-env";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { buildApp } from "../src/app";
import { query, queryOne } from "../src/db/psql";
import { reportMessageEvidence } from "../src/modules/media/retention";
import { buildTestPng } from "./fixtures";
import { adminSignIn } from "./adminSession";

const server = buildApp();
let base = "";
before(async () => {
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

async function request(path: string, method = "GET", data?: unknown, headers: Record<string, string> = {}) {
  const r = await fetch(base + path, { method, headers: { "Content-Type": "application/json", ...headers }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
  const text = await r.text();
  return { status: r.status, body: text ? JSON.parse(text) : null };
}
async function account(grant?: { role: "ADMIN" | "SUPER_ADMIN"; permissions: string[] }) {
  const tag = randomUUID().slice(0, 8);
  const input = { email: `ml_${tag}@example.com`, username: `ml_${tag}`, password: "correcthorsebattery", displayName: `Person ${tag}` };
  const r = await request("/api/v1/auth/signup", "POST", input);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  if (grant) await query(`INSERT INTO admin_grants(user_id, role, permissions) VALUES (:'id', :'role', :'p'::jsonb)`, { id: r.body.user.id, role: grant.role, p: JSON.stringify(grant.permissions) });
  return { id: r.body.user.id as string, token: r.body.tokens.accessToken as string, input, auth: { Authorization: `Bearer ${r.body.tokens.accessToken}` } };
}
type Account = Awaited<ReturnType<typeof account>>;
const MODERATOR = ["reports.read", "reports.review", "content.remove", "content.restore", "users.view", "users.restrict", "users.suspend", "moderation.history.read"];

async function story(owner: Account): Promise<string> {
  const upload = await fetch(base + "/api/v1/media/photos", { method: "POST", headers: { ...owner.auth, "Content-Type": "image/png" }, body: buildTestPng(4, 4) });
  const mediaId = ((await upload.json()) as { media: { id: string } }).media.id;
  const r = await request("/api/v1/stories", "POST", { mediaId, caption: "c", audience: "public", allowComments: "everyone", allowSharing: true }, owner.auth);
  assert.equal(r.status, 201);
  return r.body.story.id as string;
}
const report = (by: Account, targetType: string, targetId: string, reason = "spam") =>
  request("/api/v1/reports", "POST", { targetType, targetId, reason }, by.auth);
const reportRow = async (id: string) => queryOne(`SELECT status, version, priority, source FROM reports WHERE id = :'id'`, { id });

describe("report lifecycle", () => {
  it("moves OPEN → UNDER_REVIEW → ACTIONED → APPEALED → CLOSED, and a denied appeal keeps the action", async () => {
    const [owner, reporter, moderator] = [await account(), await account(), await account({ role: "ADMIN", permissions: MODERATOR })];
    const mh = await adminSignIn(base, moderator.input.email, moderator.input.password);
    const storyId = await story(owner);
    const filed = await report(reporter, "story", storyId);
    assert.equal(filed.body.report.status, "OPEN");
    const id = filed.body.report.id as string;
    const claimed = await request(`/api/v1/admin/reports/${id}/claim`, "POST", { version: 1, confirmed: true }, mh);
    assert.equal(claimed.body.status, "UNDER_REVIEW");
    assert.equal((await request(`/api/v1/admin/moderate`, "POST", { reportId: id, version: 2, action: "remove", reason: "Spam", confirmed: true }, mh)).status, 200);
    assert.equal((await reportRow(id))?.status, "ACTIONED");

    const notices = await request("/api/v1/moderation/access", "POST", owner.input);
    const notice = notices.body.items[0];
    assert.equal(notice.appealable, true);
    assert.equal((await request("/api/v1/moderation/appeal/submit", "POST", { ticket: notices.body.ticket, actionId: notice.actionId, reason: "It was not spam." })).status, 200);
    assert.equal((await reportRow(id))?.status, "APPEALED");

    const appeals = await request("/api/v1/admin/appeals", "GET", undefined, mh);
    const appeal = appeals.body.items.find((a: { action: { id: string } }) => a.action.id === notice.actionId);
    assert.deepEqual([appeal.reportStatus, appeal.action.action, appeal.username], ["APPEALED", "remove", owner.input.username]);
    const denied = await request(`/api/v1/admin/appeals/${appeal.id}`, "POST", { decision: "DENIED", version: appeal.version, reason: "Clear spam.", confirmed: true }, mh);
    assert.deepEqual([denied.status, denied.body.reversed], [200, false]);
    assert.equal((await reportRow(id))?.status, "CLOSED");
    assert.equal((await request(`/api/v1/stories/${storyId}`, "GET", undefined, reporter.auth)).status, 404, "the removal stands");
    assert.equal((await request(`/api/v1/admin/appeals/${appeal.id}`, "POST", { decision: "UPHELD", version: appeal.version, reason: "x", confirmed: true }, mh)).status, 409);
  });

  it("an upheld appeal restores the content or the account in the same step and closes the report", async () => {
    const [owner, reporter, moderator] = [await account(), await account(), await account({ role: "ADMIN", permissions: MODERATOR })];
    const mh = await adminSignIn(base, moderator.input.email, moderator.input.password);
    const storyId = await story(owner);
    const id = (await report(reporter, "story", storyId)).body.report.id as string;
    await request(`/api/v1/admin/moderate`, "POST", { reportId: id, version: 1, action: "remove", reason: "Looked like spam", confirmed: true }, mh);
    await request(`/api/v1/admin/moderate`, "POST", { targetType: "user", targetId: owner.id, action: "suspend", reason: "Repeat spam", confirmed: true }, mh);
    assert.equal((await request("/api/v1/auth/login", "POST", { email: owner.input.email, password: owner.input.password })).status, 401, "suspended");

    const access = await request("/api/v1/moderation/access", "POST", owner.input);
    const [suspension, removal] = access.body.items;
    assert.deepEqual([suspension.action, removal.action], ["suspend", "remove"]);
    await request("/api/v1/moderation/appeal/submit", "POST", { ticket: access.body.ticket, actionId: suspension.actionId, reason: "I'm not a spammer." });
    const again = await request("/api/v1/moderation/access", "POST", owner.input);
    await request("/api/v1/moderation/appeal/submit", "POST", { ticket: again.body.ticket, actionId: removal.actionId, reason: "My Story was fine." });

    const items = (await request("/api/v1/admin/appeals", "GET", undefined, mh)).body.items as { id: string; version: number; action: { id: string } }[];
    for (const actionId of [suspension.actionId, removal.actionId]) {
      const appeal = items.find((a) => a.action.id === actionId)!;
      const upheld = await request(`/api/v1/admin/appeals/${appeal.id}`, "POST", { decision: "UPHELD", version: appeal.version, reason: "Mistake.", confirmed: true }, mh);
      assert.deepEqual([upheld.status, upheld.body.reversed], [200, true], JSON.stringify(upheld.body));
    }
    assert.equal((await request("/api/v1/auth/login", "POST", { email: owner.input.email, password: owner.input.password })).status, 200, "account active again");
    assert.equal((await request(`/api/v1/stories/${storyId}`, "GET", undefined, reporter.auth)).status, 200, "Story visible again");
    assert.equal((await reportRow(id))?.status, "CLOSED");
    const reversals = await query(`SELECT action FROM moderation_actions WHERE target_id IN (:'story', :'user') AND action = 'appeal_reversal'`, { story: storyId, user: owner.id });
    assert.equal(reversals.length, 2);
    assert.equal((await queryOne(`SELECT count(*) AS n FROM admin_audit WHERE action = 'APPEAL_UPHELD' AND actor_id = :'a'`, { a: moderator.id }))?.n, "2");
  });

  it("only actions that took something away can be appealed, and upholding needs the matching restore permission", async () => {
    const [owner, reporter] = [await account(), await account()];
    const lead = await account({ role: "ADMIN", permissions: MODERATOR });
    const reviewerOnly = await account({ role: "ADMIN", permissions: ["reports.read", "reports.review"] });
    const lh = await adminSignIn(base, lead.input.email, lead.input.password);
    const rh = await adminSignIn(base, reviewerOnly.input.email, reviewerOnly.input.password);
    const storyId = await story(owner);
    const id = (await report(reporter, "story", storyId)).body.report.id as string;
    await request(`/api/v1/admin/moderate`, "POST", { reportId: id, version: 1, action: "remove", reason: "r", confirmed: true }, lh);
    await request(`/api/v1/admin/moderate`, "POST", { targetType: "story", targetId: storyId, action: "restore", reason: "second look", confirmed: true }, lh);
    const access = await request("/api/v1/moderation/access", "POST", owner.input);
    const restoreNotice = access.body.items.find((n: { action: string }) => n.action === "restore");
    assert.equal(restoreNotice.appealable, false);
    assert.equal((await request("/api/v1/moderation/appeal/submit", "POST", { ticket: access.body.ticket, actionId: restoreNotice.actionId, reason: "?" })).status, 401);

    await request(`/api/v1/admin/moderate`, "POST", { targetType: "user", targetId: owner.id, action: "restrict", reason: "r", confirmed: true }, lh);
    const fresh = await request("/api/v1/moderation/access", "POST", owner.input);
    const restriction = fresh.body.items.find((n: { action: string }) => n.action === "restrict");
    await request("/api/v1/moderation/appeal/submit", "POST", { ticket: fresh.body.ticket, actionId: restriction.actionId, reason: "please" });
    const appeal = (await request("/api/v1/admin/appeals", "GET", undefined, lh)).body.items.find((a: { action: { id: string } }) => a.action.id === restriction.actionId);
    assert.equal((await request(`/api/v1/admin/appeals/${appeal.id}`, "POST", { decision: "UPHELD", version: appeal.version, reason: "x", confirmed: true }, rh)).status, 403);
    assert.equal((await request(`/api/v1/admin/appeals/${appeal.id}`, "POST", { decision: "DENIED", version: appeal.version, reason: "stands", confirmed: true }, rh)).status, 200, "denying needs no restore permission");
  });

  it("sets priority from severity and repeat reporters, merges repeat reports, and files impersonation", async () => {
    const target = await account();
    const reporters = [await account(), await account(), await account()];
    const selfHarm = await report(reporters[0]!, "user", target.id, "self_harm");
    assert.equal((await reportRow(selfHarm.body.report.id))?.priority, "3");
    const first = await report(reporters[1]!, "user", target.id, "spam");
    assert.equal((await reportRow(first.body.report.id))?.priority, "0");
    const repeat = await report(reporters[1]!, "user", target.id, "spam");
    assert.deepEqual([repeat.status, repeat.body.report.id], [200, first.body.report.id], "a repeat report returns the open one");
    const third = await report(reporters[2]!, "user", target.id, "impersonation");
    assert.equal(third.status, 201);
    assert.equal((await reportRow(third.body.report.id))?.priority, "2", "impersonation (1) + a third reporter");
    assert.equal((await reportRow(first.body.report.id))?.priority, "1", "earlier reports are raised too");
    assert.equal((await report(reporters[0]!, "user", "------------------------------------")).status, 422);
    assert.equal((await report(reporters[0]!, "user", target.id, "made_up")).status, 422);
  });

  it("gives moderators history, creator context and append-only notes, with old status names still accepted", async () => {
    const [owner, reporter, other] = [await account(), await account(), await account()];
    const moderator = await account({ role: "ADMIN", permissions: MODERATOR });
    const mh = await adminSignIn(base, moderator.input.email, moderator.input.password);
    const s1 = await story(owner), s2 = await story(owner);
    const old = (await report(reporter, "story", s1)).body.report.id as string;
    await request(`/api/v1/admin/moderate`, "POST", { reportId: old, version: 1, action: "remove", reason: "earlier removal", confirmed: true }, mh);
    const id = (await report(reporter, "story", s2, "harassment")).body.report.id as string;
    await report(other, "story", s2, "harassment");

    const note = await request(`/api/v1/admin/reports/${id}/notes`, "POST", { body: "Same pattern as last week." }, mh);
    assert.equal(note.status, 201);
    const detail = (await request(`/api/v1/admin/reports/${id}`, "GET", undefined, mh)).body;
    assert.equal(detail.creator.username, owner.input.username);
    assert.equal(detail.creator.priorActions, 1);
    assert.equal(detail.history.reports.length, 1, "the other report on this Story");
    assert.ok(detail.history.actions.some((a: { reason: string }) => a.reason === "earlier removal"), "previous actions on the creator's content");
    assert.deepEqual(detail.history.notes.map((n: { body: string }) => n.body), ["Same pattern as last week."]);
    assert.equal(detail.evidence.messages, 0);
    await assert.rejects(query(`UPDATE moderation_notes SET body = 'edited'`), (e: { detail?: string }) => /append-only/.test(String(e.detail)));

    for (const status of ["pending", "OPEN", "open"]) {
      const list = await request(`/api/v1/admin/reports?status=${status}`, "GET", undefined, mh);
      assert.ok(list.body.items.some((r: { id: string }) => r.id === id), status);
    }
    assert.equal((await request(`/api/v1/admin/reports?status=bogus`, "GET", undefined, mh)).status, 422);
    const urgent = await request(`/api/v1/admin/reports?status=OPEN&minPriority=2`, "GET", undefined, mh);
    assert.ok(!urgent.body.items.some((r: { id: string }) => r.id === id), "harassment from two people is priority 1");
    assert.equal((await request(`/api/v1/moderation/reports?status=pending`, "GET", undefined, mh)).status, 200);
  });
});

describe("reporting a direct message", () => {
  async function thread(a: Account, b: Account, count: number) {
    const conversation = (await request(`/api/v1/users/${b.input.username}/conversation`, "POST", undefined, a.auth)).body.conversation.id as string;
    const ids: string[] = [];
    for (let i = 1; i <= count; i++) {
      const sender = i % 2 ? b : a;
      ids.push((await request(`/api/v1/conversations/${conversation}/messages`, "POST", { body: `secret-${conversation.slice(0, 4)}-${i}` }, sender.auth)).body.message.id);
    }
    return { conversation, ids };
  }

  it("attaches the reported message and the nine before it — never more — for permitted, audited review", async () => {
    const [victim, sender, stranger] = [await account(), await account(), await account()];
    const { conversation, ids } = await thread(victim, sender, 15);
    // Messages 1, 3, 5 … are from `sender`; report message 13.
    const reported = ids[12]!;
    assert.equal((await request(`/api/v1/conversations/${conversation}/report`, "POST", { messageId: reported, reason: "harassment" }, stranger.auth)).status, 404, "participants only");
    assert.equal((await request(`/api/v1/conversations/${conversation}/report`, "POST", { messageId: ids[11], reason: "harassment" }, victim.auth)).status, 404, "only the other person's messages");
    assert.equal((await request(`/api/v1/conversations/${conversation}/report`, "POST", { messageId: reported, reason: "nope" }, victim.auth)).status, 422);
    const filed = await request(`/api/v1/conversations/${conversation}/report`, "POST", { messageId: reported, reason: "harassment", details: "threats" }, victim.auth);
    assert.equal(filed.status, 201, JSON.stringify(filed.body));
    const id = filed.body.report.id as string;
    assert.deepEqual(await reportRow(id), { status: "OPEN", version: "1", priority: "1", source: "direct_message" });

    const moderator = await account({ role: "ADMIN", permissions: MODERATOR });
    const mh = await adminSignIn(base, moderator.input.email, moderator.input.password);
    const detail = await request(`/api/v1/admin/reports/${id}`, "GET", undefined, mh);
    assert.equal(detail.body.evidence.messages, 10);
    assert.ok(!JSON.stringify(detail.body).includes("secret-"), "the report view never shows message text");
    assert.equal((await request(`/api/v1/admin/reports/${id}/messages`, "GET", undefined, mh)).status, 403, "needs reports.messages.read");

    const safety = await account({ role: "ADMIN", permissions: [...MODERATOR, "reports.messages.read"] });
    const sh = await adminSignIn(base, safety.input.email, safety.input.password);
    const evidence = await request(`/api/v1/admin/reports/${id}/messages`, "GET", undefined, sh);
    assert.equal(evidence.status, 200);
    const bodies = evidence.body.items.map((m: { body: string }) => m.body.split("-").pop());
    assert.deepEqual(bodies, ["4", "5", "6", "7", "8", "9", "10", "11", "12", "13"], "the reported message and the nine before it, in order");
    assert.ok(evidence.body.items.every((m: { fromReportedUser: boolean; body: string }) => m.fromReportedUser === (Number(m.body.split("-").pop()) % 2 === 1)));
    assert.equal((await queryOne(`SELECT count(*) AS n FROM admin_audit WHERE action = 'DM_EVIDENCE_VIEWED' AND actor_id = :'a' AND target_id = :'r'`, { a: safety.id, r: id }))?.n, "1");

    const more = await request(`/api/v1/conversations/${conversation}/report`, "POST", { messageId: ids[14], reason: "harassment" }, victim.auth);
    assert.deepEqual([more.status, more.body.report.id], [200, id], "a second report adds evidence to the open one");
    assert.equal((await queryOne(`SELECT count(*) AS n FROM report_message_evidence WHERE report_id = :'r'`, { r: id }))?.n, "12");

    await request(`/api/v1/admin/moderate`, "POST", { reportId: id, version: 1, action: "restrict", reason: "harassment", confirmed: true }, mh);
    assert.equal(await reportMessageEvidence(100, 180), 0, "kept for 180 days after the decision");
    await query(`UPDATE reports SET reviewed_at = now() - interval '181 days' WHERE id = :'r'`, { r: id });
    assert.equal(await reportMessageEvidence(100, 180), 12);
    const purged = await request(`/api/v1/admin/reports/${id}/messages`, "GET", undefined, sh);
    assert.ok(purged.body.items.every((m: { body: string | null; purged: boolean }) => m.body === null && m.purged));
  });
});
