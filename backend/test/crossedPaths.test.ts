import "./env";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { buildApp } from "../src/app";
import { query } from "../src/db/psql";
import { authHeader, makeClient, uniqueUser } from "./helpers";
import { runCrossedPaths } from "../src/modules/crossed-paths/crossed-paths";

let client: ReturnType<typeof makeClient>;
const server = buildApp();

before(async () => {
  await new Promise<void>((resolve) => server.listen(0, resolve));
  client = makeClient(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
});
after(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); });

async function person(opts: { on?: boolean; private?: boolean } = {}) {
  const input = uniqueUser();
  const res = await client.post("/api/v1/auth/signup", input);
  const p = { input, token: res.body.tokens.accessToken as string, id: res.body.user.id as string };
  if (opts.on !== false) await client.put("/api/v1/users/me/crossed-paths", { enabled: true }, authHeader(p.token));
  if (opts.private) await client.patch("/api/v1/users/me", { isPrivate: true }, authHeader(p.token));
  return p;
}
// Each test uses its own cell, so tests don't cross each other.
let n = 0;
const nextCell = () => `tdr${"0123456789bcdefghjkmnpqrstuvwxyz"[Math.floor(n / 32) % 32]}${"0123456789bcdefghjkmnpqrstuvwxyz"[n++ % 32]}`;
async function visit(p: { token: string }, cell: string) {
  return client.post("/api/v1/users/me/crossed-paths/visits", { cell }, authHeader(p.token));
}
/** As if the visits happened three hours ago: past the delay. */
async function ageVisits(cell: string) {
  await query(`UPDATE crossed_visits SET first_at = now() - interval '3 hours', last_at = now() - interval '150 minutes' WHERE cell = :'cell'`, { cell });
}
async function crossedWith(p: { token: string }): Promise<string[]> {
  const res = await client.get("/api/v1/notifications", authHeader(p.token));
  return res.body.notifications.filter((x: { type: string }) => x.type === "crossed_paths").map((x: { actor: { username: string } }) => x.actor.username);
}

describe("Crossed paths", () => {
  it("is off until turned on, and a visit while off isn't kept", async () => {
    const p = await person({ on: false });
    assert.deepEqual((await client.get("/api/v1/users/me/crossed-paths", authHeader(p.token))).body, { enabled: false });
    const res = await visit(p, nextCell());
    assert.equal(res.body.recorded, false);
    assert.equal((await visit(p, "not-a-cell")).status, 422);
  });

  it("tells two people who both turned it on and were in the same area, later, once", async () => {
    const a = await person(); const b = await person();
    const cell = nextCell();
    assert.equal((await visit(a, cell)).body.recorded, true);
    await visit(b, cell);
    await runCrossedPaths();
    assert.deepEqual(await crossedWith(a), [], "nothing while it's still fresh (the delay)");
    await ageVisits(cell);
    await runCrossedPaths();
    assert.deepEqual(await crossedWith(a), [b.input.username]);
    assert.deepEqual(await crossedWith(b), [a.input.username]);
    await runCrossedPaths();
    assert.deepEqual(await crossedWith(a), [b.input.username], "not told about the same person again");
  });

  it("never matches someone who didn't turn it on, names only public accounts, and respects blocks", async () => {
    const a = await person(); const off = await person({ on: false }); const locked = await person({ private: true });
    const blocker = await person();
    await client.post(`/api/v1/users/${a.input.username}/block`, undefined, authHeader(blocker.token));
    const cell = nextCell();
    for (const p of [a, off, locked, blocker]) await visit(p, cell);
    await ageVisits(cell);
    await runCrossedPaths();
    assert.deepEqual(await crossedWith(a), [], "not the one who's off, not a private account, not someone who blocked them");
    const heard = await crossedWith(locked);
    assert.ok(heard.includes(a.input.username), "a private account still hears about public people");
    assert.ok(!heard.includes(off.input.username), "never about someone who didn't turn it on");
  });

  it("people in different areas don't cross, and turning it off forgets the visits", async () => {
    const a = await person(); const b = await person();
    const cellA = nextCell(); const cellB = nextCell();
    await visit(a, cellA); await visit(b, cellB);
    await ageVisits(cellA); await ageVisits(cellB);
    await runCrossedPaths();
    assert.deepEqual(await crossedWith(a), []);
    await client.put("/api/v1/users/me/crossed-paths", { enabled: false }, authHeader(a.token));
    const left = await query(`SELECT 1 FROM crossed_visits WHERE user_id = :'u'`, { u: a.id });
    assert.equal(left.length, 0);
  });
});
