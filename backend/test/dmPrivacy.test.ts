// DMs are private: no Admin or Ads surface returns message text (there is no documented
// safety workflow granting Admin access to DMs), and only the conversations module reads
// message content. The push dispatcher reads message timestamps for the unread badge.
import "./admin-env";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import type { AddressInfo } from "node:net";
import { buildApp } from "../src/app";
import { query } from "../src/db/psql";
import { authHeader, makeClient, uniqueUser } from "./helpers";
import { adminSignIn } from "./adminSession";

const server = buildApp();
let base = "";
let client: ReturnType<typeof makeClient>;

before(async () => {
  await new Promise<void>((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  client = makeClient(base);
});
after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function signup() {
  const input = uniqueUser();
  const res = await client.post("/api/v1/auth/signup", input);
  return { ...input, id: res.body.user.id as string, token: res.body.tokens.accessToken as string };
}

/** Every GET route the Admin console and the Ads module register (see the static check below). */
const ADMIN_GETS = [
  "/api/v1/admin/session", "/api/v1/admin/dashboard", "/api/v1/admin/reports", "/api/v1/admin/reports/:reportId",
  "/api/v1/admin/evidence/:reportId", "/api/v1/admin/users", "/api/v1/admin/users?search=:username", "/api/v1/admin/users?search=:userId",
  "/api/v1/admin/history", "/api/v1/admin/appeals", "/api/v1/admin/audit", "/api/v1/admin/audit/verify",
  "/api/v1/admin/security-alerts", "/api/v1/admin/admins", "/api/v1/admin/advertisers", "/api/v1/admin/campaigns",
  "/api/v1/admin/campaigns/:campaignId/analytics", "/api/v1/admin/campaigns/:campaignId/preview", "/api/v1/admin/ad-settings",
  "/api/v1/admin/media/:mediaId", "/api/v1/moderation/reports", "/api/v1/ads/placements", "/api/v1/ads/deliveries/:deliveryId",
  "/api/v1/ads/deliveries/:deliveryId/media",
];

describe("DM privacy", () => {
  it("no Admin, moderation or Ads endpoint returns DM text, even to a Super Admin", async () => {
    const [sender, recipient] = [await signup(), await signup()];
    const secret = `private-${randomUUID()}`;
    const conversation = (await client.post(`/api/v1/users/${recipient.username}/conversation`, undefined, authHeader(sender.token))).body.conversation.id as string;
    assert.equal((await client.post(`/api/v1/conversations/${conversation}/messages`, { body: `meet me, ${secret}` }, authHeader(sender.token))).status, 201);
    // The recipient reports the sender (DMs themselves can't be attached to a report).
    const report = await client.post("/api/v1/reports", { targetType: "user", targetId: sender.id, reason: "harassment", details: "unwanted messages" }, authHeader(recipient.token));
    assert.equal(report.status, 201, JSON.stringify(report.body));

    const operator = await signup();
    await query(`INSERT INTO admin_grants(user_id, role, permissions) VALUES (:'id', 'SUPER_ADMIN', '[]'::jsonb)`, { id: operator.id });
    const headers = await adminSignIn(base, operator.email, operator.password);
    const ids: Record<string, string> = {
      reportId: report.body.report.id, username: sender.username, userId: sender.id, mediaId: randomUUID(), campaignId: randomUUID(), deliveryId: randomUUID(),
    };
    const crawled: string[] = [];
    for (const route of ADMIN_GETS) {
      const url = route.replace(/:(\w+)/g, (_, k: string) => encodeURIComponent(ids[k]!));
      for (const auth of [headers, authHeader(operator.token)]) {
        const res = await fetch(base + url, { headers: auth });
        const text = await res.text();
        assert.ok(res.status < 500, `${url} -> ${res.status} ${text}`);
        assert.ok(!text.includes(secret), `${url} returned DM text`);
        assert.ok(!text.includes(conversation), `${url} returned a conversation id`);
        crawled.push(`${res.status} ${url}`);
      }
    }
    assert.ok(crawled.filter((c) => c.startsWith("200 ")).length >= 15, crawled.join("\n"));
  });

  it("only the conversations module reads message content", () => {
    const src = path.resolve(__dirname, "../../src");
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith(".ts")) files.push(full);
      }
    };
    walk(src);
    assert.ok(files.length > 50, "found the backend source");
    const dmTable = /\b(FROM|JOIN|INTO|UPDATE)\s+(messages|conversations|conversation_reads)\b/i;
    const readers = files.filter((f) => dmTable.test(fs.readFileSync(f, "utf8"))).map((f) => path.relative(src, f)).sort();
    assert.deepEqual(readers, [
      "modules/conversations/conversations.repository.ts",
      // Unread badge only: counts conversations by message timestamps, never selects a body.
      "modules/push/dispatcher.ts",
    ], "a new reader of DM tables needs a privacy review (and an update here)");
    const dispatcher = fs.readFileSync(path.join(src, "modules/push/dispatcher.ts"), "utf8");
    assert.ok(!/\bm\.body\b|messages\.body|SELECT\s+body/i.test(dispatcher), "the dispatcher never reads message bodies");

    const adminAndAds = files.filter((f) => /modules\/(admin|ads|recommendations|moderation)\//.test(f));
    assert.ok(adminAndAds.length >= 5);
    for (const file of adminAndAds) {
      const text = fs.readFileSync(file, "utf8");
      assert.ok(!/conversations\//.test(text), `${path.relative(src, file)} imports the conversations module`);
      assert.ok(!/\bmessages\b\s*(m\b|AS\b|WHERE|,)/i.test(text), `${path.relative(src, file)} queries messages`);
    }

    // The crawl above covers every Admin/moderation/Ads GET route that exists.
    const registered = new Set<string>();
    for (const file of files) {
      for (const m of fs.readFileSync(file, "utf8").matchAll(/router\.get\(\s*['"`](\/api\/v1\/(?:admin|ads|moderation)[^'"`]*)/g)) registered.add(m[1]!);
    }
    const crawled = new Set(ADMIN_GETS.map((r) => r.split("?")[0]!.replace(/:\w+/g, ":param")));
    const missing = [...registered].map((r) => r.replace(/:\w+/g, ":param")).filter((r) => !crawled.has(r));
    assert.deepEqual(missing, [], "add new Admin GET routes to the crawl");
  });
});
