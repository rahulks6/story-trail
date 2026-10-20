import "./admin-env";
import { after, before, it } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { buildApp } from "../src/app";
import { query, queryOne } from "../src/db/psql";
import { uniqueUser } from "./helpers";
import { adminSignIn, type AdminHeaders } from "./adminSession";

// Admins correct the festival calendar (lunar dates move) from the console's Festivals page.
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
  return { status: r.status, body: text ? JSON.parse(text) : undefined };
}
async function admin(grant: string[]): Promise<AdminHeaders> {
  const input = uniqueUser();
  const res = await request("/api/v1/auth/signup", "POST", input, {});
  await query(`INSERT INTO admin_grants(user_id, role, permissions) VALUES (:'id', 'ADMIN', :'p'::jsonb)`, { id: res.body.user.id, p: JSON.stringify(grant) });
  return adminSignIn(base, input.email, input.password);
}

it("admins with the settings permission add, correct and remove festivals, with an audit trail", async () => {
  const h = await admin(["safety.settings.manage"]);
  const save = (b: Record<string, unknown>) => request("/api/v1/admin/festivals", "POST", { confirmed: true, slug: "holi-2099", name: "Holi", emoji: "🎨", greeting: "Happy Holi", startsOn: "2099-03-21", endsOn: "2099-03-22", ...b }, h);
  assert.equal((await save({})).status, 200);
  assert.equal((await save({ startsOn: "2099-03-22", endsOn: "2099-03-23" })).status, 200, "the same id corrects the dates");
  assert.deepEqual(await queryOne(`SELECT to_char(starts_on, 'YYYY-MM-DD') AS s, to_char(ends_on, 'YYYY-MM-DD') AS e FROM festivals WHERE slug = 'holi-2099'`), { s: "2099-03-22", e: "2099-03-23" });
  assert.equal((await save({ endsOn: "2099-03-01" })).status, 422, "ends before it starts");
  assert.equal((await save({ endsOn: "2099-05-01" })).status, 422, "longer than 14 days");
  assert.equal((await save({ slug: "Bad Id" })).status, 422);
  assert.equal((await save({ startsOn: "21/03/2099" })).status, 422);
  assert.equal((await save({ confirmed: false })).status, 422, "needs confirmation");

  const list = await request("/api/v1/admin/festivals", "GET", undefined, h);
  assert.ok(list.body.items.some((x: { slug: string; greeting: string }) => x.slug === "holi-2099" && x.greeting === "Happy Holi"));
  assert.equal((await request("/api/v1/admin/festivals/remove", "POST", { confirmed: true, slug: "holi-2099" }, h)).status, 200);
  assert.equal((await request("/api/v1/admin/festivals/remove", "POST", { confirmed: true, slug: "holi-2099" }, h)).status, 404);
  const audit = await query(`SELECT action FROM admin_audit WHERE action LIKE 'FESTIVAL_%' AND metadata->>'slug' = 'holi-2099' ORDER BY created_at`);
  assert.deepEqual(audit.map((a) => a.action), ["FESTIVAL_SAVED", "FESTIVAL_SAVED", "FESTIVAL_REMOVED"]);
});

it("admins without it can't touch the calendar", async () => {
  const h = await admin(["reports.read"]);
  assert.equal((await request("/api/v1/admin/festivals", "GET", undefined, h)).status, 403);
  assert.equal((await request("/api/v1/admin/festivals", "POST", { confirmed: true, slug: "x-2099" }, h)).status, 403);
});
