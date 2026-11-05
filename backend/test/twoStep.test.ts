// Two-step login: turned on with an authenticator app after "Confirm it's you"; then every way
// in (password, password reset) asks for a code, each code works once, and backup codes help once.
import "./mfa-env";
import "./env";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { buildApp } from "../src/app";
import { totp } from "../src/modules/admin/totp";
import { emailProvider, MemoryEmailProvider } from "../src/modules/email/email";
import { authHeader, makeClient, uniqueUser } from "./helpers";

const server = buildApp();
let client: ReturnType<typeof makeClient>;
before(async () => {
  await new Promise<void>((resolve) => server.listen(0, resolve));
  client = makeClient(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
});
after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const STEP = 30_000;
async function account() {
  const input = uniqueUser();
  const res = await client.post("/api/v1/auth/signup", input);
  return { input, auth: authHeader(res.body.tokens.accessToken as string) };
}
async function ticket(who: { input: { password: string }; auth: Record<string, string> }): Promise<string> {
  const res = await client.post("/api/v1/auth/reauthenticate", { password: who.input.password }, who.auth);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body.reauthTicket as string;
}
async function turnOn(who: Awaited<ReturnType<typeof account>>): Promise<{ secret: string; backupCodes: string[] }> {
  const t = await ticket(who);
  const setup = await client.post("/api/v1/auth/two-step/setup", { reauthTicket: t }, who.auth);
  assert.equal(setup.status, 200, JSON.stringify(setup.body));
  assert.match(setup.body.otpauthUrl, /^otpauth:\/\/totp\/.+issuer=Katkee/);
  assert.ok(setup.body.qrRows.length > 20, "a QR code to scan");
  const on = await client.post("/api/v1/auth/two-step/enable", { reauthTicket: t, code: totp(setup.body.secret) }, who.auth);
  assert.equal(on.status, 200, JSON.stringify(on.body));
  return { secret: setup.body.secret, backupCodes: on.body.backupCodes };
}

describe("two-step login", () => {
  it("is off until set up, and setting up needs 'Confirm it's you' and a right first code", async () => {
    const who = await account();
    assert.deepEqual((await client.get("/api/v1/auth/two-step", who.auth)).body, { enabled: false, backupCodesLeft: 0 });
    assert.equal((await client.post("/api/v1/auth/two-step/setup", {}, who.auth)).status, 401, "no ticket");
    const t = await ticket(who);
    await client.post("/api/v1/auth/two-step/setup", { reauthTicket: t }, who.auth);
    assert.equal((await client.post("/api/v1/auth/two-step/enable", { reauthTicket: t, code: "000000" }, who.auth)).status, 422);
    assert.equal((await client.post("/api/v1/auth/login", { email: who.input.email, password: who.input.password })).body.tokens !== undefined, true, "still off");
  });

  it("asks for a code after the password; a wrong one fails, a right one signs in, and each code works once", async () => {
    const who = await account();
    const { secret, backupCodes } = await turnOn(who);
    assert.equal(backupCodes.length, 10);
    assert.deepEqual((await client.get("/api/v1/auth/two-step", who.auth)).body, { enabled: true, backupCodesLeft: 10 });

    const first = await client.post("/api/v1/auth/login", { email: who.input.email, password: who.input.password });
    assert.equal(first.status, 200);
    assert.equal(first.body.tokens, undefined, "no tokens before the code");
    assert.equal(first.body.twoStepRequired, true);
    assert.equal((await client.post("/api/v1/auth/two-step/verify", { challenge: first.body.challenge, code: "123456" })).status, 401);
    const code = totp(secret, Date.now() + STEP);
    const ok = await client.post("/api/v1/auth/two-step/verify", { challenge: first.body.challenge, code });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.ok(ok.body.tokens.accessToken);
    assert.equal((await client.post("/api/v1/auth/two-step/verify", { challenge: first.body.challenge, code })).status, 401, "a challenge is used once");

    const second = await client.post("/api/v1/auth/login", { email: who.input.email, password: who.input.password });
    assert.equal((await client.post("/api/v1/auth/two-step/verify", { challenge: second.body.challenge, code })).status, 401, "the same code never twice");
    const backup = await client.post("/api/v1/auth/two-step/verify", { challenge: second.body.challenge, code: backupCodes[0]!.toLowerCase() });
    assert.equal(backup.status, 200, "a backup code, in any case");
    const third = await client.post("/api/v1/auth/login", { email: who.input.email, password: who.input.password });
    assert.equal((await client.post("/api/v1/auth/two-step/verify", { challenge: third.body.challenge, code: backupCodes[0] })).status, 401, "a backup code works once");
  });

  it("gives up after five wrong codes", async () => {
    const who = await account();
    const { secret } = await turnOn(who);
    const login = await client.post("/api/v1/auth/login", { email: who.input.email, password: who.input.password });
    for (let i = 0; i < 5; i++) await client.post("/api/v1/auth/two-step/verify", { challenge: login.body.challenge, code: "000000" });
    assert.equal((await client.post("/api/v1/auth/two-step/verify", { challenge: login.body.challenge, code: totp(secret, Date.now() + STEP) })).status, 401);
  });

  it("is still asked after a password reset, and turning it off needs a ticket and a code", async () => {
    const who = await account();
    const { secret, backupCodes } = await turnOn(who);
    await client.post("/api/v1/auth/password/forgot", { email: who.input.email });
    const message = [...(emailProvider as MemoryEmailProvider).outbox].reverse().find((m) => m.to === who.input.email && m.kind === "password_reset")!;
    const resetCode = /\b(\d{6})\b/.exec(message.subject)![1];
    const reset = await client.post("/api/v1/auth/password/reset", { email: who.input.email, code: resetCode, newPassword: "another long passphrase" });
    assert.equal(reset.status, 200, JSON.stringify(reset.body));
    assert.equal(reset.body.tokens, undefined, "email access alone isn't enough");
    const signedIn = await client.post("/api/v1/auth/two-step/verify", { challenge: reset.body.challenge, code: totp(secret, Date.now() + STEP) });
    assert.equal(signedIn.status, 200);
    const auth = authHeader(signedIn.body.tokens.accessToken);
    const t = (await client.post("/api/v1/auth/reauthenticate", { password: "another long passphrase" }, auth)).body.reauthTicket;
    assert.equal((await client.post("/api/v1/auth/two-step/disable", { reauthTicket: t, code: "000000" }, auth)).status, 422);
    assert.equal((await client.post("/api/v1/auth/two-step/disable", { reauthTicket: t, code: totp(secret, Date.now() - STEP) }, auth)).status, 422, "an older code than one already used");
    // A backup code does too (the newest app code was just used to sign in).
    assert.equal((await client.post("/api/v1/auth/two-step/disable", { reauthTicket: t, code: backupCodes[3] }, auth)).status, 204);
    assert.deepEqual((await client.get("/api/v1/auth/two-step", auth)).body, { enabled: false, backupCodesLeft: 0 });
    const plain = await client.post("/api/v1/auth/login", { email: who.input.email, password: "another long passphrase" });
    assert.ok(plain.body.tokens.accessToken, "off: the password is enough again");
  });
});
