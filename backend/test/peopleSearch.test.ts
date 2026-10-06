// People search and "Suggested for you" (spec section 10): search by username, display name or
// interest with the best matches first and the searcher's relationship on every result; and
// suggestions before typing that only state facts the person can already see and never include
// anyone they follow, asked to follow, blocked, muted or dismissed, or any account that is
// restricted, suspended or deleted.
import "./env";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import { buildApp } from "../src/app";
import { query, queryOne } from "../src/db/psql";
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

interface Person { id: string; username: string; password: string; auth: Record<string, string> }

/** A term no other test's names contain: letters, then hex. */
const newTerm = () => `qz${randomBytes(3).toString("hex")}`;

async function person(profile: { username?: string; displayName?: string; interests?: string[]; isPrivate?: boolean } = {}): Promise<Person> {
  const input = { ...uniqueUser(), ...(profile.username ? { username: profile.username } : {}) };
  const res = await client.post("/api/v1/auth/signup", input);
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const who = { id: res.body.user.id, username: input.username, password: input.password, auth: authHeader(res.body.tokens.accessToken) };
  const { username: _username, ...rest } = profile;
  if (Object.keys(rest).length > 0) {
    const saved = await client.patch("/api/v1/users/me", rest, who.auth);
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
  }
  return who;
}

async function follow(from: Person, to: Person): Promise<void> {
  const res = await client.post(`/api/v1/users/${to.username}/follow`, undefined, from.auth);
  assert.equal(res.status, 200, JSON.stringify(res.body));
}

async function accept(target: Person, requester: Person): Promise<void> {
  const row = await queryOne(`SELECT id FROM follow_requests WHERE requester_id = :'r' AND target_id = :'t' AND status = 'pending'`, { r: requester.id, t: target.id });
  assert.ok(row?.id, "a pending request");
  assert.equal((await client.post(`/api/v1/follow-requests/${row.id}/accept`, undefined, target.auth)).status, 204);
}

async function publicStory(owner: Person): Promise<void> {
  const upload = await fetch(`${baseUrl}/api/v1/media/photos`, { method: "POST", headers: { "Content-Type": "image/png", ...owner.auth }, body: buildTestPng(6, 6) });
  assert.equal(upload.status, 201);
  const media = (await upload.json()) as { media: { id: string } };
  const story = await client.post("/api/v1/stories", { mediaId: media.media.id, caption: "", audience: "public", allowComments: "everyone", allowSharing: true }, owner.auth);
  assert.equal(story.status, 201, JSON.stringify(story.body));
}

const search = (who: Person, q: string, extra = "") => client.get(`/api/v1/search/users?q=${encodeURIComponent(q)}${extra}`, who.auth);
const usernames = (res: { body: { results: Array<{ username: string }> } }) => res.body.results.map((r) => r.username);
const suggestions = async (who: Person, extra = "") => {
  const res = await client.get(`/api/v1/search/suggestions${extra}`, who.auth);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body.suggestions as Array<{ id: string; username: string; isPrivate: boolean; reason: Record<string, unknown>; viewer: Record<string, boolean> }>;
};

describe("people search", () => {
  it("puts the exact username first, then names starting with the term, a later word, anywhere, then interests", async () => {
    const t = newTerm();
    const searcher = await person();
    const exact = await person({ username: t });
    const prefixA = await person({ username: `${t}_aa` });
    const prefixB = await person({ username: `${t}_bb` });
    const namePrefix = await person({ displayName: `${t.toUpperCase()} Jones` });
    const laterWord = await person({ displayName: `Ana ${t}son` });
    const inside = await person({ username: `zz_${t}` });
    const interest = await person({ displayName: "Plain Person", interests: ["Cooking", `${t} hiking`] });
    await person({ displayName: "Not a match" });

    const expected = [exact, prefixA, prefixB, namePrefix, laterWord, inside, interest].map((p) => p.username);
    assert.deepEqual(usernames(await search(searcher, t)), expected);
    assert.deepEqual(usernames(await search(searcher, t.toUpperCase())), expected, "case doesn't matter");

    await follow(searcher, prefixB);
    const followedFirst = await search(searcher, t);
    assert.deepEqual(usernames(followedFirst).slice(1, 3), [prefixB.username, prefixA.username], "people you follow lead their group");
    const hit = followedFirst.body.results.find((r: { username: string }) => r.username === interest.username);
    assert.deepEqual(hit.interests, ["Cooking", `${t} hiking`]);
  });

  it("for one or two letters, lists usernames starting with them, then every other match, alphabetically", async () => {
    // "wj": letters no generated name or other test's name contains.
    const searcher = await person();
    const hex = () => randomBytes(3).toString("hex");
    const startsB = await person({ username: `wjb_${hex()}` });
    const startsA = await person({ username: `wja_${hex()}` });
    // Every other match is alphabetical, whatever matched: an interest can come before a name.
    const interest = await person({ username: `aa0_${hex()}`, interests: ["Bowjumping"] });
    const insideName = await person({ username: `aa_wj_${hex()}` });
    const displayName = await person({ username: `ab_${hex()}`, displayName: "Hawj Tester" });
    const expected = [startsA, startsB, interest, insideName, displayName].map((p) => p.username);
    assert.deepEqual(usernames(await search(searcher, "wj")), expected);
    assert.deepEqual(usernames(await search(searcher, "WJ")), expected, "case doesn't matter");
    const pages = [];
    for (const offset of [0, 2, 4]) pages.push(...usernames(await search(searcher, "wj", `&limit=2&offset=${offset}`)));
    assert.deepEqual(pages, expected, "pages line up across both lists");
    await follow(searcher, displayName);
    assert.deepEqual(usernames(await search(searcher, "wj", "&scope=following")), [displayName.username]);
    assert.deepEqual(usernames(await search(searcher, "w")).slice(0, 2), [startsA.username, startsB.username]);
  });

  it("matches each interest on its own, never the JSON around them, with %, _ and \\ taken literally", async () => {
    const t = newTerm();
    const searcher = await person();
    const quoted = await person({ interests: [`Rock "${t}" Roll`] });
    const pair = await person({ interests: [`Alpha${t}`, "Beta"] });
    const percent = await person({ interests: [`100% ${t}`] });
    const slash = await person({ interests: [`back\\slash${t}`] });

    assert.deepEqual(usernames(await search(searcher, `"${t}"`)), [quoted.username]);
    for (const syntax of ['","', ",", "[", "]"]) {
      assert.ok(!usernames(await search(searcher, syntax)).includes(pair.username), `the array's ${syntax} is not a match`);
    }
    assert.deepEqual(usernames(await search(searcher, `${t}","Beta`)), []);
    assert.deepEqual(usernames(await search(searcher, `0% ${t}`)), [percent.username]);
    assert.deepEqual(usernames(await search(searcher, `0_ ${t}`)), [], "_ is not a wildcard");
    assert.deepEqual(usernames(await search(searcher, `k\\slash${t}`)), [slash.username]);
  });

  it("says on each result whether you follow them, asked to follow them, or they follow you", async () => {
    const t = newTerm();
    const searcher = await person();
    const followed = await person({ displayName: `${t} Followed` });
    const privateOne = await person({ displayName: `${t} Private`, isPrivate: true });
    const fan = await person({ displayName: `${t} Fan` });
    const stranger = await person({ displayName: `${t} Stranger` });
    await follow(searcher, followed);
    await follow(searcher, privateOne);
    await follow(fan, searcher);

    const res = await search(searcher, t);
    const byName = Object.fromEntries(res.body.results.map((r: { username: string }) => [r.username, r]));
    assert.deepEqual(byName[followed.username].viewer, { isFollowing: true, isFollowedBy: false, hasPendingRequestFromViewer: false });
    assert.deepEqual(byName[privateOne.username].viewer, { isFollowing: false, isFollowedBy: false, hasPendingRequestFromViewer: true });
    assert.equal(byName[privateOne.username].isPrivate, true);
    assert.deepEqual(byName[fan.username].viewer, { isFollowing: false, isFollowedBy: true, hasPendingRequestFromViewer: false });
    assert.deepEqual(byName[stranger.username].viewer, { isFollowing: false, isFollowedBy: false, hasPendingRequestFromViewer: false });

    assert.deepEqual(usernames(await search(searcher, t, "&scope=following")), [followed.username]);
    assert.equal((await search(searcher, t, "&scope=all")).body.results.length, 4);
    assert.equal((await search(searcher, t, "&scope=friends")).status, 422);
  });

  it("pages are stable and never overlap", async () => {
    const t = newTerm();
    const searcher = await person();
    for (let i = 0; i < 5; i++) await person({ displayName: `${t} Page ${i}` });
    const all = usernames(await search(searcher, t, "&limit=10"));
    assert.equal(all.length, 5);
    const pages = [];
    for (const offset of [0, 2, 4]) pages.push(...usernames(await search(searcher, t, `&limit=2&offset=${offset}`)));
    assert.deepEqual(pages, all);
  });

  it("leaves out blocked accounts either way, suspended and deleted accounts, and the searcher", async () => {
    const t = newTerm();
    const searcher = await person({ displayName: `${t} Me` });
    const [blockedByMe, blocksMe, suspended, deleted, visible] = (await Promise.all(
      ["Blocked", "Blocker", "Suspended", "Deleted", "Visible"].map((name) => person({ displayName: `${t} ${name}` })),
    )) as [Person, Person, Person, Person, Person];
    assert.equal((await client.post(`/api/v1/users/${blockedByMe.username}/block`, undefined, searcher.auth)).status, 204);
    assert.equal((await client.post(`/api/v1/users/${searcher.username}/block`, undefined, blocksMe.auth)).status, 204);
    await query(`UPDATE users SET is_active = false, moderation_state = 'SUSPENDED' WHERE id = :'id'`, { id: suspended.id });
    assert.equal((await client.deleteWithBody("/api/v1/users/me", { password: deleted.password }, deleted.auth)).status, 204);
    assert.deepEqual(usernames(await search(searcher, t)), [visible.username]);
  });
});

describe("suggested for you", () => {
  it("lists people who follow you, then people your friends follow, then shared interests, then new public creators", async () => {
    const t = newTerm();
    const viewer = await person({ interests: [`Birding ${t}`] });
    const [friendA, friendB] = await Promise.all([person(), person()]);
    await follow(viewer, friendA);
    await follow(viewer, friendB);
    const fan = await person();
    await follow(fan, viewer);
    const popular = await person();
    const known = await person();
    await follow(friendA, popular);
    await follow(friendB, popular);
    await follow(friendA, known);
    const kindred = await person({ interests: ["Chess", `birding ${t}`] });
    const newcomer = await person();
    await publicStory(newcomer);

    const mine = new Set([fan, popular, known, kindred, newcomer].map((p) => p.id));
    const list = (await suggestions(viewer)).filter((s) => mine.has(s.id));
    assert.deepEqual(list.map((s) => s.username), [fan, popular, known, kindred, newcomer].map((p) => p.username));
    const first = [friendA.username, friendB.username].sort()[0];
    assert.deepEqual(list.map((s) => s.reason), [
      { kind: "follows_you" },
      { kind: "followed_by", username: first, others: 1 },
      { kind: "followed_by", username: friendA.username, others: 0 },
      { kind: "shared_interest", interest: `birding ${t}` },
      { kind: "new" },
    ]);
    assert.deepEqual(list[0]!.viewer, { isFollowing: false, isFollowedBy: true, hasPendingRequestFromViewer: false });

    await follow(viewer, newcomer);
    assert.ok(!(await suggestions(viewer)).some((s) => s.id === newcomer.id), "following someone removes the suggestion");
  });

  it("never suggests yourself, people you follow or asked to follow, blocked, muted or dismissed people, or restricted, suspended or deleted accounts", async () => {
    const viewer = await person();
    const friend = await person();
    await follow(viewer, friend);
    const control = await person();
    const people = (await Promise.all(Array.from({ length: 9 }, () => person()))) as Person[];
    const [followed, requested, blocksMe, blockedByMe, muted, dismissed, restricted, suspended, deleted] = people as [
      Person, Person, Person, Person, Person, Person, Person, Person, Person,
    ];
    for (const p of [control, ...people]) await follow(friend, p);
    await follow(friend, viewer);
    await follow(viewer, followed);
    await client.patch("/api/v1/users/me", { isPrivate: true }, requested.auth);
    await client.post(`/api/v1/users/${requested.username}/follow`, undefined, viewer.auth);
    assert.equal((await client.post(`/api/v1/users/${viewer.username}/block`, undefined, blocksMe.auth)).status, 204);
    assert.equal((await client.post(`/api/v1/users/${blockedByMe.username}/block`, undefined, viewer.auth)).status, 204);
    assert.equal((await client.post(`/api/v1/users/${muted.username}/mute`, undefined, viewer.auth)).status, 204);
    await query(`INSERT INTO creator_not_interested (viewer_id, creator_id) VALUES (:'v', :'c')`, { v: viewer.id, c: dismissed.id });
    await query(`UPDATE users SET moderation_state = 'RESTRICTED' WHERE id = :'id'`, { id: restricted.id });
    await query(`UPDATE users SET is_active = false, moderation_state = 'SUSPENDED' WHERE id = :'id'`, { id: suspended.id });
    assert.equal((await client.deleteWithBody("/api/v1/users/me", { password: deleted.password }, deleted.auth)).status, 204);

    const ids = new Set((await suggestions(viewer)).map((s) => s.id));
    assert.ok(ids.has(control.id), "the control is suggested");
    for (const [name, p] of Object.entries({ viewer, friend, followed, requested, blocksMe, blockedByMe, muted, dismissed, restricted, suspended, deleted })) {
      assert.ok(!ids.has(p.id), `${name} must not be suggested`);
    }
  });

  it("names a friend only when you can already see who they follow", async () => {
    const viewer = await person();
    const privateFriend = await person({ isPrivate: true });
    const theirPick = await person();
    await follow(privateFriend, theirPick);
    await client.post(`/api/v1/users/${privateFriend.username}/follow`, undefined, viewer.auth);
    assert.ok(!(await suggestions(viewer)).some((s) => s.id === theirPick.id), "a request that isn't accepted shows nothing of theirs");
    await accept(privateFriend, viewer);
    const after = (await suggestions(viewer)).find((s) => s.id === theirPick.id);
    assert.deepEqual(after?.reason, { kind: "followed_by", username: privateFriend.username, others: 0 });

    const suspendedFriend = await person();
    const hidden = await person();
    await follow(viewer, suspendedFriend);
    await follow(suspendedFriend, hidden);
    await query(`UPDATE users SET is_active = false, moderation_state = 'SUSPENDED' WHERE id = :'id'`, { id: suspendedFriend.id });
    assert.ok(!(await suggestions(viewer)).some((s) => s.id === hidden.id), "a suspended account is never named");
  });

  it("suggests new accounts only when they are public and have a public Story up", async () => {
    const viewer = await person();
    const quiet = await person();
    const privateCreator = await person({ isPrivate: true });
    await publicStory(privateCreator);
    const oldCreator = await person();
    await publicStory(oldCreator);
    await query(`UPDATE users SET created_at = now() - interval '31 days' WHERE id = :'id'`, { id: oldCreator.id });
    const ids = new Set((await suggestions(viewer)).map((s) => s.id));
    for (const [name, p] of Object.entries({ quiet, privateCreator, oldCreator })) assert.ok(!ids.has(p.id), name);
  });

  it("respects and checks the limit", async () => {
    const viewer = await person();
    const friend = await person();
    await follow(viewer, friend);
    for (const p of await Promise.all([person(), person(), person()])) await follow(friend, p);
    assert.equal((await suggestions(viewer, "?limit=2")).length, 2);
    for (const bad of ["0", "51", "two"]) assert.equal((await client.get(`/api/v1/search/suggestions?limit=${bad}`, viewer.auth)).status, 422, bad);
    assert.equal((await client.get("/api/v1/search/suggestions")).status, 401);
  });
});
