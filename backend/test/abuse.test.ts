// Tight budgets for this file only (other files use test/env.ts's generous ones), and a
// local Safe Browsing server that checks the request shape like the real API would.
import { execFileSync } from "node:child_process";
const SB_PORT = Number(execFileSync(process.execPath, ["-e",
  "const s=require('net').createServer().listen(0,'127.0.0.1',()=>{process.stdout.write(String(s.address().port));s.close()})"]).toString());
process.env.SAFETY_LIMITS_JSON = JSON.stringify({
  like: { perMinute: 3, perHour: 100 },
  comment: { perMinute: 100, perHour: 100, newAccountPerHour: 4 },
  follow: { perMinute: 100, perHour: 100 },
  message: { perMinute: 4, perHour: 100 },
  conversation: { perHour: 2, newAccountPerHour: 2 },
  view: { perMinute: 3, perHour: 100 },
});
process.env.SAFE_BROWSING_API_KEY = "sb-test-key";
process.env.SAFE_BROWSING_ENDPOINT = `http://127.0.0.1:${SB_PORT}`;

import "./admin-env";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import * as http from "node:http";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { buildApp } from "../src/app";
import { query, queryOne } from "../src/db/psql";
import { buildTestPng } from "./fixtures";
import { adminSignIn } from "./adminSession";

const sb = { requests: 0, down: false };
const safeBrowsing = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    sb.requests++;
    assert.equal(req.url, "/v4/threatMatches:find?key=sb-test-key");
    if (sb.down) { res.writeHead(503).end(); return; }
    const body = JSON.parse(raw);
    assert.deepEqual(body.threatInfo.threatEntryTypes, ["URL"]);
    assert.ok(body.threatInfo.threatTypes.includes("SOCIAL_ENGINEERING"));
    const matches = body.threatInfo.threatEntries.filter((e: { url: string }) => e.url.includes("malware")).map((e: { url: string }) => ({ threatType: "MALWARE", threat: { url: e.url } }));
    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(matches.length ? { matches } : {}));
  });
});

const server = buildApp();
let base = "";
before(async () => {
  await new Promise<void>((r) => safeBrowsing.listen(SB_PORT, "127.0.0.1", r));
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  await new Promise<void>((r) => safeBrowsing.close(() => r()));
});

async function request(path: string, method = "GET", data?: unknown, headers: Record<string, string> = {}) {
  const r = await fetch(base + path, { method, headers: { "Content-Type": "application/json", ...headers }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
  const text = await r.text();
  return { status: r.status, body: text ? JSON.parse(text) : null, retryAfter: r.headers.get("retry-after") };
}
async function account(options: { ageDays?: number; grant?: string[] } = {}) {
  const tag = randomUUID().slice(0, 8);
  const input = { email: `ab_${tag}@example.com`, username: `ab_${tag}`, password: "correcthorsebattery", displayName: `Abuse ${tag}` };
  const r = await request("/api/v1/auth/signup", "POST", input);
  assert.equal(r.status, 201);
  const id = r.body.user.id as string;
  if (options.ageDays) await query(`UPDATE users SET created_at = now() - make_interval(days => :'d'::integer) WHERE id = :'id'`, { d: options.ageDays, id });
  if (options.grant) await query(`INSERT INTO admin_grants(user_id, role, permissions) VALUES (:'id', 'ADMIN', :'p'::jsonb)`, { id, p: JSON.stringify(options.grant) });
  return { id, input, auth: { Authorization: `Bearer ${r.body.tokens.accessToken}` } };
}
type Account = Awaited<ReturnType<typeof account>>;
async function photo(owner: Account): Promise<string> {
  const r = await fetch(base + "/api/v1/media/photos", { method: "POST", headers: { ...owner.auth, "Content-Type": "image/png" }, body: buildTestPng(4, 4) });
  return ((await r.json()) as { media: { id: string } }).media.id;
}
async function story(owner: Account, caption = ""): Promise<{ status: number; id?: string; body: any }> {
  const r = await request("/api/v1/stories", "POST", { mediaId: await photo(owner), caption, audience: "public", allowComments: "everyone", allowSharing: true }, owner.auth);
  return { status: r.status, id: r.body?.story?.id, body: r.body };
}

describe("action budgets", () => {
  it("stops mass likes with a 429 and Retry-After, and like/unlike cycling notifies the owner once", async () => {
    const [owner, fan] = [await account(), await account()];
    const stories = [(await story(owner)).id!, (await story(owner)).id!, (await story(owner)).id!, (await story(owner)).id!];
    for (const id of stories.slice(0, 3)) assert.equal((await request(`/api/v1/stories/${id}/like`, "POST", undefined, fan.auth)).status, 204);
    const fourth = await request(`/api/v1/stories/${stories[3]}/like`, "POST", undefined, fan.auth);
    assert.equal(fourth.status, 429);
    assert.match(fourth.body.message, /liking too fast/);
    assert.ok(Number(fourth.retryAfter) > 0 && Number(fourth.retryAfter) <= 60);

    const cycler = await account();
    for (let i = 0; i < 3; i++) {
      await request(`/api/v1/stories/${stories[0]}/like`, "POST", undefined, cycler.auth);
      await request(`/api/v1/stories/${stories[0]}/like`, "DELETE", undefined, cycler.auth);
    }
    assert.equal((await queryOne(`SELECT count(*) AS n FROM notifications WHERE recipient_id = :'o' AND actor_id = :'a' AND type = 'like'`, { o: owner.id, a: cycler.id }))?.n, "1");
    assert.equal((await queryOne(`SELECT count(*) AS n FROM push_outbox WHERE user_id = :'o' AND actor_id = :'a'`, { o: owner.id, a: cycler.id }))?.n, "1");
  });

  it("notifies a follow once even when someone follows and unfollows repeatedly", async () => {
    const [target, cycler] = [await account(), await account()];
    for (let i = 0; i < 3; i++) {
      await request(`/api/v1/users/${target.input.username}/follow`, "POST", undefined, cycler.auth);
      await request(`/api/v1/users/${target.input.username}/follow`, "DELETE", undefined, cycler.auth);
    }
    assert.equal((await queryOne(`SELECT count(*) AS n FROM notifications WHERE recipient_id = :'t' AND actor_id = :'a' AND type = 'follow'`, { t: target.id, a: cycler.id }))?.n, "1");
  });

  it("limits new accounts more tightly and refuses copy-paste comment spam", async () => {
    const owner = await account({ ageDays: 30 });
    const ids = [(await story(owner)).id!, (await story(owner)).id!, (await story(owner)).id!, (await story(owner)).id!, (await story(owner)).id!];
    const fresh = await account();
    for (const id of ids.slice(0, 3)) assert.equal((await request(`/api/v1/stories/${id}/comments`, "POST", { body: "Check my profile!!" }, fresh.auth)).status, 201);
    const pasted = await request(`/api/v1/stories/${ids[3]}/comments`, "POST", { body: "check my   PROFILE!!" }, fresh.auth);
    assert.deepEqual([pasted.status, /several times/.test(pasted.body.message)], [429, true], "the same text a fourth time");
    const overBudget = await request(`/api/v1/stories/${ids[4]}/comments`, "POST", { body: "something else" }, fresh.auth);
    assert.deepEqual([overBudget.status, /commenting too fast/.test(overBudget.body.message)], [429, true], "4 per hour for a new account");

    const regular = await account({ ageDays: 3 });
    for (const [i, id] of ids.entries()) assert.equal((await request(`/api/v1/stories/${id}/comments`, "POST", { body: `nice ${i}` }, regular.auth)).status, 201, "older accounts get the normal budget");
  });

  it("stops counting views from an account viewing faster than a person can watch, without refusing playback", async () => {
    const owner = await account();
    const viewer = await account();
    const ids = [];
    for (let i = 0; i < 5; i++) ids.push((await story(owner)).id!);
    for (const id of ids) assert.equal((await request(`/api/v1/stories/${id}/view`, "POST", undefined, viewer.auth)).status, 204);
    assert.equal((await queryOne(`SELECT count(*) AS n FROM story_views WHERE viewer_id = :'v'`, { v: viewer.id }))?.n, "3");
    assert.equal((await request(`/api/v1/stories/${ids[4]}`, "GET", undefined, viewer.auth)).status, 200, "still watchable");
  });

  it("limits DMs and cold conversations, never counting retries of the same message", async () => {
    const sender = await account({ ageDays: 10 });
    const [r1, r2, r3] = [await account(), await account(), await account()];
    const c1 = (await request(`/api/v1/users/${r1.input.username}/conversation`, "POST", undefined, sender.auth)).body.conversation.id;
    assert.equal((await request(`/api/v1/users/${r2.input.username}/conversation`, "POST", undefined, sender.auth)).status, 200);
    const third = await request(`/api/v1/users/${r3.input.username}/conversation`, "POST", undefined, sender.auth);
    assert.deepEqual([third.status, /new conversations/.test(third.body.message)], [429, true]);
    assert.equal((await request(`/api/v1/users/${r1.input.username}/conversation`, "POST", undefined, sender.auth)).status, 200, "reopening an existing thread is free");

    const send = (body: string, clientMessageId?: string) =>
      request(`/api/v1/conversations/${c1}/messages`, "POST", { body, ...(clientMessageId ? { clientMessageId } : {}) }, sender.auth);
    const id = "retry_abuse_0123456789";
    assert.equal((await send("one", id)).status, 201);
    for (let i = 0; i < 5; i++) assert.equal((await send("one", id)).status, 200, "retries replay without counting");
    for (const body of ["two", "three", "four"]) assert.equal((await send(body)).status, 201);
    assert.equal((await send("five")).status, 429);
  });
});

describe("links", () => {
  it("keeps links out of new accounts' comments and DMs and refuses script URLs anywhere", async () => {
    const owner = await account({ ageDays: 30 });
    const id = (await story(owner)).id!;
    const fresh = await account();
    const linked = await request(`/api/v1/stories/${id}/comments`, "POST", { body: "win prizes at www.free-gifts.xyz now" }, fresh.auth);
    assert.deepEqual([linked.status, linked.body.message], [422, "New accounts can share links after their first day."]);
    const c = (await request(`/api/v1/users/${owner.input.username}/conversation`, "POST", undefined, fresh.auth)).body.conversation.id;
    assert.equal((await request(`/api/v1/conversations/${c}/messages`, "POST", { body: "see https://example.org/x" }, fresh.auth)).status, 422);
    assert.equal((await request(`/api/v1/conversations/${c}/messages`, "POST", { body: "data: 5 GB used, File: notes.pdf" }, fresh.auth)).status, 201, "ordinary text isn't mistaken for a link");
    assert.equal((await request("/api/v1/users/me", "PATCH", { bio: "click javascript:alert(document.cookie)" }, owner.auth)).status, 422);

    const regular = await account({ ageDays: 3 });
    assert.equal((await request(`/api/v1/stories/${id}/comments`, "POST", { body: "great tips at https://example.org/guide" }, regular.auth)).status, 201);
    assert.equal((await request(`/api/v1/stories/${id}/comments`, "POST", { body: "official page http://xn--pple-43d.com" }, regular.auth)).status, 422, "look-alike domain from a week-old account");
    const veteran = await account({ ageDays: 10 });
    assert.equal((await request(`/api/v1/stories/${id}/comments`, "POST", { body: "official page http://xn--pple-43d.com" }, veteran.auth)).status, 201);
  });

  it("refuses links Safe Browsing flags, and lets text through when the service is down", async () => {
    const owner = await account({ ageDays: 30 });
    const id = (await story(owner)).id!;
    const before = sb.requests;
    const flagged = await request(`/api/v1/stories/${id}/comments`, "POST", { body: "free stuff https://malware.example.net/get" }, owner.auth);
    assert.deepEqual([flagged.status, flagged.body.message], [422, "That link was flagged as unsafe."]);
    assert.equal((await request(`/api/v1/stories/${id}/comments`, "POST", { body: "docs at https://docs.example.net/start" }, owner.auth)).status, 201);
    assert.ok(sb.requests > before);
    sb.down = true;
    assert.equal((await request(`/api/v1/stories/${id}/comments`, "POST", { body: "mirror https://other.example.net/start" }, owner.auth)).status, 201, "fail open");
    sb.down = false;
    assert.equal((await story(owner, "giveaway at https://malware.example.net/now")).status, 422, "captions are checked too");
  });

  it("lets safety admins block domains (and their subdomains) everywhere, with an audit trail", async () => {
    const safety = await account({ grant: ["safety.settings.manage", "ads.create", "ads.edit", "ads.analytics.read"] });
    const sh = await adminSignIn(base, safety.input.email, safety.input.password);
    const block = (domain: string) => request("/api/v1/admin/safety/blocked-domains", "POST", { domain, reason: "Phishing kit", confirmed: true }, sh);
    assert.equal((await block("https://Scam-Site.example/path")).status, 201);
    assert.equal((await block("scam-site.example")).status, 409);
    assert.equal((await block("not a domain")).status, 422);
    const list = await request("/api/v1/admin/safety/blocked-domains", "GET", undefined, sh);
    assert.equal(list.body.items[0].domain, "scam-site.example");

    const user = await account({ ageDays: 30 });
    const id = (await story(user)).id!;
    const refused = await request(`/api/v1/stories/${id}/comments`, "POST", { body: "go to https://login.scam-site.example/reset" }, user.auth);
    assert.deepEqual([refused.status, refused.body.message], [422, "Links to scam-site.example aren't allowed on Katkee."]);
    assert.equal((await request("/api/v1/users/me", "PATCH", { bio: "shop: www.scam-site.example" }, user.auth)).status, 422);

    const advertiser = await request("/api/v1/admin/advertisers", "POST", { name: "Shop", userId: safety.id, confirmed: true }, sh);
    const campaign = await request("/api/v1/admin/campaigns", "POST", {
      advertiserId: advertiser.body.id, mediaId: await photo(safety), name: "Bad landing page",
      startAt: new Date(Date.now() - 60000).toISOString(), endAt: new Date(Date.now() + 3600000).toISOString(),
      budgetMinor: 0, currency: "INR", impressionLimit: 10, userCap: 1, dailyCap: 1, caption: "Sale", cta: "Learn More",
      destination: "https://deals.scam-site.example/", confirmed: true,
    }, sh);
    assert.deepEqual([campaign.status, campaign.body.message], [422, "Links to scam-site.example aren't allowed on Katkee."], "ad destinations go through the same checks");

    assert.equal((await request("/api/v1/admin/safety/blocked-domains/remove", "POST", { domain: "scam-site.example", confirmed: true }, sh)).status, 200);
    assert.equal((await request(`/api/v1/stories/${id}/comments`, "POST", { body: "go to https://login.scam-site.example/reset" }, user.auth)).status, 201);
    const audit = await query(`SELECT action FROM admin_audit WHERE actor_id = :'a' AND action LIKE 'LINK_DOMAIN_%' ORDER BY chain_seq`, { a: safety.id });
    assert.deepEqual(audit.map((r) => r.action), ["LINK_DOMAIN_BLOCKED", "LINK_DOMAIN_UNBLOCKED"]);

    const moderatorOnly = await account({ grant: ["reports.read"] });
    const mh = await adminSignIn(base, moderatorOnly.input.email, moderatorOnly.input.password);
    assert.equal((await request("/api/v1/admin/safety/blocked-domains", "GET", undefined, mh)).status, 403);
  });
});
