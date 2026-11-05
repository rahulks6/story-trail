// A Story's picture description: optional, trimmed, at most 500 characters, and given back with
// the Story so a screen reader can read it.
import "./env";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { buildApp } from "../src/app";
import { buildTestPng } from "./fixtures";
import { authHeader, makeClient, uniqueUser } from "./helpers";

const server = buildApp();
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

async function person() {
  const input = uniqueUser();
  const res = await client.post("/api/v1/auth/signup", input);
  return { username: input.username, auth: authHeader(res.body.tokens.accessToken as string) };
}
async function post(who: { auth: Record<string, string> }, extra: Record<string, unknown>) {
  const up = await fetch(`${baseUrl}/api/v1/media/photos`, { method: "POST", headers: { "Content-Type": "image/png", ...who.auth }, body: buildTestPng(4, 4) });
  const mediaId = ((await up.json()) as { media: { id: string } }).media.id;
  return client.post("/api/v1/stories", { mediaId, caption: "", audience: "public", allowComments: "everyone", allowSharing: true, ...extra }, who.auth);
}

describe("a Story's picture description", () => {
  it("is kept, trimmed, and given back to viewers", async () => {
    const me = await person();
    const viewer = await person();
    const res = await post(me, { altText: "  A cup of chai on a rainy window sill  " });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.story.altText, "A cup of chai on a rainy window sill");
    const seen = await client.get(`/api/v1/stories/${res.body.story.id}`, viewer.auth);
    assert.equal(seen.body.story.altText, "A cup of chai on a rainy window sill");
    const list = await client.get(`/api/v1/users/${me.username}/stories`, viewer.auth);
    assert.equal(list.body.stories[0].altText, "A cup of chai on a rainy window sill");
  });

  it("is optional, and refused when too long", async () => {
    const me = await person();
    assert.equal((await post(me, {})).body.story.altText, null);
    assert.equal((await post(me, { altText: "   " })).body.story.altText, null, "blank is none");
    const long = await post(me, { altText: "x".repeat(501) });
    assert.equal(long.status, 422);
    assert.ok(long.body.fields.altText);
  });
});
