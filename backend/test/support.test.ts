import "./admin-env";
import { after, before, it } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { buildApp } from "../src/app";
import { query, queryOne } from "../src/db/psql";
import { uniqueUser } from "./helpers";
import { buildTestPng } from "./fixtures";
import { adminSignIn, type AdminHeaders } from "./adminSession";
import { crashFingerprint } from "../src/modules/support/support.service";
import { expiredRecords, unusedMedia } from "../src/modules/media/retention";
import { mediaStorage } from "../src/modules/media/instance";

// What goes wrong in the app (crash reports) and what testers say (Send feedback), on Katkee's own server.
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
async function person() {
  const input = uniqueUser();
  const res = await request("/api/v1/auth/signup", "POST", input, {});
  return { ...input, id: res.body.user.id as string, auth: { Authorization: `Bearer ${res.body.tokens.accessToken}`, "X-Katkee-Platform": "android" } };
}
async function admin(grant: string[]): Promise<AdminHeaders> {
  const p = await person();
  await query(`INSERT INTO admin_grants(user_id, role, permissions) VALUES (:'id', 'ADMIN', :'p'::jsonb)`, { id: p.id, p: JSON.stringify(grant) });
  return adminSignIn(base, p.email, p.password);
}
let n = 0;
const crash = (over: Record<string, unknown> = {}) => ({
  clientReportId: `crash_${Date.now()}_${n++}_xxxxxxxx`, kind: "fatal", name: "TypeError", message: "Cannot read property 'id' of undefined",
  stack: "TypeError: Cannot read property 'id' of undefined\n    at StoryViewer (index.android.bundle:1:2345)\n    at renderWithHooks (index.android.bundle:1:99)",
  screen: "StoryViewer", osVersion: "14", appVersion: "1.0.0 (43)", deviceModel: "Pixel 7", occurredAt: new Date().toISOString(), ...over,
});

it("the same crash on two builds groups together; a resend is not a second report", async () => {
  const a = crashFingerprint("TypeError", "TypeError: x\n    at StoryViewer (index.android.bundle:1:2345)\n    at renderWithHooks (index.android.bundle:1:99)", "x");
  const b = crashFingerprint("TypeError", "TypeError: x\n    at StoryViewer (index.android.bundle:1:9999)\n    at renderWithHooks (index.android.bundle:1:12)", "x");
  assert.equal(a, b);
  assert.notEqual(a, crashFingerprint("TypeError", "TypeError: x\n    at Composer (index.android.bundle:1:1)", "x"));
  // iOS (JavaScriptCore/Hermes "name@file:line:col") frames too.
  assert.equal(crashFingerprint("Error", "Composer@main.jsbundle:5:10\nrender@main.jsbundle:9:1", "m"), crashFingerprint("Error", "Composer@main.jsbundle:7:3\nrender@main.jsbundle:2:2", "m"));

  const p = await person();
  const report = crash();
  assert.equal((await request("/api/v1/crash-reports", "POST", report, p.auth)).status, 201);
  assert.equal((await request("/api/v1/crash-reports", "POST", report, p.auth)).status, 200, "a resend");
  assert.equal((await request("/api/v1/crash-reports", "POST", crash({ stack: "x".repeat(20_000) }), p.auth)).status, 201, "a long stack is cut, not refused");
  assert.equal((await queryOne(`SELECT max(length(stack)) AS n FROM crash_reports WHERE user_id = :'id'`, { id: p.id }))?.n, "8000");
  assert.equal((await request("/api/v1/crash-reports", "POST", crash({ kind: "other" }), p.auth)).status, 422);
  assert.equal((await request("/api/v1/crash-reports", "POST", crash({ clientReportId: "short" }), p.auth)).status, 422);
  assert.equal((await request("/api/v1/crash-reports", "POST", crash(), { Authorization: p.auth.Authorization })).status, 422, "which platform it was");
  assert.equal((await request("/api/v1/crash-reports", "POST", crash(), {})).status, 401);
});

it("a crash loop on one phone can't fill the table", async () => {
  const p = await person();
  const statuses: number[] = [];
  for (let i = 0; i < 32; i++) statuses.push((await request("/api/v1/crash-reports", "POST", crash(), p.auth)).status);
  assert.deepEqual([statuses.slice(0, 30).every((s) => s === 201), statuses.slice(30)], [true, [429, 429]]);
});

it("feedback with a screenshot of your own; never someone else's photo", async () => {
  const [p, other] = [await person(), await person()];
  const upload = async (auth: Record<string, string>) => {
    const r = await fetch(base + "/api/v1/media/photos", { method: "POST", headers: { Authorization: auth.Authorization!, "Content-Type": "image/png" }, body: buildTestPng(6, 6) });
    assert.equal(r.status, 201);
    return ((await r.json()) as { media: { id: string } }).media.id;
  };
  const shot = await upload(p.auth);
  const sent = await request("/api/v1/feedback", "POST", { body: "  The music picker froze after I searched.  ", screenshotMediaId: shot, appVersion: "1.0.0 (43)", osVersion: "14", deviceModel: "Pixel 7" }, p.auth);
  assert.equal(sent.status, 201, JSON.stringify(sent.body));
  const row = await queryOne(`SELECT body, platform, app_version, screenshot_media_id FROM app_feedback WHERE id = :'id'`, { id: sent.body.feedback.id });
  assert.deepEqual(row, { body: "The music picker froze after I searched.", platform: "android", app_version: "1.0.0 (43)", screenshot_media_id: shot });
  assert.equal((await request("/api/v1/feedback", "POST", { body: "look", screenshotMediaId: await upload(other.auth) }, p.auth)).status, 422);
  assert.equal((await request("/api/v1/feedback", "POST", { body: "   " }, p.auth)).status, 422);
  assert.equal((await request("/api/v1/feedback", "POST", { body: "x".repeat(2001) }, p.auth)).status, 422);

  // Kept while the feedback needs it: unused-media cleanup leaves the screenshot alone.
  await query(`UPDATE media SET created_at = now() - interval '49 hours' WHERE id = :'id'`, { id: shot });
  await unusedMedia(mediaStorage, 500, 48);
  assert.ok(await queryOne(`SELECT id FROM media WHERE id = :'id' AND purged_at IS NULL`, { id: shot }));
});

it("admins with the permissions see crashes grouped and feedback with its screenshot, and mark feedback resolved", async () => {
  const p = await person();
  const marker = `Marker${Date.now()}`;
  for (let i = 0; i < 3; i++) await request("/api/v1/crash-reports", "POST", crash({ name: marker, stack: `${marker}\n    at Feed (b:1:${i})` }), p.auth);
  const shotRes = await fetch(base + "/api/v1/media/photos", { method: "POST", headers: { Authorization: p.auth.Authorization, "Content-Type": "image/png" }, body: buildTestPng(6, 6) });
  const shot = ((await shotRes.json()) as { media: { id: string } }).media.id;
  const fb = (await request("/api/v1/feedback", "POST", { body: `Stories skip ${marker}`, screenshotMediaId: shot }, p.auth)).body.feedback.id as string;

  const none = await admin(["reports.read"]);
  assert.equal((await request("/api/v1/admin/crashes", "GET", undefined, none)).status, 403);
  assert.equal((await request("/api/v1/admin/feedback", "GET", undefined, none)).status, 403);

  const h = await admin(["crashes.read", "feedback.read"]);
  const groups = (await request("/api/v1/admin/crashes?days=7&limit=50", "GET", undefined, h)).body.items as Array<{ count: number; people: number; sample: { name: string; screen: string } }>;
  const mine = groups.find((g) => g.sample.name === marker)!;
  assert.deepEqual([mine.count, mine.people, mine.sample.screen], [3, 1, "StoryViewer"]);

  const open = (await request("/api/v1/admin/feedback", "GET", undefined, h)).body.items as Array<{ id: string; hasScreenshot: boolean; user: { username: string } }>;
  const item = open.find((f) => f.id === fb)!;
  assert.deepEqual([item.hasScreenshot, item.user.username], [true, p.username]);
  const image = await fetch(`${base}/api/v1/admin/feedback/${fb}/screenshot`, { headers: h });
  assert.equal(image.status, 200);
  assert.match(String(image.headers.get("content-type")), /^image\//);

  assert.equal((await request(`/api/v1/admin/feedback/${fb}/status`, "POST", { status: "resolved" }, h)).status, 204);
  assert.ok(!((await request("/api/v1/admin/feedback", "GET", undefined, h)).body.items as Array<{ id: string }>).some((f) => f.id === fb));
  assert.ok(((await request("/api/v1/admin/feedback?status=resolved", "GET", undefined, h)).body.items as Array<{ id: string }>).some((f) => f.id === fb));
  assert.ok(await queryOne(`SELECT 1 AS ok FROM admin_audit WHERE action = 'FEEDBACK_RESOLVED' AND target_id = :'id'`, { id: fb }));
  assert.equal((await request(`/api/v1/admin/feedback/${fb}/status`, "POST", { status: "done" }, h)).status, 422);
});

it("crash reports go after 90 days, resolved feedback after 180; open feedback stays", async () => {
  const p = await person();
  await request("/api/v1/crash-reports", "POST", crash({ clientReportId: "old-crash-0000000001" }), p.auth);
  await request("/api/v1/crash-reports", "POST", crash({ clientReportId: "new-crash-0000000001" }), p.auth);
  await query(`UPDATE crash_reports SET created_at = now() - interval '91 days' WHERE user_id = :'id' AND client_report_id = 'old-crash-0000000001'`, { id: p.id });
  const ids: string[] = [];
  for (const body of ["old resolved", "recent resolved", "old open"]) ids.push((await request("/api/v1/feedback", "POST", { body }, p.auth)).body.feedback.id as string);
  await query(`UPDATE app_feedback SET status = 'resolved', resolved_at = now() - interval '181 days' WHERE id = :'id'`, { id: ids[0]! });
  await query(`UPDATE app_feedback SET status = 'resolved', resolved_at = now() - interval '10 days' WHERE id = :'id'`, { id: ids[1]! });
  await query(`UPDATE app_feedback SET created_at = now() - interval '400 days' WHERE id = :'id'`, { id: ids[2]! });
  await expiredRecords();
  assert.deepEqual((await query(`SELECT client_report_id FROM crash_reports WHERE user_id = :'id'`, { id: p.id })).map((r) => r.client_report_id), ["new-crash-0000000001"]);
  assert.deepEqual((await query(`SELECT body FROM app_feedback WHERE user_id = :'id' ORDER BY body`, { id: p.id })).map((r) => r.body), ["old open", "recent resolved"]);
});
