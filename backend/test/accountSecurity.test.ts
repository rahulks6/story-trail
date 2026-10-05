// Tight per-network budgets for this file only (each test file runs in its own process).
process.env.RATE_LIMIT_RESET_REQUESTS_PER_HOUR = "12";

import "./env";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { buildApp } from "../src/app";
import { authHeader, uniqueUser } from "./helpers";
import { emailProvider, MemoryEmailProvider } from "../src/modules/email/email";
import { query, queryOne } from "../src/db/psql";

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

const device = (name: string) => ({ "User-Agent": `KatkeeTest/${name} (Test OS ${name})` });

async function signup(agent = "phone-a") {
  const input = uniqueUser();
  const r = await call("POST", "/api/v1/auth/signup", input, device(agent));
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return { input, id: r.body.user.id as string, tokens: r.body.tokens as { accessToken: string; refreshToken: string } };
}

function lastCodeFor(email: string): string {
  const message = [...outbox].reverse().find((m) => m.to === email && m.kind === "password_reset");
  assert.ok(message, "a reset email was sent");
  const code = /\b(\d{6})\b/.exec(message.subject)?.[1];
  assert.ok(code);
  assert.ok(message.text.includes(`code=${code}`), "the email carries a deep link with the code");
  return code;
}

describe("password reset", () => {
  it("never reveals whether an account exists", async () => {
    const before = outbox.length;
    const unknown = await call("POST", "/api/v1/auth/password/forgot", { email: "nobody-here@example.com" });
    const user = await signup();
    const known = await call("POST", "/api/v1/auth/password/forgot", { email: user.input.email });
    assert.equal(unknown.status, 202);
    assert.equal(known.status, 202);
    assert.deepEqual(unknown.body, known.body);
    assert.equal(outbox.length, before + 1, "only the real account received an email");
  });

  it("resets with the emailed code, ends every old session and signs this device in", async () => {
    const user = await signup();
    await call("POST", "/api/v1/auth/password/forgot", { email: user.input.email });
    const code = lastCodeFor(user.input.email);
    const reset = await call("POST", "/api/v1/auth/password/reset", { email: user.input.email, code, newPassword: "a brand new passphrase" }, device("phone-b"));
    assert.equal(reset.status, 200, JSON.stringify(reset.body));
    assert.ok(reset.body.tokens.accessToken);

    assert.equal((await call("GET", "/api/v1/auth/me", undefined, authHeader(user.tokens.accessToken))).status, 401, "old access token stops immediately");
    assert.equal((await call("POST", "/api/v1/auth/refresh", { refreshToken: user.tokens.refreshToken })).status, 401, "old refresh token is revoked");
    assert.equal((await call("GET", "/api/v1/auth/me", undefined, authHeader(reset.body.tokens.accessToken))).status, 200);
    assert.equal((await call("POST", "/api/v1/auth/login", { email: user.input.email, password: user.input.password })).status, 401);
    assert.equal((await call("POST", "/api/v1/auth/login", { email: user.input.email, password: "a brand new passphrase" })).status, 200);

    const again = await call("POST", "/api/v1/auth/password/reset", { email: user.input.email, code, newPassword: "yet another passphrase" });
    assert.equal(again.status, 400, "a code works once");
  });

  it("allows 5 wrong guesses, then kills the request even for the right code", async () => {
    const user = await signup();
    await call("POST", "/api/v1/auth/password/forgot", { email: user.input.email });
    const code = lastCodeFor(user.input.email);
    const wrong = code === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i++) {
      assert.equal((await call("POST", "/api/v1/auth/password/reset", { email: user.input.email, code: wrong, newPassword: "a brand new passphrase" })).status, 400);
    }
    const right = await call("POST", "/api/v1/auth/password/reset", { email: user.input.email, code, newPassword: "a brand new passphrase" });
    assert.equal(right.status, 400, "the request is dead after 5 failures");
  });

  it("only the newest code is valid and expired codes fail", async () => {
    const user = await signup();
    await call("POST", "/api/v1/auth/password/forgot", { email: user.input.email });
    const first = lastCodeFor(user.input.email);
    await call("POST", "/api/v1/auth/password/forgot", { email: user.input.email });
    const second = lastCodeFor(user.input.email);
    if (first !== second) {
      assert.equal((await call("POST", "/api/v1/auth/password/reset", { email: user.input.email, code: first, newPassword: "a brand new passphrase" })).status, 400);
    }
    await query(`UPDATE password_reset_requests SET expires_at = now() - interval '1 second' WHERE user_id = :'id'`, { id: user.id });
    assert.equal((await call("POST", "/api/v1/auth/password/reset", { email: user.input.email, code: second, newPassword: "a brand new passphrase" })).status, 400);
  });

  it("rejects weak and common passwords and a malformed code with field errors", async () => {
    const r = await call("POST", "/api/v1/auth/password/reset", { email: "someone@example.com", code: "12ab", newPassword: "password123" });
    assert.equal(r.status, 422);
    assert.ok(r.body.fields.code);
    assert.ok(r.body.fields.newPassword);
    const signupCommon = await call("POST", "/api/v1/auth/signup", { ...uniqueUser(), password: "12345678" });
    assert.equal(signupCommon.status, 422);
  });

  it("caps reset emails per account and requests per network", async () => {
    const user = await signup();
    const before = outbox.filter((m) => m.to === user.input.email).length;
    for (let i = 0; i < 4; i++) await call("POST", "/api/v1/auth/password/forgot", { email: user.input.email });
    const sent = outbox.filter((m) => m.to === user.input.email).length - before;
    assert.equal(sent, 3, "at most 3 reset emails per account per hour");
    // This file allows 12 requests per network per hour; earlier tests used 10 of them.
    let limited = false;
    for (let i = 0; i < 6 && !limited; i++) limited = (await call("POST", "/api/v1/auth/password/forgot", { email: user.input.email })).status === 429;
    assert.ok(limited, "the per-network request budget is enforced");
  });
});

describe("password change", () => {
  it("requires the current password, rejects reuse, and ends other sessions", async () => {
    const user = await signup("phone-a");
    const other = await call("POST", "/api/v1/auth/login", { email: user.input.email, password: user.input.password }, device("tablet"));
    const auth = authHeader(user.tokens.accessToken);
    assert.equal((await call("POST", "/api/v1/auth/password/change", { currentPassword: "not my password", newPassword: "a brand new passphrase" }, auth)).status, 401);
    assert.equal((await call("POST", "/api/v1/auth/password/change", { currentPassword: user.input.password, newPassword: user.input.password }, auth)).status, 422);
    const changed = await call("POST", "/api/v1/auth/password/change", { currentPassword: user.input.password, newPassword: "a brand new passphrase" }, auth);
    assert.equal(changed.status, 200);
    assert.equal((await call("GET", "/api/v1/auth/me", undefined, authHeader(other.body.tokens.accessToken))).status, 401, "the other device is signed out");
    assert.equal((await call("GET", "/api/v1/auth/me", undefined, authHeader(changed.body.tokens.accessToken))).status, 200, "this device keeps working");
  });
});

describe("sessions", () => {
  it("lists sign-ins, ends one immediately, and never touches another user's sessions", async () => {
    const user = await signup("phone-a");
    const tablet = await call("POST", "/api/v1/auth/login", { email: user.input.email, password: user.input.password }, device("tablet"));
    const list = await call("GET", "/api/v1/auth/sessions", undefined, authHeader(user.tokens.accessToken));
    assert.equal(list.status, 200);
    assert.equal(list.body.sessions.length, 2);
    const current = list.body.sessions.find((s: any) => s.current);
    const tabletSession = list.body.sessions.find((s: any) => !s.current);
    assert.ok(current && tabletSession);
    assert.match(tabletSession.userAgent, /tablet/);

    const stranger = await signup();
    assert.equal((await call("DELETE", `/api/v1/auth/sessions/${tabletSession.id}`, undefined, authHeader(stranger.tokens.accessToken))).status, 404, "IDOR: can't end someone else's session");
    assert.equal((await call("GET", "/api/v1/auth/me", undefined, authHeader(tablet.body.tokens.accessToken))).status, 200);

    assert.equal((await call("DELETE", `/api/v1/auth/sessions/${tabletSession.id}`, undefined, authHeader(user.tokens.accessToken))).status, 204);
    assert.equal((await call("GET", "/api/v1/auth/me", undefined, authHeader(tablet.body.tokens.accessToken))).status, 401, "access token ends with its session");
    assert.equal((await call("POST", "/api/v1/auth/refresh", { refreshToken: tablet.body.tokens.refreshToken })).status, 401);
    assert.equal((await call("GET", "/api/v1/auth/me", undefined, authHeader(user.tokens.accessToken))).status, 200);
  });

  it("refresh rotation keeps the same session and its token keeps working", async () => {
    const user = await signup();
    const refreshed = await call("POST", "/api/v1/auth/refresh", { refreshToken: user.tokens.refreshToken });
    assert.equal(refreshed.status, 200);
    const list = await call("GET", "/api/v1/auth/sessions", undefined, authHeader(refreshed.body.tokens.accessToken));
    assert.equal(list.body.sessions.length, 1);
    assert.equal(list.body.sessions[0].current, true);
    assert.equal((await call("GET", "/api/v1/auth/me", undefined, authHeader(user.tokens.accessToken))).status, 200, "the pre-rotation access token stays valid until expiry");
  });

  it("sign out of other devices keeps only this one", async () => {
    const user = await signup("phone-a");
    const a = await call("POST", "/api/v1/auth/login", { email: user.input.email, password: user.input.password }, device("laptop"));
    const b = await call("POST", "/api/v1/auth/login", { email: user.input.email, password: user.input.password }, device("tablet"));
    const r = await call("POST", "/api/v1/auth/sessions/revoke-others", {}, authHeader(user.tokens.accessToken));
    assert.equal(r.status, 200);
    assert.equal(r.body.ended, 2);
    for (const other of [a, b]) assert.equal((await call("GET", "/api/v1/auth/me", undefined, authHeader(other.body.tokens.accessToken))).status, 401);
    assert.equal((await call("GET", "/api/v1/auth/me", undefined, authHeader(user.tokens.accessToken))).status, 200);
  });

  it("logout ends the access token too", async () => {
    const user = await signup();
    assert.equal((await call("POST", "/api/v1/auth/logout", { refreshToken: user.tokens.refreshToken })).status, 204);
    assert.equal((await call("GET", "/api/v1/auth/me", undefined, authHeader(user.tokens.accessToken))).status, 401);
  });
});

describe("brute force and suspicious sign-in", () => {
  it("locks one account after 10 wrong passwords without affecting others", async () => {
    const victim = await signup(), bystander = await signup();
    for (let i = 0; i < 10; i++) {
      assert.equal((await call("POST", "/api/v1/auth/login", { email: victim.input.email, password: `wrong-guess-${i}` })).status, 401);
    }
    const locked = await call("POST", "/api/v1/auth/login", { email: victim.input.email, password: victim.input.password });
    assert.equal(locked.status, 429, "even the right password waits out the lock");
    assert.equal((await call("POST", "/api/v1/auth/login", { email: bystander.input.email, password: bystander.input.password })).status, 200);
    const events = await call("GET", "/api/v1/auth/security-events", undefined, authHeader(victim.tokens.accessToken));
    assert.ok(events.body.events.some((e: any) => e.kind === "login_locked"));
  });

  it("alerts by email on a sign-in from a new device, once", async () => {
    const user = await signup("phone-a");
    const before = outbox.filter((m) => m.to === user.input.email && m.kind === "new_device_login").length;
    assert.equal((await call("POST", "/api/v1/auth/login", { email: user.input.email, password: user.input.password }, device("phone-a"))).status, 200);
    assert.equal((await call("POST", "/api/v1/auth/login", { email: user.input.email, password: user.input.password }, device("unknown-laptop"))).status, 200);
    assert.equal((await call("POST", "/api/v1/auth/login", { email: user.input.email, password: user.input.password }, device("unknown-laptop"))).status, 200);
    const alerts = outbox.filter((m) => m.to === user.input.email && m.kind === "new_device_login").length - before;
    assert.equal(alerts, 1);
    const events = await call("GET", "/api/v1/auth/security-events", undefined, authHeader(user.tokens.accessToken));
    assert.equal(events.body.events.filter((e: any) => e.kind === "login_new_device").length, 1);
    const stored = await queryOne(`SELECT count(*) AS n FROM auth_security_events WHERE user_id = :'id' AND device_hash ~ '^[0-9a-f]{64}$'`, { id: user.id });
    assert.ok(Number(stored?.n) > 0, "devices are stored as keyed hashes, never raw IPs");
  });
});
