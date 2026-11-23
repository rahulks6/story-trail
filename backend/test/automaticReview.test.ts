// Admin > Automatic checks (src/modules/admin/automatic-review.ts): what the automatic moderation
// removed or suspended, a View of the removed Story (only with reports.read, audit-logged), and
// Restore when the check was wrong: the Story and the automatically suspended account come back,
// and a restored Story no longer counts toward a suspension.
import "./admin-env";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { buildApp } from "../src/app";
import { query, queryOne } from "../src/db/psql";
import { autoRemoveStory, suspendRepeatOffender } from "../src/modules/stories/story-ai";
import { buildTestPng } from "./fixtures";
import { authHeader, makeClient, uniqueUser } from "./helpers";
import { adminSignIn } from "./adminSession";

const server = buildApp();
let baseUrl: string;
let client: ReturnType<typeof makeClient>;
before(async () => {
  await new Promise<void>((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  client = makeClient(baseUrl);
});
after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function person() {
  const input = uniqueUser();
  const res = await client.post("/api/v1/auth/signup", input);
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return { ...input, id: res.body.user.id as string, auth: authHeader(res.body.tokens.accessToken as string) };
}
async function story(owner: Awaited<ReturnType<typeof person>>): Promise<string> {
  const up = await fetch(`${baseUrl}/api/v1/media/photos`, { method: "POST", headers: { "Content-Type": "image/png", ...owner.auth }, body: buildTestPng(8, 8) });
  const mediaId = ((await up.json()) as { media: { id: string } }).media.id;
  const res = await client.post("/api/v1/stories", { mediaId, audience: "public", allowComments: "everyone", allowSharing: true }, owner.auth);
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.story.id as string;
}
async function admin(permissions: string[]) {
  const who = await person();
  await query(`INSERT INTO admin_grants(user_id, role, permissions) VALUES (:'id', 'ADMIN', :'p'::jsonb)`, { id: who.id, p: JSON.stringify(permissions) });
  return { ...who, headers: await adminSignIn(baseUrl, who.email, who.password) };
}
type Item = { id: string; action: string; targetType: string; media: string | null; restored: boolean; restorable: boolean; owner: { username: string; state: string } };

describe("Admin > Automatic checks", () => {
  it("lists removals and the suspension, shows a removed Story with an audit entry, and restores Story and account together", async () => {
    const owner = await person();
    const [first, second] = [await story(owner), await story(owner)];
    assert.equal(await autoRemoveStory(first), true);
    assert.equal(await autoRemoveStory(second), true);
    assert.equal((await queryOne(`SELECT moderation_state FROM users WHERE id = :'id'`, { id: owner.id }))?.moderation_state, "SUSPENDED");

    const mod = await admin(["moderation.history.read", "reports.read", "content.restore", "users.suspend"]);
    const list = await fetch(`${baseUrl}/api/v1/admin/automatic?limit=50`, { headers: mod.headers });
    assert.equal(list.status, 200);
    const items = ((await list.json()) as { items: Item[] }).items.filter((i) => i.owner.username === owner.username);
    assert.deepEqual(items.map((i) => i.action), ["suspend", "remove", "remove"], "newest first");
    const removal = items.find((i) => i.action === "remove")!;
    assert.equal(removal.media, "photo");
    assert.equal(removal.restorable, true);

    const view = await fetch(`${baseUrl}/api/v1/admin/automatic/${removal.id}/media`, { headers: mod.headers });
    assert.equal(view.status, 200);
    assert.match(view.headers.get("content-type") ?? "", /^image\//);
    await view.arrayBuffer();
    assert.equal((await queryOne(`SELECT count(*) AS n FROM admin_audit WHERE action = 'AUTOMATIC_REMOVAL_VIEWED' AND actor_id = :'id'`, { id: mod.id }))?.n, "1");

    const restore = (headers: Record<string, string>, id: string, body: Record<string, unknown> = { confirmed: true }) =>
      fetch(`${baseUrl}/api/v1/admin/automatic/${id}/restore`, { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    assert.equal((await restore(mod.headers, removal.id, {})).status, 422, "needs explicit confirmation");
    const done = await restore(mod.headers, removal.id);
    assert.equal(done.status, 200, await done.clone().text());
    assert.deepEqual(await done.json(), { restored: ["account", "story"] });
    const user = await queryOne(`SELECT moderation_state, is_active FROM users WHERE id = :'id'`, { id: owner.id });
    assert.deepEqual([user?.moderation_state, user?.is_active], ["ACTIVE", "t"]);
    const restoredId = (await queryOne(`SELECT target_id FROM moderation_actions WHERE id = :'id'`, { id: removal.id }))?.target_id;
    assert.equal((await queryOne(`SELECT moderation_removed_at FROM stories WHERE id = :'id'`, { id: String(restoredId) }))?.moderation_removed_at, null);
    assert.equal((await restore(mod.headers, removal.id)).status, 409, "already restored");

    // The restored Story no longer counts: one more wrong-looking removal isn't a second strike.
    assert.equal(await suspendRepeatOffender(owner.id), false);
  });

  it("needs reports.read to view and the matching permissions to restore", async () => {
    const owner = await person();
    await autoRemoveStory(await story(owner));
    const historyOnly = await admin(["moderation.history.read"]);
    const items = ((await (await fetch(`${baseUrl}/api/v1/admin/automatic?limit=50`, { headers: historyOnly.headers })).json()) as { items: Item[] }).items;
    const removal = items.find((i) => i.owner.username === owner.username)!;
    const view = await fetch(`${baseUrl}/api/v1/admin/automatic/${removal.id}/media`, { headers: historyOnly.headers });
    assert.equal(view.status, 403);
    const restore = await fetch(`${baseUrl}/api/v1/admin/automatic/${removal.id}/restore`, { method: "POST", headers: { ...historyOnly.headers, "Content-Type": "application/json" }, body: JSON.stringify({ confirmed: true }) });
    assert.equal(restore.status, 403);
    assert.equal((await fetch(`${baseUrl}/api/v1/admin/automatic`, { headers: owner.auth })).status >= 400, true);
  });
});
