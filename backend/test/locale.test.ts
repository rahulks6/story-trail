import "./env";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { buildApp } from "../src/app";
import { authHeader, makeClient, uniqueUser } from "./helpers";
import { query } from "../src/db/psql";
import { renderPush } from "../src/modules/push/dispatcher";
import { emailProvider, MemoryEmailProvider } from "../src/modules/email/email";

// The account's language (users.locale, migration 0070) and the pushes and emails written in it.
let client: ReturnType<typeof makeClient>;
const server = buildApp();
const outbox = (emailProvider as MemoryEmailProvider).outbox;

before(async () => {
  await new Promise<void>((resolve) => server.listen(0, resolve));
  client = makeClient(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
});
after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

type User = { username: string; email: string; token: string; id: string };
async function signup(extra: Record<string, unknown> = {}): Promise<User> {
  const input = uniqueUser();
  const res = await client.post("/api/v1/auth/signup", { ...input, ...extra });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return { username: input.username, email: input.email, token: res.body.tokens.accessToken as string, id: res.body.user.id as string };
}
async function setLocale(user: User, locale: string) {
  return client.patch("/api/v1/users/me", { locale }, authHeader(user.token));
}
async function body(item: Parameters<typeof renderPush>[0]): Promise<string> {
  const rendered = await renderPush(item);
  assert.ok("message" in rendered, JSON.stringify(rendered));
  return rendered.message.body;
}

describe("the account's language", () => {
  it("is English until the app sends one, at sign-up or from Settings > Language", async () => {
    const plain = await signup();
    const me = await client.get("/api/v1/auth/me", authHeader(plain.token));
    assert.equal((me.body.user ?? me.body).locale, "en");
    const hindi = await signup({ locale: "hi" });
    const saved = await setLocale(hindi, "mr");
    assert.equal(saved.status, 200);
    assert.equal(saved.body.user.locale, "mr");
    // An unknown language is refused, and an unknown one at sign-up just leaves English.
    assert.equal((await setLocale(hindi, "fr")).status, 400);
    const french = await signup({ locale: "fr" });
    assert.equal((await query(`SELECT locale FROM users WHERE id = :'id'`, { id: french.id }))[0]?.locale, "en");
  });

  it("writes the first verification email in the language chosen at sign-up", async () => {
    const user = await signup({ locale: "hi" });
    const mail = outbox.find((m) => m.to === user.email && m.kind === "email_verification")!;
    assert.match(mail.subject, /^\d{6} आपका Katkee वेरिफ़िकेशन कोड है$/);
    assert.match(mail.text, /आपका Katkee वेरिफ़िकेशन कोड \d{6} है।/);
  });

  it("writes the password reset email in the account's language", async () => {
    const user = await signup();
    await setLocale(user, "mr");
    await client.post("/api/v1/auth/password/forgot", { email: user.email });
    const mail = [...outbox].reverse().find((m) => m.to === user.email && m.kind === "password_reset");
    assert.ok(mail, "reset email sent");
    assert.match(mail.subject, /हा तुमचा Katkee पासवर्ड रीसेट कोड आहे$/);
    assert.match(mail.text, /15 मिनिटांत एक्सपायर होईल/);
  });
});

describe("push text per locale", () => {
  it("someone's like, in English, Hindi and Marathi", async () => {
    const actor = await signup();
    const recipient = await signup();
    const item = { id: "l1", userId: recipient.id, kind: "like", actorId: actor.id, refId: null, attempts: 1 };
    assert.equal(await body(item), `@${actor.username} liked your Story`);
    await setLocale(recipient, "hi");
    assert.equal(await body(item), `@${actor.username} ने आपकी स्टोरी लाइक की`);
    await setLocale(recipient, "mr");
    assert.equal(await body(item), `@${actor.username} यांनी तुमची स्टोरी लाईक केली`);
  });

  it("push-only kinds are written from their values at send time", async () => {
    const recipient = await signup({ locale: "hi" });
    const item = (kind: string, params: Record<string, unknown> | null, bodyText = "English body") =>
      ({ id: kind, userId: recipient.id, kind, actorId: null, refId: null, attempts: 1, body: bodyText, link: "katkee://home", params });
    assert.equal(await body(item("story_milestone", { views: 100000 })), "आपकी स्टोरी 1,00,000 व्यूज़ तक पहुँच गई 🎉");
    assert.equal(await body(item("streak", { days: 5 })), "🔥 अपनी 5 दिन की स्ट्रीक जारी रखें: आज एक स्टोरी पोस्ट करें");
    assert.equal(await body(item("nudge", { variant: "first" })), "अपनी पहली स्टोरी शेयर करें: Katkee पर आपके दोस्त उसे देखेंगे 👋");
    assert.equal(await body(item("festival", { emoji: "🪔", greeting: "Happy Diwali", name: "Diwali" })), "🪔 Happy Diwali! Katkee पर अपनी Diwali स्टोरी शेयर करें");
    assert.equal(await body(item("verification", { outcome: "approved" })), "आप वेरिफ़ाइड हैं। आपका बैज अब आपकी प्रोफ़ाइल पर दिखता है।");
    assert.equal(await body(item("scheduled_story_failed", null)), "आपकी शेड्यूल की गई स्टोरी पोस्ट नहीं हो सकी। वजह जानने के लिए Katkee खोलें।");
    // Queued before migration 0070 (no values): the stored English is sent as it was.
    assert.equal(await body(item("story_milestone", null, "Your Story reached 100 views 🎉")), "Your Story reached 100 views 🎉");
  });

  it("the queues store those values", async () => {
    const owner = await signup({ locale: "mr" });
    await query(
      `INSERT INTO push_outbox (user_id, kind, body, link, params)
       VALUES (:'user', 'streak', 'English', 'katkee://home', jsonb_build_object('days', 3))`,
      { user: owner.id },
    );
    const [row] = await query(`SELECT params FROM push_outbox WHERE user_id = :'user' AND kind = 'streak'`, { user: owner.id });
    assert.deepEqual(JSON.parse(row!.params as string), { days: 3 });
    // claim_push_batch (SETOF push_outbox) hands the new column to the dispatcher too.
    const claimed = await query(`SELECT params FROM claim_push_batch(1000, 60) WHERE user_id = :'user'`, { user: owner.id });
    assert.deepEqual(JSON.parse(claimed[0]!.params as string), { days: 3 });
  });
});
