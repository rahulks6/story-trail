// Katkee is for people 18 and older (Phase 14, India launch). Sign-up with an email address and
// finishing a Google or phone sign-up both need a date of birth, checked on the server against
// today's date in India; someone under 18 is turned away with nothing stored. The date is kept
// for the account but never returned. Everything goes through the real HTTP API and database;
// only the Google gateway is a test double.
import "./provider-env";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { buildApp } from "../src/app";
import { queryOne } from "../src/db/psql";
import { HttpError } from "../src/http/errors";
import { ageOn, birthDateProblem, BIRTH_DATE_MESSAGES, MINIMUM_AGE, todayInIndia } from "../src/modules/auth/age";
import { ADULT_BIRTH_DATE, authHeader, makeClient, uniqueUser } from "./helpers";

const tag = randomUUID().slice(0, 8);
const server = buildApp({
  async google(token) {
    if (!token.startsWith("verified-")) throw new HttpError(401, "Invalid test assertion");
    return { subject: `${token}-${tag}`, email: `${token}-${tag}@example.com`, displayName: "Age test" };
  },
  async sendPhone() {
    return "VE" + "3".repeat(32);
  },
  async checkPhone() {
    return false;
  },
});
let client: ReturnType<typeof makeClient>;

before(async () => {
  await new Promise<void>((resolve) => server.listen(0, resolve));
  client = makeClient(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
});
after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (date: Date) => date.toISOString().slice(0, 10);

/** Someone who turns `years` today in India (on 29 February: someone born on the 28th). */
function turnsToday(years: number): string {
  const [y, m, d] = todayInIndia().split("-").map(Number) as [number, number, number];
  return `${y - years}-${pad(m)}-${pad(m === 2 && d === 29 ? 28 : d)}`;
}

/** Someone who turns `years` tomorrow in India: still a day short. */
function turnsTomorrow(years: number): string {
  const tomorrow = new Date(Date.parse(`${todayInIndia()}T00:00:00Z`) + 86_400_000);
  const born = new Date(Date.UTC(tomorrow.getUTCFullYear() - years, tomorrow.getUTCMonth(), tomorrow.getUTCDate()));
  return iso(born); // a 29 February that doesn't exist rolls to 1 March: later, so still too young
}

const usersWithEmail = async (email: string) => (await queryOne(`SELECT count(*) AS n FROM users WHERE email = :'email'`, { email }))?.n;
const storedBirthDate = async (id: string) => (await queryOne(`SELECT birth_date::text AS d FROM users WHERE id = :'id'`, { id }))?.d;
const proofHash = (proof: string) => createHash("sha256").update(proof).digest("hex");

describe("the age rule", () => {
  it("is 18, counted on today's date in India", () => {
    assert.equal(MINIMUM_AGE, 18);
    // 23:59:59 and midnight on 13 October 2026 in India (UTC+05:30).
    const lastSecond = Date.parse("2026-10-12T18:29:59Z");
    const midnight = Date.parse("2026-10-12T18:30:00Z");
    assert.equal(todayInIndia(lastSecond), "2026-10-12");
    assert.equal(todayInIndia(midnight), "2026-10-13");
    assert.equal(birthDateProblem("2008-10-13", lastSecond), BIRTH_DATE_MESSAGES.tooYoung, "the day before the 18th birthday");
    assert.equal(birthDateProblem("2008-10-13", midnight), null, "from midnight in India on the birthday");
    assert.equal(birthDateProblem("1995-05-15", midnight), null);
  });

  it("counts a 29 February birthday from 1 March in other years", () => {
    assert.equal(ageOn("2008-02-29", "2026-02-28"), 17);
    assert.equal(ageOn("2008-02-29", "2026-03-01"), 18);
    assert.equal(ageOn("2008-02-29", "2028-02-29"), 20);
    assert.equal(ageOn("2008-03-01", "2026-02-28"), 17);
    assert.equal(ageOn("2008-01-31", "2026-01-31"), 18);
  });

  it("accepts only a real date in YYYY-MM-DD, from 1900 to today", () => {
    const now = Date.parse("2026-10-13T06:00:00Z");
    for (const missing of [undefined, null, ""]) assert.equal(birthDateProblem(missing, now), BIRTH_DATE_MESSAGES.required);
    for (const bad of ["2001-02-30", "2001-13-01", "2001-00-10", "2001-04-31", "2003-02-29", "15/05/1995", "1995-5-15", "95-05-15",
      "1995-05-15T00:00:00Z", " 1995-05-15", 19950515, {}, ["1995-05-15"], true, "1899-12-31", "2026-10-14", "9999-12-31"]) {
      assert.equal(birthDateProblem(bad, now), BIRTH_DATE_MESSAGES.invalid, JSON.stringify(bad));
    }
    assert.equal(birthDateProblem("1900-01-01", now), null);
    assert.equal(birthDateProblem("2004-02-29", now), null, "a real leap day");
    assert.equal(birthDateProblem("2026-10-13", now), BIRTH_DATE_MESSAGES.tooYoung, "born today");
  });
});

describe("sign-up with an email address", () => {
  it("needs a date of birth and turns away anyone under 18 with nothing stored", async () => {
    const cases: [unknown, string][] = [
      [undefined, BIRTH_DATE_MESSAGES.required],
      ["", BIRTH_DATE_MESSAGES.required],
      [turnsToday(17), BIRTH_DATE_MESSAGES.tooYoung],
      [turnsTomorrow(18), BIRTH_DATE_MESSAGES.tooYoung],
      ["2001-02-30", BIRTH_DATE_MESSAGES.invalid],
      ["15/05/1995", BIRTH_DATE_MESSAGES.invalid],
      [iso(new Date(Date.now() + 3 * 86_400_000)), BIRTH_DATE_MESSAGES.invalid],
    ];
    for (const [birthDate, message] of cases) {
      const input = { ...uniqueUser(), birthDate };
      const res = await client.post("/api/v1/auth/signup", input);
      assert.equal(res.status, 422, JSON.stringify([birthDate, res.body]));
      assert.equal(res.body.fields.birthDate, message, String(birthDate));
      assert.equal(await usersWithEmail(input.email), "0", "nothing is stored");
    }
  });

  it("accepts someone who turns 18 today and keeps the date without ever returning it", async () => {
    const newest = { ...uniqueUser(), birthDate: turnsToday(18) };
    const res = await client.post("/api/v1/auth/signup", newest);
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(await storedBirthDate(res.body.user.id), newest.birthDate);

    const input = uniqueUser();
    const created = await client.post("/api/v1/auth/signup", input);
    assert.equal(created.status, 201);
    const id = created.body.user.id as string;
    const auth = authHeader(created.body.tokens.accessToken);
    assert.equal(await storedBirthDate(id), ADULT_BIRTH_DATE);
    const viewer = authHeader(res.body.tokens.accessToken);
    const responses = [
      created.body,
      (await client.get("/api/v1/auth/me", auth)).body,
      (await client.get(`/api/v1/users/${input.username}`, auth)).body,
      (await client.get(`/api/v1/users/${input.username}`, viewer)).body,
      (await client.get(`/api/v1/search/users?q=${input.username}`, viewer)).body,
      (await client.patch("/api/v1/users/me", { bio: "hello", birthDate: "2015-01-01" }, auth)).body,
    ];
    for (const body of responses) {
      const text = JSON.stringify(body);
      assert.ok(text.length > 2, text);
      assert.ok(!text.includes(ADULT_BIRTH_DATE) && !/birth/i.test(text), text);
    }
    assert.equal(await storedBirthDate(id), ADULT_BIRTH_DATE, "a profile edit can't change it");
  });
});

describe("sign-up with Google (the same path as a phone number)", () => {
  async function pendingProof(): Promise<string> {
    const pending = await client.post("/api/v1/auth/google", { idToken: `verified-${randomUUID()}` });
    assert.equal(pending.body.onboardingRequired, true, JSON.stringify(pending.body));
    return pending.body.proof as string;
  }
  const finish = (proof: string, extra: Record<string, unknown> = {}) =>
    client.post("/api/v1/auth/provider/complete", { proof, username: `age_${randomUUID().slice(0, 8)}`, ...extra });

  it("needs a date of birth, and a mistake can be corrected with the same sign-in", async () => {
    const proof = await pendingProof();
    const missing = await finish(proof);
    assert.deepEqual([missing.status, missing.body.message], [422, BIRTH_DATE_MESSAGES.required]);
    const invalid = await finish(proof, { birthDate: "1995-02-30" });
    assert.deepEqual([invalid.status, invalid.body.message], [422, BIRTH_DATE_MESSAGES.invalid]);
    const done = await finish(proof, { birthDate: ADULT_BIRTH_DATE });
    assert.equal(done.status, 200, JSON.stringify(done.body));
    assert.equal(await storedBirthDate(done.body.user.id), ADULT_BIRTH_DATE);
    assert.ok(!/birth/i.test(JSON.stringify(done.body)) && !JSON.stringify(done.body).includes(ADULT_BIRTH_DATE));
  });

  it("turns away someone under 18 and forgets the verified sign-in at once", async () => {
    const proof = await pendingProof();
    assert.equal((await queryOne(`SELECT count(*) AS n FROM auth_provider_proofs WHERE token_hash = :'h'`, { h: proofHash(proof) }))?.n, "1");
    const young = await finish(proof, { birthDate: turnsTomorrow(18) });
    assert.deepEqual([young.status, young.body.message], [422, BIRTH_DATE_MESSAGES.tooYoung]);
    assert.equal((await queryOne(`SELECT count(*) AS n FROM auth_provider_proofs WHERE token_hash = :'h'`, { h: proofHash(proof) }))?.n, "0",
      "their Google email and name are deleted, not left to expire");
    const retry = await finish(proof, { birthDate: ADULT_BIRTH_DATE });
    assert.equal(retry.status, 401, "a different date needs a new sign-in");
  });

  it("asks nothing more of someone whose account already exists", async () => {
    const idToken = `verified-${randomUUID()}`;
    const first = await client.post("/api/v1/auth/google", { idToken });
    const created = await finish(first.body.proof, { birthDate: ADULT_BIRTH_DATE });
    assert.equal(created.status, 200);
    const again = await client.post("/api/v1/auth/google", { idToken });
    assert.equal(again.status, 200, JSON.stringify(again.body));
    assert.equal(again.body.user.id, created.body.user.id);
    assert.ok(again.body.tokens.accessToken);
  });
});

describe("reports", () => {
  it("take 'May be under 18' as a reason, ranked with the most serious", async () => {
    const reporter = await client.post("/api/v1/auth/signup", uniqueUser());
    const target = await client.post("/api/v1/auth/signup", uniqueUser());
    const res = await client.post("/api/v1/reports", { targetType: "user", targetId: target.body.user.id, reason: "under_18" },
      authHeader(reporter.body.tokens.accessToken));
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const row = await queryOne(`SELECT reason, priority FROM reports WHERE id = :'id'`, { id: res.body.report.id });
    assert.deepEqual([row?.reason, row?.priority], ["under_18", "2"]);
  });
});
