import "./env";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { buildApp } from "../src/app";
import { query, queryOne } from "../src/db/psql";
import { renderPush } from "../src/modules/push/dispatcher";
import { authHeader, makeClient, uniqueUser } from "./helpers";
import { buildTestPng } from "./fixtures";

// Polls, quizzes, questions, countdowns, link stickers and "Add Yours" chains, end to end.
let client: ReturnType<typeof makeClient>;
let baseUrl: string;
const server = buildApp();

before(async () => {
  await new Promise<void>((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  client = makeClient(baseUrl);
});
after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

type User = { username: string; token: string; id: string };
async function signup(options: { ageDays?: number } = {}): Promise<User> {
  const input = uniqueUser();
  const res = await client.post("/api/v1/auth/signup", input);
  const user = { username: input.username, token: res.body.tokens.accessToken as string, id: res.body.user.id as string };
  // Links are for accounts older than a day (safety/links.ts).
  if (options.ageDays) await query(`UPDATE users SET created_at = now() - make_interval(days => :'d'::integer) WHERE id = :'id'`, { d: options.ageDays, id: user.id });
  return user;
}
async function upload(owner: User): Promise<string> {
  const res = await fetch(`${baseUrl}/api/v1/media/photos`, { method: "POST", headers: { "Content-Type": "image/png", ...authHeader(owner.token) }, body: buildTestPng(4, 4) });
  return ((await res.json()) as { media: { id: string } }).media.id;
}
const at = { x: 0.5, y: 0.5, scale: 1, rotation: 0, zIndex: 1 };
const poll = { id: "poll-1", type: "poll", ...at, properties: { question: "Tea or coffee?", options: ["Tea", "Coffee"] } };
const quiz = { id: "quiz-1", type: "quiz", ...at, properties: { question: "Capital of India?", options: ["Mumbai", "New Delhi", "Kolkata"], correctIndex: 1 } };
const question = { id: "q-1", type: "question", ...at, properties: { prompt: "Ask me anything" } };
const inOneHour = () => new Date(Date.now() + 3600_000).toISOString();
const countdown = () => ({ id: "cd-1", type: "countdown", ...at, properties: { title: "Launch", endsAt: inOneHour() } });

async function publish(owner: User, overlays: unknown[], extra: Record<string, unknown> = {}): Promise<{ status: number; body: any }> {
  const mediaId = await upload(owner);
  return client.post("/api/v1/stories", { mediaId, caption: "", audience: "public", allowComments: "everyone", allowSharing: true, overlays, ...extra }, authHeader(owner.token));
}
async function publishOk(owner: User, overlays: unknown[], extra: Record<string, unknown> = {}): Promise<string> {
  const res = await publish(owner, overlays, extra);
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.story.id as string;
}
const sticker = async (storyId: string, viewer: User, id: string) =>
  ((await client.get(`/api/v1/stories/${storyId}`, authHeader(viewer.token))).body.story.overlays as any[]).find((o) => o.id === id);
const vote = (storyId: string, viewer: User, stickerId: string, option: number) =>
  client.post(`/api/v1/stories/${storyId}/stickers/${stickerId}/vote`, { option }, authHeader(viewer.token));

describe("publishing interactive stickers", () => {
  it("keeps only what the creator chose, validated, and one of each kind", async () => {
    const owner = await signup();
    const story = await publishOk(owner, [
      { ...poll, properties: { ...poll.properties, results: { counts: [99, 0], total: 99, viewerChoice: 0 } } },
      { ...poll, id: "poll-2" },
      { id: "bad-poll", type: "quiz", ...at, properties: { question: "Only one?", options: ["Yes"], correctIndex: 0 } },
      { id: "bad-quiz", type: "quiz", ...at, properties: { question: "Which?", options: ["A", "B"], correctIndex: 5 } },
      { id: "old-cd", type: "countdown", ...at, properties: { title: "Past", endsAt: new Date(Date.now() - 1000).toISOString() } },
      { id: "q", type: "question", ...at, properties: { prompt: "" } },
    ]);
    const overlays = (await client.get(`/api/v1/stories/${story}`, authHeader(owner.token))).body.story.overlays as any[];
    assert.deepEqual(overlays.map((o) => o.id), ["poll-1", "q"], "a second poll, a broken quiz and an ended countdown are dropped");
    assert.deepEqual(overlays[0].properties.results, { counts: [0, 0], total: 0, viewerChoice: null }, "results come from votes, never from the request");
    assert.equal(overlays[1].properties.prompt, "Ask me anything", "an empty question gets the usual prompt");
  });
});

describe("polls", () => {
  it("one vote per viewer; results appear after voting; the owner sees who voted", async () => {
    const owner = await signup();
    const a = await signup();
    const b = await signup();
    const story = await publishOk(owner, [poll]);

    const before = await sticker(story, a, "poll-1");
    assert.equal(before.properties.results, null, "no results before you vote");

    const first = await vote(story, a, "poll-1", 1);
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.deepEqual(first.body.results, { counts: [0, 1], total: 1, viewerChoice: 1 });
    assert.equal((await vote(story, a, "poll-1", 1)).status, 200, "the same answer again is harmless");
    assert.equal((await vote(story, a, "poll-1", 0)).status, 409, "but it can't be changed");
    assert.equal((await vote(story, b, "poll-1", 0)).body.results.total, 2);
    assert.equal((await vote(story, b, "poll-1", 3)).status, 422, "only the sticker's own options");
    assert.equal((await vote(story, b, "nope", 0)).status, 404);
    assert.equal((await vote(story, owner, "poll-1", 0)).status, 403, "not on your own Story");

    assert.deepEqual((await sticker(story, a, "poll-1")).properties.results, { counts: [1, 1], total: 2, viewerChoice: 1 });
    assert.deepEqual((await sticker(story, owner, "poll-1")).properties.results, { counts: [1, 1], total: 2, viewerChoice: null });

    const voters = await client.get(`/api/v1/stories/${story}/stickers/poll-1/responses`, authHeader(owner.token));
    assert.equal(voters.status, 200);
    assert.deepEqual(voters.body.voters.map((v: { username: string; option: number }) => [v.username, v.option]).sort(), [[a.username, 1], [b.username, 0]].sort());
    assert.equal((await client.get(`/api/v1/stories/${story}/stickers/poll-1/responses`, authHeader(a.token))).status, 404, "who voted is the owner's alone");
  });

  it("can't be answered on an expired, deleted, blocked or private Story", async () => {
    const owner = await signup();
    const viewer = await signup();
    const expired = await publishOk(owner, [poll]);
    await query(`UPDATE stories SET expires_at = now() - interval '1 minute' WHERE id = :'id'`, { id: expired });
    assert.equal((await vote(expired, viewer, "poll-1", 0)).status, 404);

    const deleted = await publishOk(owner, [poll]);
    await client.delete(`/api/v1/stories/${deleted}`, authHeader(owner.token));
    assert.equal((await vote(deleted, viewer, "poll-1", 0)).status, 404);

    const blocked = await publishOk(owner, [poll]);
    await client.post(`/api/v1/users/${viewer.username}/block`, undefined, authHeader(owner.token));
    assert.equal((await vote(blocked, viewer, "poll-1", 0)).status, 404);

    const other = await signup();
    const privateStory = await publishOk(other, [poll]);
    await query(`UPDATE users SET is_private = true WHERE id = :'id'`, { id: other.id });
    assert.equal((await vote(privateStory, viewer, "poll-1", 0)).status, 403);

    const followersOnly = await publishOk(other, [poll], { audience: "followers" });
    await query(`UPDATE users SET is_private = false WHERE id = :'id'`, { id: other.id });
    assert.equal((await vote(followersOnly, viewer, "poll-1", 0)).status, 403);
  });
});

describe("quizzes", () => {
  it("never give the answer away before you answer, then say whether you were right", async () => {
    const owner = await signup();
    const viewer = await signup();
    const story = await publishOk(owner, [quiz]);
    const before = await sticker(story, viewer, "quiz-1");
    assert.equal("correctIndex" in before.properties, false);
    const listed = (await client.get(`/api/v1/users/${owner.username}/stories`, authHeader(viewer.token))).body.stories[0].overlays[0];
    assert.equal("correctIndex" in listed.properties, false, "nor in a creator's list");

    const wrong = await vote(story, viewer, "quiz-1", 0);
    assert.deepEqual([wrong.body.correct, wrong.body.correctIndex], [false, 1]);
    assert.equal((await vote(story, viewer, "quiz-1", 1)).status, 409, "no second try");
    assert.equal((await sticker(story, viewer, "quiz-1")).properties.correctIndex, 1, "known once answered");
    assert.equal((await sticker(story, owner, "quiz-1")).properties.correctIndex, 1, "the owner always knows");
    const right = await vote(story, await signup(), "quiz-1", 1);
    assert.equal(right.body.correct, true);
  });
});

describe("question stickers", () => {
  it("deliver answers privately to the owner, who can clear them", async () => {
    const owner = await signup();
    const viewer = await signup();
    const story = await publishOk(owner, [question]);
    const answer = (body: string, who = viewer) => client.post(`/api/v1/stories/${story}/stickers/q-1/answers`, { body }, authHeader(who.token));

    const sent = await answer("  What's your favourite city?  ");
    assert.equal(sent.status, 201, JSON.stringify(sent.body));
    assert.equal((await answer("")).status, 422);
    assert.equal((await answer("x".repeat(301))).status, 422);
    assert.equal((await answer("Hi", owner)).status, 403);
    assert.equal((await sticker(story, viewer, "q-1")).properties.viewerAnswered, true);
    assert.equal("responseCount" in (await sticker(story, viewer, "q-1")).properties, false, "how many answered is the owner's");
    assert.equal((await sticker(story, owner, "q-1")).properties.responseCount, 1);

    const list = await client.get(`/api/v1/stories/${story}/stickers/q-1/responses`, authHeader(owner.token));
    assert.deepEqual(list.body.responses.map((r: { body: string; responder: { username: string } }) => [r.body, r.responder.username]), [["What's your favourite city?", viewer.username]]);
    assert.equal((await client.get(`/api/v1/stories/${story}/stickers/q-1/responses`, authHeader(viewer.token))).status, 404);

    for (let i = 0; i < 4; i++) assert.equal((await answer(`more ${i}`)).status, 201);
    assert.equal((await answer("one too many")).status, 429, "five answers each");

    const id = list.body.responses[0].id as string;
    assert.equal((await client.delete(`/api/v1/stories/${story}/stickers/q-1/responses/${id}`, authHeader(viewer.token))).status, 404);
    assert.equal((await client.delete(`/api/v1/stories/${story}/stickers/q-1/responses/${id}`, authHeader(owner.token))).status, 204);
  });

  it("follow the link rules for messages", async () => {
    const owner = await signup();
    const fresh = await signup();
    const story = await publishOk(owner, [question]);
    const res = await client.post(`/api/v1/stories/${story}/stickers/q-1/answers`, { body: "see https://example.com" }, authHeader(fresh.token));
    assert.equal(res.status, 422, "a day-old account can't send links");
  });
});

describe("countdowns", () => {
  it("queue a reminder push for when they end, and take it back when switched off", async () => {
    const owner = await signup();
    const viewer = await signup();
    const story = await publishOk(owner, [countdown()]);
    const remind = (on: boolean, who = viewer) =>
      on ? client.put(`/api/v1/stories/${story}/stickers/cd-1/reminder`, undefined, authHeader(who.token)) : client.delete(`/api/v1/stories/${story}/stickers/cd-1/reminder`, authHeader(who.token));
    const queued = async () => query(`SELECT run_after, status FROM push_outbox WHERE user_id = :'u' AND kind = 'countdown' AND ref_id = :'s'`, { u: viewer.id, s: story });

    assert.deepEqual((await remind(true)).body, { reminded: true });
    assert.equal((await remind(true)).status, 200, "twice is once");
    assert.equal((await queued()).length, 1);
    assert.ok(new Date(String((await queued())[0]!.run_after)).getTime() > Date.now() + 3000_000, "sent when the countdown ends");
    assert.equal((await sticker(story, viewer, "cd-1")).properties.viewerReminded, true);
    assert.equal((await sticker(story, owner, "cd-1")).properties.reminderCount, 1);
    assert.equal((await remind(true, owner)).status, 403);

    const rendered = await renderPush({ id: "x", userId: viewer.id, kind: "countdown", actorId: owner.id, refId: story, attempts: 1 });
    assert.ok("message" in rendered, JSON.stringify(rendered));
    assert.equal(rendered.message.body, `⏰ Launch — @${owner.username}'s countdown has ended`);
    assert.equal(rendered.message.data.url, `katkee://story/${story}`);

    assert.deepEqual((await remind(false)).body, { reminded: false });
    assert.equal((await queued()).length, 0, "the queued push goes with it");
    assert.deepEqual(await renderPush({ id: "x", userId: viewer.id, kind: "countdown", actorId: owner.id, refId: story, attempts: 1 }), { skip: "reminder gone" });

    await remind(true);
    await client.post(`/api/v1/users/${viewer.username}/block`, undefined, authHeader(owner.token));
    assert.deepEqual(await renderPush({ id: "x", userId: viewer.id, kind: "countdown", actorId: owner.id, refId: story, attempts: 1 }), { skip: "actor unavailable" }, "a block stops it");
  });
});

describe("link stickers", () => {
  it("go through the link-safety policy when made, published and read", async () => {
    const owner = await signup({ ageDays: 3 });
    const viewer = await signup();
    const link = (url: string) => ({ id: "link-1", type: "link", ...at, properties: { url, label: "Shop" } });

    assert.deepEqual((await client.post("/api/v1/stories/link-check", { url: "katkee-shop.example.com/sale" }, authHeader(owner.token))).body, { url: "https://katkee-shop.example.com/sale" });
    assert.equal((await client.post("/api/v1/stories/link-check", { url: "javascript:alert(1)" }, authHeader(owner.token))).status, 422);
    assert.equal((await client.post("/api/v1/stories/link-check", { url: "https://bank.example@evil.example" }, authHeader(owner.token))).status, 422, "no user@host disguises");

    await query(`INSERT INTO blocked_link_domains (domain, reason, created_by) VALUES ('scam-site.example', 'test', :'by') ON CONFLICT DO NOTHING`, { by: owner.id });
    assert.equal((await client.post("/api/v1/stories/link-check", { url: "https://www.scam-site.example/win" }, authHeader(owner.token))).status, 422);
    assert.equal((await publish(owner, [link("https://www.scam-site.example/win")])).status, 422, "refused at publish, not dropped quietly");
    assert.equal((await publish(await signup(), [link("https://fine.example.com")])).status, 422, "new accounts can't post link stickers");

    const story = await publishOk(owner, [link("https://later-bad.example/x")]);
    assert.equal((await sticker(story, viewer, "link-1")).properties.url, "https://later-bad.example/x");
    await query(`INSERT INTO blocked_link_domains (domain, reason, created_by) VALUES ('later-bad.example', 'test', :'by') ON CONFLICT DO NOTHING`, { by: owner.id });
    assert.equal(await sticker(story, viewer, "link-1"), undefined, "a domain blocked later stops showing on Stories already up");
  });
});

describe("Add Yours chains", () => {
  it("start with a prompt, grow as people post from them, and show only Stories each viewer may see", async () => {
    const starter = await signup();
    const joiner = await signup();
    const privateJoiner = await signup();
    const viewer = await signup();
    const addYours = (chainId?: string, prompt = "Show your desk") => ({ id: "ay-1", type: "addYours", ...at, properties: { prompt, ...(chainId ? { chainId } : {}) } });

    const first = await publishOk(starter, [addYours()]);
    const chainId = (await sticker(first, viewer, "ay-1")).properties.chainId as string;
    assert.ok(chainId);
    assert.equal((await sticker(first, viewer, "ay-1")).properties.participants, 1);

    // A joiner can't rewrite the chain's prompt.
    const second = await publishOk(joiner, [addYours(chainId, "Something else")]);
    const joined = await sticker(second, viewer, "ay-1");
    assert.deepEqual([joined.properties.chainId, joined.properties.prompt, joined.properties.participants], [chainId, "Show your desk", 2]);

    await query(`UPDATE users SET is_private = true WHERE id = :'id'`, { id: privateJoiner.id });
    const third = await publishOk(privateJoiner, [addYours(chainId)]);
    assert.equal((await sticker(third, privateJoiner, "ay-1")).properties.participants, 3);

    const chain = await client.get(`/api/v1/add-yours/${chainId}`, authHeader(viewer.token));
    assert.equal(chain.status, 200);
    assert.equal(chain.body.chain.prompt, "Show your desk");
    assert.equal(chain.body.chain.participants, 3);
    assert.deepEqual(chain.body.stories.map((s: { storyId: string }) => s.storyId), [second, first], "the private account's Story isn't shown to a non-follower");

    await client.post(`/api/v1/users/${viewer.username}/block`, undefined, authHeader(joiner.token));
    assert.deepEqual((await client.get(`/api/v1/add-yours/${chainId}`, authHeader(viewer.token))).body.stories.map((s: { storyId: string }) => s.storyId), [first], "nor anyone blocked");
    assert.equal((await client.get(`/api/v1/add-yours/00000000-0000-4000-8000-000000000000`, authHeader(viewer.token))).status, 404);
  });

  it("can't be joined by guessing a chain you can't see: that prompt starts its own chain", async () => {
    const owner = await signup();
    const outsider = await signup();
    const hidden = await publishOk(owner, [{ id: "ay", type: "addYours", ...at, properties: { prompt: "Secret" } }], { audience: "followers" });
    const chainId = (await sticker(hidden, owner, "ay")).properties.chainId as string;
    const mine = await publishOk(outsider, [{ id: "ay", type: "addYours", ...at, properties: { prompt: "Mine", chainId } }]);
    const own = await sticker(mine, outsider, "ay");
    assert.notEqual(own.properties.chainId, chainId);
    assert.equal(own.properties.prompt, "Mine");
    assert.equal((await client.get(`/api/v1/add-yours/${chainId}`, authHeader(outsider.token))).status, 404);
  });
});

describe("analytics", () => {
  it("counts sticker use in the daily rollup", async () => {
    const owner = await signup();
    const viewer = await signup();
    const story = await publishOk(owner, [poll]);
    await vote(story, viewer, "poll-1", 0);
    const row = await queryOne(`SELECT analytics_rollup_day((now() AT TIME ZONE 'UTC')::date, 'UTC') AS m`);
    const metrics = JSON.parse(String(row?.m));
    assert.ok(metrics.interactive.pollVotes >= 1);
    assert.equal(typeof metrics.interactive.collabsAccepted, "number");
  });
});
