import "./env";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { buildApp } from "../src/app";
import { authHeader, uniqueUser } from "./helpers";
import { emailProvider, MemoryEmailProvider } from "../src/modules/email/email";
import { query } from "../src/db/psql";
import { generateKeyPairSync, sign, type JsonWebKey } from "node:crypto";
import { CI_AUDIENCE, checkCiToken, verifyCiAccount } from "../src/modules/auth/ci-verify";

const server = buildApp();
let base = "";
const outbox = (emailProvider as MemoryEmailProvider).outbox;

before(async () => {
  await new Promise<void>((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const r = await fetch(base + path, { method, headers: { "Content-Type": "application/json", ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const text = await r.text();
  return { status: r.status, body: text ? JSON.parse(text) : undefined };
}

async function signup() {
  const input = uniqueUser();
  const r = await call("POST", "/api/v1/auth/signup", input);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return { input, user: r.body.user, auth: authHeader(r.body.tokens.accessToken as string) };
}

const codes = (email: string) =>
  outbox.filter((m) => m.to === email && m.kind === "email_verification").map((m) => /\b(\d{6})\b/.exec(m.subject)?.[1] as string);
const wrongFor = (code: string) => (code === "000000" ? "111111" : "000000");

describe("email verification", () => {
  it("sends a code at sign-up; the right code verifies the email", async () => {
    const { input, user, auth } = await signup();
    assert.equal(user.emailVerified, false);
    assert.equal(user.emailVerificationRequired, true, "a new account must verify before using Katkee");
    const [code] = codes(input.email);
    assert.ok(code, "a verification code was emailed at sign-up");

    const wrong = await call("POST", "/api/v1/auth/email/verify", { code: wrongFor(code) }, auth);
    assert.equal(wrong.status, 400);
    const ok = await call("POST", "/api/v1/auth/email/verify", { code }, auth);
    assert.equal(ok.status, 200);
    assert.equal(ok.body.user.emailVerified, true);
    assert.equal(ok.body.user.emailVerificationRequired, false);
    assert.equal((await call("GET", "/api/v1/auth/me", undefined, auth)).body.user.emailVerified, true);

    // Already verified: no more codes are sent.
    assert.equal((await call("POST", "/api/v1/auth/email/send-code", undefined, auth)).status, 204);
    assert.equal(codes(input.email).length, 1);
  });

  it("only the newest code works, and 5 wrong guesses use it up", async () => {
    const { input, auth } = await signup();
    const [first] = codes(input.email);
    assert.equal((await call("POST", "/api/v1/auth/email/send-code", undefined, auth)).status, 204);
    const second = codes(input.email)[1]!;
    if (first !== second) {
      assert.equal((await call("POST", "/api/v1/auth/email/verify", { code: first }, auth)).status, 400, "a resent code replaces the old one");
    }
    for (let i = 0; i < 5; i++) {
      assert.equal((await call("POST", "/api/v1/auth/email/verify", { code: wrongFor(second) }, auth)).status, 400);
    }
    assert.equal((await call("POST", "/api/v1/auth/email/verify", { code: second }, auth)).status, 400, "used up after 5 wrong guesses");
  });

  it("limits how many codes are emailed, and needs a signed-in account", async () => {
    const { auth } = await signup();
    const sends = [];
    for (let i = 0; i < 5; i++) sends.push((await call("POST", "/api/v1/auth/email/send-code", undefined, auth)).status);
    assert.ok(sends.slice(0, 4).every((s) => s === 204));
    assert.equal(sends[4], 429, "at most 5 codes an hour, counting the sign-up one");
    assert.equal((await call("POST", "/api/v1/auth/email/send-code")).status, 401);
    assert.equal((await call("POST", "/api/v1/auth/email/verify", { code: "123456" })).status, 401);
    assert.equal((await call("POST", "/api/v1/auth/email/verify", { code: "12ab" }, auth)).status, 422);
  });

  it("a code sent to an old address doesn't verify a changed email", async () => {
    const { input, user, auth } = await signup();
    const [code] = codes(input.email);
    await query(`UPDATE users SET email = :'email' WHERE id = :'id'`, { id: user.id, email: `changed-${input.email}` });
    assert.equal((await call("POST", "/api/v1/auth/email/verify", { code }, auth)).status, 400);
  });

  it("a completed password reset verifies the email", async () => {
    const { input } = await signup();
    await call("POST", "/api/v1/auth/password/forgot", { email: input.email });
    const reset = [...outbox].reverse().find((m) => m.to === input.email && m.kind === "password_reset")!;
    const code = /\b(\d{6})\b/.exec(reset.subject)![1];
    const r = await call("POST", "/api/v1/auth/password/reset", { email: input.email, code, newPassword: "a brand new passphrase" });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.user.emailVerified, true);
  });

  it("accounts from before verification was required aren't asked for it", async () => {
    const { user, auth } = await signup();
    await query(`UPDATE users SET email_verification_required = false WHERE id = :'id'`, { id: user.id });
    const me = (await call("GET", "/api/v1/auth/me", undefined, auth)).body.user;
    assert.equal(me.emailVerified, false);
    assert.equal(me.emailVerificationRequired, false);
  });

  it("a mistyped email can be changed until it's verified, and the code goes to the new one", async () => {
    const { input, auth } = await signup();
    const other = await signup();
    assert.equal((await call("POST", "/api/v1/auth/email/change", { email: other.input.email }, auth)).status, 409, "someone else's email");
    assert.equal((await call("POST", "/api/v1/auth/email/change", { email: "not-an-email" }, auth)).status, 422);
    const fixed = `fixed-${input.email}`;
    const changed = await call("POST", "/api/v1/auth/email/change", { email: fixed.toUpperCase() }, auth);
    assert.equal(changed.status, 200, JSON.stringify(changed.body));
    assert.equal(changed.body.user.email, fixed);
    const [code] = codes(fixed);
    assert.ok(code, "a code went to the new address");
    assert.equal((await call("POST", "/api/v1/auth/email/verify", { code }, auth)).status, 200);
    assert.equal((await call("POST", "/api/v1/auth/email/change", { email: `again-${input.email}` }, auth)).status, 409, "verified: changed with the password instead");
    assert.equal((await call("POST", "/api/v1/auth/email/change", { email: fixed })).status, 401);
  });

  describe("walk-through accounts (GitHub OIDC)", () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const jwk = { ...(publicKey.export({ format: "jwk" }) as JsonWebKey), kid: "test-key" };
    const lookup = async (kid: string) => (kid === "test-key" ? jwk : null);
    const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
    const token = (claims: Record<string, unknown>, kid = "test-key") => {
      const head = `${b64({ alg: "RS256", kid })}.${b64({
        iss: "https://token.actions.githubusercontent.com",
        aud: CI_AUDIENCE,
        repository: "rahulks6/story-trail",
        exp: Math.floor(Date.now() / 1000) + 300,
        ...claims,
      })}`;
      return `${head}.${sign("RSA-SHA256", Buffer.from(head), privateKey).toString("base64url")}`;
    };

    it("accepts only a current token for this repository and audience", async () => {
      await checkCiToken(token({}), lookup);
      for (const bad of [
        token({ repository: "someone/else" }),
        token({ aud: "other" }),
        token({ iss: "https://example.com" }),
        token({ exp: Math.floor(Date.now() / 1000) - 10 }),
        token({}, "unknown-key"),
        token({}).replace(/\.[^.]+$/, ".AAAA"),
        "not.a.token",
      ]) {
        await assert.rejects(checkCiToken(bad, lookup), (e: { status?: number }) => e.status === 403);
      }
    });

    it("verifies only new throwaway support+e2e accounts", async () => {
      const ci = uniqueUser();
      const ciEmail = `support+e2e-${ci.username.replace(/_/g, "-")}@katkee.com`;
      const r = await call("POST", "/api/v1/auth/signup", { ...ci, email: ciEmail });
      assert.equal(r.status, 201, JSON.stringify(r.body));
      await verifyCiAccount(r.body.user.id, token({}), lookup);
      const me = (await call("GET", "/api/v1/auth/me", undefined, authHeader(r.body.tokens.accessToken))).body.user;
      assert.equal(me.emailVerificationRequired, false);

      const { user } = await signup();
      await assert.rejects(verifyCiAccount(user.id, token({}), lookup), (e: { status?: number }) => e.status === 403);
    });

    it("the route refuses a malformed token", async () => {
      const { auth } = await signup();
      assert.equal((await call("POST", "/api/v1/auth/email/ci-verify", { token: "not.a.token" }, auth)).status, 403);
      assert.equal((await call("POST", "/api/v1/auth/email/ci-verify", { token: 5 }, auth)).status, 403);
    });
  });
});
