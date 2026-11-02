// Contacts on Katkee and Invite friends (src/modules/growth). Contact matching finds only
// verified emails and phone numbers of usable accounts that allow it, never across a block, and
// keeps nothing it was sent. Invite links credit a new account to its inviter once, suggest each
// to the other, tell the inviter, and give the website's /i/<code> page its headline.
import "./provider-env";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { buildApp } from "../src/app";
import { query, queryOne } from "../src/db/psql";
import { contactHash, CONTACT_BATCHES_PER_HOUR, MAX_HASHES_PER_BATCH, phoneContactKey } from "../src/modules/growth/contacts";
import { INVITE_WINDOW_DAYS } from "../src/modules/growth/invites";
import { renderPush } from "../src/modules/push/dispatcher";
import { authHeader, makeClient, uniqueUser, ADULT_BIRTH_DATE } from "./helpers";

// Only the SMS gateway is a stand-in: every code is "246810".
const server = buildApp({
  async google() { throw new Error("not used"); },
  async sendPhone() { return "VE" + "3".repeat(32); },
  async checkPhone(_sid, code) { return code === "246810"; },
});
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

interface Person { id: string; username: string; email: string; displayName: string; auth: Record<string, string> }

async function person(options: { verified?: boolean; displayName?: string } = {}): Promise<Person> {
  const input = { ...uniqueUser(), ...(options.displayName ? { displayName: options.displayName } : {}) };
  const res = await client.post("/api/v1/auth/signup", input);
  assert.equal(res.status, 201, JSON.stringify(res.body));
  if (options.verified !== false) await query(`UPDATE users SET email_verified_at = now() WHERE id = :'id'`, { id: res.body.user.id });
  return { id: res.body.user.id, username: input.username, email: input.email, displayName: input.displayName, auth: authHeader(res.body.tokens.accessToken) };
}

/** A fresh US number for the phone sign-in (each can ask for a code once a minute). */
function newUsNumber(): string {
  return `+1202555${String(1000 + Math.floor(Math.random() * 9000))}`;
}

/** Signs up with a phone number through the real code flow; returns the new account. */
async function phonePerson(e164: string): Promise<Person> {
  const sent = await client.post("/api/v1/auth/phone/request", { phone: e164, country: "US" });
  assert.equal(sent.status, 200, JSON.stringify(sent.body));
  const proof = await client.post("/api/v1/auth/phone/verify", { challenge: sent.body.challenge, code: "246810" });
  assert.equal(proof.status, 200, JSON.stringify(proof.body));
  assert.equal(proof.body.onboardingRequired, true);
  const username = `test_${randomUUID().slice(0, 8)}`;
  const done = await client.post("/api/v1/auth/provider/complete", { proof: proof.body.proof, username, birthDate: ADULT_BIRTH_DATE });
  assert.equal(done.status, 200, JSON.stringify(done.body));
  return { id: done.body.user.id, username, email: "", displayName: username, auth: authHeader(done.body.tokens.accessToken) };
}

const emailHash = (email: string) => contactHash("email", email.trim().toLowerCase());
const randomHash = () => randomBytes(32).toString("hex");

async function match(who: Person, hashes: string[]) {
  const res = await client.post("/api/v1/contacts/match", { hashes }, who.auth);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body.matches as Array<{ id: string; username: string; displayName: string; isPrivate: boolean; verified: boolean; viewer: { isFollowing: boolean; isFollowedBy: boolean; hasPendingRequestFromViewer: boolean } }>;
}
const ids = (matches: Array<{ id: string }>) => matches.map((m) => m.id).sort();

describe("Contacts on Katkee", () => {
  it("finds accounts by verified email, the same way the app hashes it, and says who you already follow", async () => {
    const viewer = await person();
    const friend = await person();
    const followed = await person();
    assert.equal((await client.post(`/api/v1/users/${followed.username}/follow`, undefined, viewer.auth)).status, 200);
    const found = await match(viewer, [emailHash(friend.email), emailHash(`  ${followed.email.toUpperCase()} `), randomHash()]);
    assert.deepEqual(ids(found), [friend.id, followed.id].sort());
    // Not yet followed first, then the people you follow.
    assert.equal(found[0]!.id, friend.id);
    assert.deepEqual(found[0]!.viewer, { isFollowing: false, isFollowedBy: false, hasPendingRequestFromViewer: false });
    assert.equal(found[1]!.viewer.isFollowing, true);
    assert.deepEqual(Object.keys(found[0]!).sort(), ["avatarMediaId", "displayName", "id", "isPrivate", "username", "verified", "viewer"], "no email or phone in the answer");
    // Upper-case hex is the same hash.
    assert.deepEqual(ids(await match(viewer, [emailHash(friend.email).toUpperCase()])), [friend.id]);
  });

  it("never matches an unverified email, yourself, or anyone who turned it off", async () => {
    const viewer = await person();
    const unverified = await person({ verified: false });
    const hidden = await person();
    const saved = await client.patch("/api/v1/users/me", { findableByContacts: false }, hidden.auth);
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    assert.equal(saved.body.user.findableByContacts, false);
    assert.deepEqual(await match(viewer, [emailHash(unverified.email), emailHash(hidden.email), emailHash(viewer.email)]), []);
    // Turned back on, they can be found again.
    assert.equal((await client.patch("/api/v1/users/me", { findableByContacts: true }, hidden.auth)).status, 200);
    assert.deepEqual(ids(await match(viewer, [emailHash(hidden.email)])), [hidden.id]);
  });

  it("is on by default, shown with your account, and only takes true or false", async () => {
    const who = await person();
    const me = await client.get("/api/v1/auth/me", who.auth);
    assert.equal(me.status, 200);
    assert.equal(me.body.user.findableByContacts, true);
    const bad = await client.patch("/api/v1/users/me", { findableByContacts: "no" }, who.auth);
    assert.equal(bad.status, 422);
  });

  it("hides blocked, suspended, restricted, deactivated and deleted accounts", async () => {
    const viewer = await person();
    const blockedByViewer = await person();
    const blocksViewer = await person();
    const suspended = await person();
    const restricted = await person();
    const inactive = await person();
    const deleted = await person();
    assert.equal((await client.post(`/api/v1/users/${blockedByViewer.username}/block`, undefined, viewer.auth)).status, 204);
    assert.equal((await client.post(`/api/v1/users/${viewer.username}/block`, undefined, blocksViewer.auth)).status, 204);
    await query(`UPDATE users SET moderation_state = 'SUSPENDED' WHERE id = :'id'`, { id: suspended.id });
    await query(`UPDATE users SET moderation_state = 'RESTRICTED' WHERE id = :'id'`, { id: restricted.id });
    await query(`UPDATE users SET is_active = false WHERE id = :'id'`, { id: inactive.id });
    await query(`UPDATE users SET deleted_at = now() WHERE id = :'id'`, { id: deleted.id });
    const everyone = [blockedByViewer, blocksViewer, suspended, restricted, inactive, deleted];
    assert.deepEqual(await match(viewer, everyone.map((p) => emailHash(p.email))), []);
  });

  it("finds a phone number verified at sign-in, through a key a copy of the database can't reverse", async () => {
    const viewer = await person();
    const number = newUsNumber();
    const phoneUser = await phonePerson(number);
    const identity = await queryOne(`SELECT subject, contact_key FROM auth_identities WHERE user_id = :'id' AND provider = 'PHONE'`, { id: phoneUser.id });
    assert.equal(identity?.contact_key, phoneContactKey(number));
    assert.notEqual(identity?.contact_key, contactHash("phone", number), "the stored key is not the app's plain hash");
    assert.ok(!JSON.stringify(identity).includes(number.slice(1)), "the number itself is never stored");
    assert.deepEqual(ids(await match(viewer, [contactHash("phone", number)])), [phoneUser.id]);
    // Unlinked numbers (no identity) and other numbers find nobody.
    assert.deepEqual(await match(viewer, [contactHash("phone", newUsNumber())]), []);
  });

  it("gives a phone linked before contact matching its key at the next phone sign-in", async () => {
    const number = newUsNumber();
    const phoneUser = await phonePerson(number);
    await query(`UPDATE auth_identities SET contact_key = NULL WHERE user_id = :'id'`, { id: phoneUser.id });
    const viewer = await person();
    assert.deepEqual(await match(viewer, [contactHash("phone", number)]), []);
    // Signing in again later (past the one-a-minute code limit) brings the key back.
    await query(`UPDATE auth_phone_challenges SET created_at = created_at - interval '2 minutes' WHERE phone_hash = (SELECT subject FROM auth_identities WHERE user_id = :'id')`, { id: phoneUser.id });
    const sent = await client.post("/api/v1/auth/phone/request", { phone: number, country: "US" });
    assert.equal(sent.status, 200, JSON.stringify(sent.body));
    const signedIn = await client.post("/api/v1/auth/phone/verify", { challenge: sent.body.challenge, code: "246810" });
    assert.equal(signedIn.status, 200, JSON.stringify(signedIn.body));
    assert.equal(signedIn.body.user.id, phoneUser.id);
    assert.deepEqual(ids(await match(viewer, [contactHash("phone", number)])), [phoneUser.id]);
  });

  it("keeps nothing it was sent: no table and no log line holds an uploaded hash", async () => {
    const viewer = await person();
    const friend = await person();
    const unknown = randomHash();
    const lines: string[] = [];
    const originals = { log: console.log, info: console.info, warn: console.warn, error: console.error };
    for (const level of ["log", "info", "warn", "error"] as const) console[level] = (...args: unknown[]) => { lines.push(args.map(String).join(" ")); };
    try {
      await match(viewer, [unknown, emailHash(friend.email)]);
    } finally {
      Object.assign(console, originals);
    }
    assert.ok(!lines.some((line) => line.includes(unknown)), "not logged");
    const columns = await query(
      `SELECT table_name, column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND data_type IN ('text', 'character varying', 'jsonb', 'json', 'USER-DEFINED', 'ARRAY')`,
    );
    for (const c of columns) {
      const table = c.table_name as string, column = c.column_name as string;
      if (!/^[a-z_0-9]+$/.test(table) || !/^[a-z_0-9]+$/.test(column)) continue;
      const hit = await queryOne(`SELECT 1 AS hit FROM "${table}" WHERE "${column}"::text LIKE :'needle' LIMIT 1`, { needle: `%${unknown}%` });
      assert.equal(hit, null, `${table}.${column} holds an uploaded hash`);
    }
  });

  it("takes one batch of SHA-256 hashes at a time", async () => {
    const viewer = await person();
    for (const body of [{}, { hashes: [] }, { hashes: "abc" }, { hashes: ["not-a-hash"] }, { hashes: [randomHash().slice(1)] }, { hashes: Array.from({ length: MAX_HASHES_PER_BATCH + 1 }, randomHash) }]) {
      assert.equal((await client.post("/api/v1/contacts/match", body, viewer.auth)).status, 422, JSON.stringify(body).slice(0, 80));
    }
    assert.equal((await client.post("/api/v1/contacts/match", { hashes: [randomHash()] })).status, 401, "signed in only");
    // A full batch is fine.
    assert.deepEqual(await match(viewer, Array.from({ length: MAX_HASHES_PER_BATCH }, randomHash)), []);
  });

  it("limits how many batches one account can check, so it can't sweep through phone numbers", async () => {
    const viewer = await person();
    // One batch was spent by nobody else: the limit is per account.
    for (let i = 0; i < CONTACT_BATCHES_PER_HOUR; i++) await match(viewer, [randomHash()]);
    const limited = await client.post("/api/v1/contacts/match", { hashes: [randomHash()] }, viewer.auth);
    assert.equal(limited.status, 429);
    const other = await person();
    assert.deepEqual(await match(other, [randomHash()]), [], "another account has its own budget");
  });
});

async function myInvite(who: Person) {
  const res = await client.get("/api/v1/invites/me", who.auth);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body.invite as { code: string; url: string; joinedCount: number };
}
const redeem = (who: Person, code: string) => client.post("/api/v1/invites/redeem", { code }, who.auth);
const suggestionsFor = async (who: Person) => {
  const res = await client.get("/api/v1/search/suggestions", who.auth);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body.suggestions as Array<{ id: string; reason: { kind: string } }>;
};

describe("Invite friends", () => {
  it("gives everyone one katkee.com/i/<code> link that stays the same", async () => {
    const inviter = await person();
    const first = await myInvite(inviter);
    assert.match(first.code, /^[2-9a-hjkmnp-z]{8}$/);
    assert.equal(first.url, `https://katkee.com/i/${first.code}`);
    assert.equal(first.joinedCount, 0);
    assert.deepEqual(await myInvite(inviter), first);
    assert.notEqual((await myInvite(await person())).code, first.code);
    assert.equal((await client.get("/api/v1/invites/me")).status, 401);
  });

  it("credits a new account once, tells the inviter, and suggests each to the other", async () => {
    const inviter = await person({ displayName: "Asha Rao" });
    const { code } = await myInvite(inviter);
    const invitee = await person();
    const first = await redeem(invitee, code.toUpperCase());
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.equal(first.body.status, "redeemed");
    assert.equal(first.body.inviter.username, inviter.username);
    assert.equal(first.body.inviter.displayName, "Asha Rao");
    assert.equal((await redeem(invitee, code)).body.status, "already_redeemed");
    assert.equal((await myInvite(inviter)).joinedCount, 1);

    const activity = await client.get("/api/v1/notifications", inviter.auth);
    const joined = (activity.body.notifications as Array<{ type: string; actor: { username: string } | null }>).filter((n) => n.type === "invite_joined");
    assert.equal(joined.length, 1, "one notification, however often the link is opened");
    assert.equal(joined[0]!.actor?.username, invitee.username);
    const push = await queryOne(`SELECT id, user_id, kind, actor_id, ref_id, attempts FROM push_outbox WHERE user_id = :'u' AND kind = 'invite_joined'`, { u: inviter.id });
    assert.ok(push, "a push is queued");
    const rendered = await renderPush({ id: push.id!, userId: inviter.id, kind: "invite_joined", actorId: invitee.id, refId: null, attempts: 0 });
    assert.ok("message" in rendered, JSON.stringify(rendered));
    if ("message" in rendered) {
      assert.equal(rendered.message.body, `@${invitee.username} joined from your invite`);
      assert.equal(rendered.message.data.url, `katkee://user/${invitee.username}`);
    }

    const forInvitee = await suggestionsFor(invitee);
    assert.equal(forInvitee[0]?.id, inviter.id, "the inviter comes first");
    assert.deepEqual(forInvitee[0]?.reason, { kind: "invited_you" });
    const forInviter = await suggestionsFor(inviter);
    assert.equal(forInviter[0]?.id, invitee.id);
    assert.deepEqual(forInviter[0]?.reason, { kind: "joined_from_your_invite" });
    // Followed: no longer a suggestion.
    assert.equal((await client.post(`/api/v1/users/${inviter.username}/follow`, undefined, invitee.auth)).status, 200);
    assert.ok(!(await suggestionsFor(invitee)).some((s) => s.id === inviter.id));
  });

  it("credits only one inviter, never yourself, and never an account older than the window", async () => {
    const a = await person();
    const b = await person();
    const invitee = await person();
    assert.equal((await redeem(invitee, (await myInvite(a)).code)).body.status, "redeemed");
    assert.equal((await redeem(invitee, (await myInvite(b)).code)).body.status, "already_redeemed");
    assert.equal((await myInvite(b)).joinedCount, 0);
    assert.equal((await redeem(a, (await myInvite(a)).code)).body.status, "own");
    const old = await person();
    await query(`UPDATE users SET created_at = now() - make_interval(days => :'d'::integer + 1) WHERE id = :'id'`, { id: old.id, d: INVITE_WINDOW_DAYS });
    const late = await redeem(old, (await myInvite(b)).code);
    assert.equal(late.body.status, "not_new");
    assert.equal(late.body.inviter.username, b.username, "the app can still open the inviter's profile");
    const count = await queryOne(`SELECT count(*) AS n FROM invite_redemptions WHERE inviter_id = :'b'`, { b: b.id });
    assert.equal(count?.n, "0");
  });

  it("treats unknown codes, suspended or deleted inviters and blocks alike: the link doesn't work", async () => {
    const invitee = await person();
    for (const code of ["23456789", "short", "with spaces", "00000000"]) assert.equal((await redeem(invitee, code)).status, 404, code);
    const suspended = await person();
    const suspendedCode = (await myInvite(suspended)).code;
    await query(`UPDATE users SET moderation_state = 'SUSPENDED' WHERE id = :'id'`, { id: suspended.id });
    assert.equal((await redeem(invitee, suspendedCode)).status, 404);
    const gone = await person();
    const goneCode = (await myInvite(gone)).code;
    await query(`UPDATE users SET deleted_at = now() WHERE id = :'id'`, { id: gone.id });
    assert.equal((await redeem(invitee, goneCode)).status, 404);
    const blocker = await person();
    const blockerCode = (await myInvite(blocker)).code;
    assert.equal((await client.post(`/api/v1/users/${invitee.username}/block`, undefined, blocker.auth)).status, 204);
    const blocked = await redeem(invitee, blockerCode);
    assert.equal(blocked.status, 404);
    assert.deepEqual(blocked.body, (await redeem(invitee, "23456789")).body, "a block looks exactly like a bad link");
    assert.equal((await queryOne(`SELECT count(*) AS n FROM invite_redemptions WHERE invitee_id = :'id'`, { id: invitee.id }))?.n, "0");
  });

  it("tells the app's sign-up screen whose invite it is, by name only", async () => {
    const inviter = await person({ displayName: "Ravi K" });
    const { code } = await myInvite(inviter);
    const res = await client.get(`/api/v1/invites/${code}`);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { inviter: { username: inviter.username, displayName: "Ravi K", verified: false } });
    assert.equal((await client.get("/api/v1/invites/23456789")).status, 404);
    assert.equal((await client.get("/api/v1/invites/not-a-code")).status, 404);
  });
});

describe("katkee.com/i/<code>", () => {
  const page = async (path: string) => {
    const res = await fetch(`${baseUrl}${path}`);
    return { status: res.status, html: await res.text(), headers: res.headers };
  };

  it("names the friend who sent it, escaped, and opens the invite in the app", async () => {
    const inviter = await person({ displayName: "Asha & Co" });
    const { code } = await myInvite(inviter);
    const res = await page(`/i/${code.toUpperCase()}`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /text\/html/);
    assert.equal(res.headers.get("x-robots-tag"), "noindex");
    assert.match(res.headers.get("content-security-policy") ?? "", /default-src 'none'/);
    assert.ok(res.html.includes("<h1>Asha &amp; Co invited you to Katkee</h1>"));
    assert.ok(res.html.includes("<title>Asha &amp; Co invited you to Katkee</title>"), "link previews in chats name the friend");
    assert.ok(res.html.includes(`href="katkee://invite/${code}"`));
    assert.ok(res.html.includes(`<link rel="canonical" href="https://katkee.com/i/${code}">`));
    assert.ok(!res.html.includes(inviter.email), "nothing but the name");
    assert.ok(!/%INVITE_[A-Z_]+%/.test(res.html), "every marker filled in");
  });

  it("shows a plain invitation for a link that doesn't work, and 404 for anything that isn't a code", async () => {
    const unknown = await page("/i/23456789");
    assert.equal(unknown.status, 200);
    assert.ok(unknown.html.includes("<h1>You&#39;re invited to Katkee</h1>"));
    for (const path of ["/i/", "/i/short", "/i/0000000o", "/i/%3Cscript%3E", "/i/23456789/extra"]) assert.equal((await page(path)).status, 404, path);
  });
});

describe("invite and contacts analytics", () => {
  it("accepts where an invite was shared, and how many contacts were found, and nothing else", async () => {
    const who = await person();
    const at = new Date().toISOString();
    const res = await client.post("/api/v1/analytics/events", {
      platform: "android",
      events: [
        { id: randomUUID(), name: "invite_shared", occurredAt: at, properties: { from: "settings", to: "whatsapp" } },
        { id: randomUUID(), name: "invite_link_opened", occurredAt: at, properties: { signedIn: false } },
        { id: randomUUID(), name: "contacts_checked", occurredAt: at, properties: { found: 7, hashes: 300 } },
        { id: randomUUID(), name: "invite_shared", occurredAt: at, properties: { from: "somewhere" } },
      ],
    }, who.auth);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const rows = await query(`SELECT name, properties FROM analytics_events WHERE user_id = :'u' ORDER BY name, properties::text`, { u: who.id });
    assert.deepEqual(rows.map((r) => [r.name, JSON.parse(r.properties as string)]), [
      ["contacts_checked", { found: 7 }],
      ["invite_link_opened", { signedIn: false }],
      ["invite_shared", { from: "settings" }],
      // An unknown place is dropped, the event kept (as for every other event).
      ["invite_shared", {}],
    ]);
  });
});
