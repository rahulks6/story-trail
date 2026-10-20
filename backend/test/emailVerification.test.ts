import "./env";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { buildApp } from "../src/app";
import { authHeader, uniqueUser } from "./helpers";
import { emailProvider, MemoryEmailProvider } from "../src/modules/email/email";
import { query } from "../src/db/psql";

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
    const [code] = codes(input.email);
    assert.ok(code, "a verification code was emailed at sign-up");

    const wrong = await call("POST", "/api/v1/auth/email/verify", { code: wrongFor(code) }, auth);
    assert.equal(wrong.status, 400);
    const ok = await call("POST", "/api/v1/auth/email/verify", { code }, auth);
    assert.equal(ok.status, 200);
    assert.equal(ok.body.user.emailVerified, true);
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
});
