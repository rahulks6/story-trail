// Username rules (spec section 23): one policy for sign-up, Google/phone onboarding and profile
// edits; a live availability check; a 14-day hold on a name someone renamed away from; at most
// two renames in 14 days; and the permanent account ID, which still finds a person after a
// rename. Everything here goes through the real HTTP API and database; only the Google gateway
// is a test double.
import "./provider-env";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { buildApp } from "../src/app";
import { openDedicatedConnection, query, queryOne } from "../src/db/psql";
import { HttpError } from "../src/http/errors";
import { normaliseUsername, usernameProblem, USERNAME_MESSAGES, USERNAME_WORDS } from "../src/modules/users/username-policy";
import { authHeader, makeClient, uniqueUser } from "./helpers";

const tag = randomUUID().slice(0, 8);
const server = buildApp({
  async google(token) {
    if (!token.startsWith("verified-")) throw new HttpError(401, "Invalid test assertion");
    return { subject: `${token}-${tag}`, email: null, displayName: "Username test" };
  },
  async sendPhone() {
    return "VE" + "3".repeat(32);
  },
  async checkPhone() {
    return false;
  },
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

interface Person { id: string; username: string; password: string; auth: Record<string, string> }

const fresh = () => `nm_${randomBytes(5).toString("hex")}`;

async function signup(): Promise<Person> {
  const input = uniqueUser();
  const res = await client.post("/api/v1/auth/signup", input);
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return { id: res.body.user.id, username: input.username, password: input.password, auth: authHeader(res.body.tokens.accessToken) };
}

const rename = (who: Person, username: string, extra: Record<string, unknown> = {}) =>
  client.patch("/api/v1/users/me", { username, ...extra }, who.auth);

const availability = (username: string, headers?: Record<string, string>) =>
  client.get(`/api/v1/usernames/availability?username=${encodeURIComponent(username)}`, headers);

async function currentUsername(who: Person): Promise<string> {
  const me = await client.get("/api/v1/auth/me", who.auth);
  assert.equal(me.status, 200);
  return me.body.user.username;
}

async function onboardWithGoogle(username: string) {
  const pending = await client.post("/api/v1/auth/google", { idToken: `verified-${randomUUID()}` });
  assert.equal(pending.body.onboardingRequired, true, JSON.stringify(pending.body));
  return client.post("/api/v1/auth/provider/complete", { proof: pending.body.proof, username });
}

describe("the username rules", () => {
  it("allow ordinary names, including short words inside longer ones", () => {
    for (const name of [
      "alice", "bob", "b.o.b", "nigeria", "niger.delta", "classic", "cockpit", "therapist", "grape_juice",
      "pakistan_cricket", "nazir", "assam_tea", "sussex", "dickens", "hancock", "cumin", "analyst", "badminton",
      "admin_alice", "katniss", "rahul.k_99",
    ]) {
      assert.equal(usernameProblem(name), null, name);
    }
  });

  it("reserve staff, system and page words, and the Katkee name in any disguise", () => {
    for (const name of [
      "admin", "ad.min", "aadmin", "adm1n", "support", "help_", "settings", "noreply", "katkee", "katkee_official",
      "k4tkee", "kat.kee", "katkeee", "the_katkee_team", "katk33",
    ]) {
      assert.deepEqual(usernameProblem(name), { reason: "reserved", message: USERNAME_MESSAGES.reserved }, name);
    }
  });

  it("refuse profanity and slurs, disguised or not", () => {
    for (const name of [
      "fuuuck", "f.u.c.k", "sh1t", "5hit", "b1tch", "n1gga", "a55", "a.s.s", "the_ass", "s3x", "xxx_fan", "boooobs",
      "80085", "madarch0d", "bhosdike", "therapist.rapist",
    ]) {
      assert.deepEqual(usernameProblem(name), { reason: "not_allowed", message: USERNAME_MESSAGES.not_allowed }, name);
    }
  });

  it("keep the format rules", () => {
    for (const name of ["ab", "a".repeat(31), "Alice", "al-ice", "al ice", ".alice", "alice.", "al..ice", "émile", ""]) {
      assert.equal(usernameProblem(name)?.reason, "invalid", JSON.stringify(name));
    }
  });

  it("can't be tripped by a random hex suffix, so generated names are always allowed", () => {
    // Letters that hex digits become once digits are read as letters.
    const hexLetters = new Set(normaliseUsername("0123456789abcdef"));
    const hexOnly = (word: string) => [...word].every((c) => hexLetters.has(c));
    for (const word of USERNAME_WORDS.anywhere) assert.equal(hexOnly(word), false, word);
    assert.equal(hexOnly(USERNAME_WORDS.brand), false);
    // A whole-part word may be stretched by two letters: never to the 8 characters of a suffix.
    for (const word of USERNAME_WORDS.wholePart) assert.ok(!hexOnly(word) || word.length + 2 < 8, word);
    for (const suffix of ["aaaa5555", "80085555", "77117755", "a5555555", "b00b8888"]) {
      assert.equal(usernameProblem(`test_${suffix}`), null, suffix);
    }
    for (let i = 0; i < 100_000; i++) {
      const name = `test_${randomBytes(4).toString("hex")}`;
      assert.equal(usernameProblem(name), null, name);
    }
  });
});

describe("username availability", () => {
  it("reports each state, signed out and signed in, and is never cached", async () => {
    const a = await signup();
    const b = await signup();
    const expect = async (name: string, headers: Record<string, string> | undefined, reason: string, available: boolean) => {
      const res = await availability(name, headers);
      assert.equal(res.status, 200);
      assert.equal(res.body.reason, reason, name);
      assert.equal(res.body.available, available, name);
      assert.equal(res.body.message, (USERNAME_MESSAGES as Record<string, string>)[reason]);
    };
    await expect(a.username, undefined, "taken", false);
    await expect(a.username, b.auth, "taken", false);
    await expect(a.username, a.auth, "yours", true);
    await expect(fresh(), undefined, "available", true);
    await expect("support", undefined, "reserved", false);
    await expect("k4tkee_news", a.auth, "reserved", false);
    await expect("sh1t_happens", undefined, "not_allowed", false);
    await expect("x", undefined, "invalid", false);
    await expect("al..ice", undefined, "invalid", false);

    const spaced = await availability(`  ${a.username.toUpperCase()} `);
    assert.equal(spaced.body.username, a.username, "checked the way it would be saved");
    assert.equal(spaced.body.reason, "taken");

    const raw = await fetch(`${baseUrl}/api/v1/usernames/availability?username=${fresh()}`);
    assert.equal(raw.headers.get("cache-control"), "no-store");
    await raw.arrayBuffer();
    assert.equal((await availability(fresh(), { Authorization: "Bearer not-a-token" })).status, 401);
  });

  it("frees a deleted account's name at once, as before", async () => {
    const a = await signup();
    const deleted = await client.deleteWithBody("/api/v1/users/me", { password: a.password }, a.auth);
    assert.equal(deleted.status, 204);
    assert.equal((await availability(a.username)).body.reason, "available");
  });
});

describe("renaming", () => {
  it("holds the old name for 14 days: only its previous owner can take it back", async () => {
    const a = await signup();
    const b = await signup();
    const old = a.username;
    const next = fresh();
    assert.equal((await rename(a, next)).status, 200);
    const history = await queryOne(`SELECT old_username, new_username FROM username_changes WHERE user_id = :'id'`, { id: a.id });
    assert.deepEqual([history?.old_username, history?.new_username], [old, next]);

    const byProfile = await rename(b, old);
    assert.equal(byProfile.status, 409);
    assert.equal(byProfile.body.message, USERNAME_MESSAGES.held);
    assert.equal(await currentUsername(b), b.username, "the refused rename changed nothing");
    const bySignup = await client.post("/api/v1/auth/signup", { ...uniqueUser(), username: old });
    assert.equal(bySignup.status, 409);
    assert.equal(bySignup.body.message, USERNAME_MESSAGES.held);
    const byOnboarding = await onboardWithGoogle(old);
    assert.equal(byOnboarding.status, 409);
    assert.equal(byOnboarding.body.message, USERNAME_MESSAGES.held);

    assert.equal((await availability(old)).body.reason, "held");
    assert.equal((await availability(old, b.auth)).body.reason, "held");
    assert.equal((await availability(old, a.auth)).body.reason, "available", "still the previous owner's to take back");
    assert.equal((await rename(a, old)).status, 200);
    assert.equal(await currentUsername(a), old);
  });

  it("allows two renames in 14 days, then says when the next one is possible", async () => {
    const a = await signup();
    const original = a.username;
    const [first, second, third] = [fresh(), fresh(), fresh()];
    assert.equal((await rename(a, first)).status, 200);
    assert.equal((await rename(a, second)).status, 200);

    const refused = await fetch(`${baseUrl}/api/v1/users/me`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...a.auth },
      body: JSON.stringify({ username: third, bio: "not saved" }),
    });
    assert.equal(refused.status, 429);
    const body = (await refused.json()) as { message: string; fields: Record<string, string> };
    const retryAfter = Number(refused.headers.get("retry-after"));
    assert.ok(retryAfter > 14 * 86400 - 300 && retryAfter <= 14 * 86400, String(retryAfter));
    const day = new Date(Date.now() + retryAfter * 1000).toISOString().slice(0, 10);
    assert.equal(body.message, `You can change your username twice in 14 days. Try again after ${day}.`);
    assert.equal(body.fields.username, body.message);
    const me = await client.get("/api/v1/auth/me", a.auth);
    assert.deepEqual([me.body.user.username, me.body.user.bio], [second, ""], "nothing in the refused edit was saved");

    const otherEdits = await rename(a, second, { bio: "Other edits still save" });
    assert.equal(otherEdits.status, 200, "saving the current name is not a rename");

    await query(`UPDATE username_changes SET changed_at = changed_at - interval '14 days 1 minute' WHERE user_id = :'id'`, { id: a.id });
    assert.equal((await rename(a, third)).status, 200);
    assert.equal((await availability(original)).body.reason, "available", "the hold has ended");
    const reuse = await client.post("/api/v1/auth/signup", { ...uniqueUser(), username: original });
    assert.equal(reuse.status, 201);
  });

  it("a rename and a claim of the same name never both win", async () => {
    for (let i = 0; i < 6; i++) {
      const [a, b] = await Promise.all([signup(), signup()]);
      const next = fresh();
      const [moved, claimed] = await Promise.all([rename(a, next), rename(b, a.username)]);
      assert.equal(moved.status, 200);
      assert.equal(claimed.status, 409, JSON.stringify(claimed.body));
      assert.deepEqual([await currentUsername(a), await currentUsername(b)], [next, b.username]);
    }
  });

  it("a new account claiming a name mid-rename waits for the rename, then sees the hold", async () => {
    // Onboarding inserts without a separate "is it taken" read first, so only the per-name lock
    // stands between it and a rename that hasn't committed yet.
    const a = await signup();
    const old = a.username;
    const pending = await client.post("/api/v1/auth/google", { idToken: `verified-${randomUUID()}` });
    assert.equal(pending.body.onboardingRequired, true);
    const db = await openDedicatedConnection();
    try {
      await db.query("BEGIN");
      await db.query("UPDATE users SET username = $1 WHERE id = $2", [fresh(), a.id]);
      const claim = client.post("/api/v1/auth/provider/complete", { proof: pending.body.proof, username: old });
      // The claim must be waiting on the open rename, not deciding before it ends.
      const deadline = Date.now() + 5000;
      while (Number((await queryOne("SELECT count(*) AS n FROM pg_locks WHERE NOT granted"))?.n) === 0) {
        assert.ok(Date.now() < deadline, "the claim never waited for the rename");
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      await db.query("COMMIT");
      const claimed = await claim;
      assert.equal(claimed.status, 409, JSON.stringify(claimed.body));
      assert.equal(claimed.body.message, USERNAME_MESSAGES.held);
      assert.equal((await queryOne(`SELECT count(*) AS n FROM users WHERE username = :'name'`, { name: old }))?.n, "0");
    } finally {
      await db.end();
    }
  });

  it("two renames at once can't get past the limit", async () => {
    const a = await signup();
    assert.equal((await rename(a, fresh())).status, 200);
    const results = await Promise.all([rename(a, fresh()), rename(a, fresh())]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 429]);
    const count = await queryOne(`SELECT count(*) AS n FROM username_changes WHERE user_id = :'id'`, { id: a.id });
    assert.equal(count?.n, "2");
  });

  it("applies the full rules to a new name, and still saves a name chosen before them", async () => {
    const a = await signup();
    // A name from before these rules: set directly, as an old account would have it.
    const legacy = `katkee_fan_${tag}`;
    await query(`UPDATE users SET username = :'name' WHERE id = :'id'`, { name: legacy, id: a.id });
    const unchanged = await rename(a, legacy, { bio: "Same name, new bio" });
    assert.equal(unchanged.status, 200, JSON.stringify(unchanged.body));
    assert.equal(unchanged.body.user.bio, "Same name, new bio");

    const reserved = await rename(a, "k4tkee_fan");
    assert.equal(reserved.status, 422);
    assert.equal(reserved.body.fields.username, USERNAME_MESSAGES.reserved);
    const rude = await rename(a, "b1tch.please");
    assert.equal(rude.status, 422);
    assert.equal(rude.body.fields.username, USERNAME_MESSAGES.not_allowed);
    assert.equal(await currentUsername(a), legacy);
  });

  it("sign-up and Google/phone onboarding apply the same rules", async () => {
    const signupReserved = await client.post("/api/v1/auth/signup", { ...uniqueUser(), username: `katkee_${tag}` });
    assert.equal(signupReserved.status, 422);
    assert.equal(signupReserved.body.fields.username, USERNAME_MESSAGES.reserved);
    const signupRude = await client.post("/api/v1/auth/signup", { ...uniqueUser(), username: `sh1t_${tag}` });
    assert.equal(signupRude.status, 422);
    assert.equal(signupRude.body.fields.username, USERNAME_MESSAGES.not_allowed);
    const onboardingReserved = await onboardWithGoogle("k4tkee");
    assert.equal(onboardingReserved.status, 422);
    assert.equal(onboardingReserved.body.message, USERNAME_MESSAGES.reserved);
    const onboardingInvalid = await onboardWithGoogle("al..ice");
    assert.equal(onboardingInvalid.status, 422);
    assert.equal(onboardingInvalid.body.message, USERNAME_MESSAGES.invalid);
  });
});

describe("links by the permanent account ID", () => {
  it("find the person after a rename; a refusal looks like a missing account", async () => {
    const [a, viewer] = await Promise.all([signup(), signup()]);
    const next = fresh();
    assert.equal((await rename(a, next)).status, 200);
    const byId = await client.get(`/api/v1/users/${a.id}`, viewer.auth);
    assert.equal(byId.status, 200);
    assert.deepEqual([byId.body.profile.id, byId.body.profile.username], [a.id, next]);
    assert.equal((await client.get(`/api/v1/users/${a.id.toUpperCase()}`, viewer.auth)).status, 200);
    assert.equal((await client.get(`/api/v1/users/${randomUUID()}`, viewer.auth)).status, 404);
    assert.equal((await client.get(`/api/v1/users/${a.id}`)).status, 401);
    assert.equal((await client.get("/api/v1/users/not-a-name!", viewer.auth)).status, 400);

    const blocker = await signup();
    assert.equal((await client.post(`/api/v1/users/${next}/block`, undefined, blocker.auth)).status, 204);
    assert.equal((await client.get(`/api/v1/users/${a.id}`, blocker.auth)).status, 404, "blocked either way");
    assert.equal((await client.get(`/api/v1/users/${blocker.id}`, a.auth)).status, 404);

    await query(`UPDATE users SET is_active = false WHERE id = :'id'`, { id: a.id });
    assert.equal((await client.get(`/api/v1/users/${a.id}`, viewer.auth)).status, 404, "suspended");
    const gone = await signup();
    assert.equal((await client.deleteWithBody("/api/v1/users/me", { password: gone.password }, gone.auth)).status, 204);
    assert.equal((await client.get(`/api/v1/users/${gone.id}`, viewer.auth)).status, 404, "deleted");
  });
});
