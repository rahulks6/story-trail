// Public Katkee on the web (modules/website/web-profile.ts): katkee.com/u/<username> is a real
// profile for a public account that shows on the web, /s/<id> plays its public Story, and the
// media behind them is served only while that is still true. Everything else (private,
// suspended, restricted, deleted, opted out; followers-only, Close Friends, expired, removed)
// gets the same minimal page as a link to nothing, and watching is never a view.
import "./env";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { buildApp } from "../src/app";
import { query, queryOne } from "../src/db/psql";
import { resetSitemapCache, webMediaLimiter, webPageLimiter, webProfileCsp, WEBSITE_CSP } from "../src/modules/website/website.routes";
import { flushWebPageCounts } from "../src/modules/website/web-profile";
import { escapeHtml, jsonForScript } from "../src/modules/website/web-pages";
import { buildTestPng } from "./fixtures";

const server = buildApp();
let base = "";
type Reply = { status: number; headers: Headers; text: string; body: any };
async function request(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Reply> {
  const res = await fetch(base + path, { method, redirect: "manual", headers: { "Content-Type": "application/json", ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const text = await res.text();
  let parsed: unknown = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
  return { status: res.status, headers: res.headers, text, body: parsed };
}
const get = (path: string, headers: Record<string, string> = {}) => request("GET", path, undefined, headers);

interface Person { id: string; username: string; email: string; displayName: string; auth: Record<string, string> }
async function person(label: string): Promise<Person> {
  const tag = randomUUID().slice(0, 8);
  const input = { username: `${label}_${tag}`, email: `${label}_${tag}@example.com`, password: "correcthorsebattery", displayName: `${label} ${tag}`, birthDate: "1995-05-15" };
  const r = await request("POST", "/api/v1/auth/signup", input);
  assert.equal(r.status, 201, r.text);
  return { id: r.body.user.id, username: input.username, email: input.email, displayName: input.displayName, auth: { Authorization: `Bearer ${r.body.tokens.accessToken}` } };
}
async function photo(owner: Person): Promise<string> {
  const r = await fetch(`${base}/api/v1/media/photos`, { method: "POST", headers: { "Content-Type": "image/png", ...owner.auth }, body: buildTestPng(12, 12) });
  assert.equal(r.status, 201);
  return ((await r.json()) as { media: { id: string } }).media.id;
}
async function story(owner: Person, caption: string, audience: "public" | "followers" | "close_friends" = "public", overlays: unknown[] = []): Promise<string> {
  const r = await request("POST", "/api/v1/stories", { mediaId: await photo(owner), caption, audience, allowComments: "everyone", allowSharing: true, overlays }, owner.auth);
  assert.equal(r.status, 201, r.text);
  return r.body.story.id;
}
/** The player's data block on a web profile page. */
function pageData(html: string): { owner: any; stories: any[]; highlights: any[] } {
  const m = /<script type="application\/json" id="web-data">([^<]*)<\/script>/.exec(html);
  assert.ok(m, "the page carries its Stories");
  return JSON.parse(m[1]!);
}
/** The minimal page, without the link's own addresses: the same for every link it answers. */
const strip = (html: string) => html.replace(/(katkee:\/\/|katkee\.com\/)[^"]+/g, "");
let minimal = "";

const SECRET = { followers: `followers-only-${randomUUID()}`, close: `close-friends-${randomUUID()}`, gone: `expired-${randomUUID()}`, removed: `removed-${randomUUID()}` };
let creator: Person, friend: Person, mentioned: Person;
const ids = {} as Record<"live" | "followers" | "close" | "inHighlight" | "expired" | "removed" | "highlight" | "hiddenHighlight", string>;

before(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  [creator, friend, mentioned] = await Promise.all(["creator", "friend", "mentioned"].map(person)) as [Person, Person, Person];
  await query(`UPDATE media SET status = 'ready' WHERE owner_id = :'id'`, { id: creator.id });
  const avatar = await photo(creator), cover = await photo(creator);
  const saved = await request("PATCH", "/api/v1/users/me", {
    bio: "Chai, trains and </script><script>alert(1)</script> %WEB_DATA%\nSecond line", interests: ["Food", "Travel"], avatarMediaId: avatar, coverMediaId: cover,
  }, creator.auth);
  assert.equal(saved.status, 200, saved.text);
  await request("PUT", `/api/v1/close-friends/${friend.username}`, undefined, creator.auth);
  await request("POST", `/api/v1/users/${creator.username}/follow`, undefined, friend.auth);

  ids.live = await story(creator, "Sunrise at the ghat", "public", [
    { type: "text", x: 0.5, y: 0.3, scale: 1, rotation: 0, properties: { text: "Good morning", style: "Classic", color: "#FFC800", backgroundColor: null, align: "center", fontSize: 0.05 } },
    { type: "mention", x: 0.5, y: 0.6, scale: 1, rotation: 0, properties: { userId: mentioned.id } },
    { type: "quiz", x: 0.5, y: 0.8, scale: 1, rotation: 0, properties: { question: "Which city?", options: ["Pune", "Varanasi"], correctIndex: 1 } },
  ]);
  ids.followers = await story(creator, SECRET.followers, "followers");
  ids.close = await story(creator, SECRET.close, "close_friends");
  ids.inHighlight = await story(creator, "Kept in a Highlight");
  ids.expired = await story(creator, SECRET.gone);
  ids.removed = await story(creator, SECRET.removed);
  await query(`UPDATE media SET status = 'ready' WHERE owner_id = :'id'`, { id: creator.id });
  ids.highlight = (await request("POST", "/api/v1/highlights", { title: "Trips", storyIds: [ids.inHighlight, ids.followers] }, creator.auth)).body.highlight.id;
  ids.hiddenHighlight = (await request("POST", "/api/v1/highlights", { title: "Friends only", storyIds: [ids.close] }, creator.auth)).body.highlight.id;
  await query(`UPDATE stories SET expires_at = now() - interval '1 hour' WHERE id IN (:'a', :'b')`, { a: ids.inHighlight, b: ids.expired });
  await query(`UPDATE stories SET deleted_at = now(), moderation_removed_at = now() WHERE id = :'id'`, { id: ids.removed });
  minimal = strip((await get(`/u/nobody_${randomUUID().slice(0, 8)}`)).text);
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("a public account's web profile", () => {
  it("shows the profile, its public Stories and public Highlights, and nothing else", async () => {
    const reply = await get(`/u/${creator.username}`);
    assert.equal(reply.status, 200, reply.text.slice(0, 200));
    const html = reply.text;
    assert.equal(reply.headers.get("content-security-policy"), webProfileCsp());
    assert.match(webProfileCsp(), /script-src 'self'/);
    assert.doesNotMatch(webProfileCsp(), /unsafe|\*/);
    assert.equal(reply.headers.get("cache-control"), "public, max-age=60");
    assert.equal(reply.headers.get("x-robots-tag"), null, "a public profile may be indexed");
    assert.equal(reply.headers.get("set-cookie"), null);
    assert.match(html, new RegExp(`<title>${escapeRe(creator.displayName)} \\(@${creator.username}\\) · Katkee</title>`));
    assert.match(html, /<meta name="robots" content="index, follow">/);
    assert.ok(html.includes(`<link rel="canonical" href="https://katkee.com/u/${creator.username}">`));
    assert.match(html, new RegExp(`<meta property="og:image" content="https://katkee\\.com/u/${creator.username}/photo\\?v=[0-9a-f]{8}">`));
    assert.match(html, /<meta name="twitter:card" content="summary">/);
    assert.match(html, /<script src="\/assets\/player\.[0-9a-f]{10}\.js" defer><\/script>/);
    assert.ok(html.includes(`<a class="profile-avatar has-stories" href="/s/${ids.live}" data-play="stories"`), "the ring plays the Stories");
    assert.ok(html.includes(`href="katkee://user/${creator.username}?id=${creator.id}"`));
    assert.match(html, /<li><strong title="1">1<\/strong> follower<\/li>/);
    assert.match(html, /<ul class="profile-interests" aria-label="Interests"><li>Food<\/li><li>Travel<\/li><\/ul>/);
    // User text is escaped, and can't end the data block or fill in a marker.
    assert.ok(html.includes("Chai, trains and &lt;/script&gt;&lt;script&gt;alert(1)&lt;/script&gt; %WEB_DATA%<br>Second line"));
    assert.equal((html.match(/<script/g) ?? []).length, 2, "the player and its data, nothing else");
    assert.ok(html.includes(`data-play="highlight:${ids.highlight}"`));
    assert.ok(!html.includes(ids.hiddenHighlight), "a Highlight of only Close Friends Stories doesn't show");

    const data = pageData(html);
    assert.deepEqual(data.stories.map((s) => s.id), [ids.live], "only the live, public Story");
    assert.deepEqual(data.highlights.map((h) => [h.id, h.items.map((s: { id: string }) => s.id)]), [[ids.highlight, [ids.inHighlight]]]);
    const live = data.stories[0];
    assert.equal(live.image, `/s/${ids.live}/image`);
    assert.deepEqual(live.overlays.map((o: { type: string }) => o.type), ["text", "mention", "quiz"]);
    assert.equal(live.overlays[1].username, mentioned.username);
    assert.deepEqual(Object.keys(live.overlays[2]).sort(), ["options", "question", "rotation", "scale", "type", "x", "y", "z"], "no answer, no results");
    for (const secret of [...Object.values(SECRET), creator.email, mentioned.email, mentioned.id, "correctIndex", "viewCount", "likeCount"]) {
      assert.ok(!html.includes(secret), `the page leaked ${secret}`);
    }
  });

  it("plays a public Story at /s/<id>, unindexed, with its poster as the link preview", async () => {
    const reply = await get(`/s/${ids.live}`);
    assert.equal(reply.status, 200);
    assert.equal(reply.headers.get("x-robots-tag"), "noindex");
    assert.match(reply.text, new RegExp(`data-start="${ids.live}"`));
    assert.match(reply.text, /<meta name="robots" content="noindex">/);
    assert.ok(reply.text.includes(`<meta property="og:image" content="https://katkee.com/s/${ids.live}/image">`));
    assert.ok(reply.text.includes(`<link rel="canonical" href="https://katkee.com/s/${ids.live}">`));
    assert.match(reply.text, /<meta name="twitter:card" content="summary_large_image">/);
    assert.match(reply.text, /<meta name="description" content="Sunrise at the ghat">/);
    assert.ok(reply.text.includes(`href="katkee://story/${ids.live}"`));
  });

  it("never shows a followers-only, Close Friends, expired or removed Story", async () => {
    for (const id of [ids.followers, ids.close, ids.expired, ids.inHighlight, ids.removed]) {
      const reply = await get(`/s/${id}`);
      assert.equal(reply.status, 200);
      assert.equal(reply.headers.get("content-security-policy"), WEBSITE_CSP);
      assert.equal(strip(reply.text), minimal, id);
    }
  });

  it("serves the media of what it shows, and of nothing else", async () => {
    for (const path of [`/s/${ids.live}/image`, `/s/${ids.live}/thumb`, `/s/${ids.inHighlight}/image`, `/u/${creator.username}/photo`, `/u/${creator.username}/cover`]) {
      const reply = await get(path);
      assert.equal(reply.status, 200, path);
      assert.match(reply.headers.get("content-type") ?? "", /^image\//, path);
      assert.equal(reply.headers.get("x-robots-tag"), "noindex", path);
    }
    for (const path of [`/s/${ids.followers}/image`, `/s/${ids.close}/thumb`, `/s/${ids.expired}/image`, `/s/${ids.removed}/image`, `/s/${ids.live}/video`, `/s/${randomUUID()}/image`, `/u/${friend.username}/photo`]) {
      assert.equal((await get(path)).status, 404, path);
    }
  });

  it("is the same for everyone: no sign-in, no cookies, and a signed-in token changes nothing", async () => {
    const signedOut = await get(`/u/${creator.username}`);
    const signedIn = await get(`/u/${creator.username}`, friend.auth);
    assert.equal(signedIn.text, signedOut.text);
    assert.equal(signedIn.headers.get("set-cookie"), null);
  });
});

describe("accounts that don't show on the web", () => {
  /** Applies `change` to a fresh public account with a public Story, then checks it looks like nobody. */
  async function hidden(label: string, change: (p: Person) => Promise<unknown>) {
    const p = await person(label);
    await query(`UPDATE media SET status = 'ready' WHERE owner_id = :'id'`, { id: p.id });
    const avatar = await photo(p);
    await request("PATCH", "/api/v1/users/me", { avatarMediaId: avatar, bio: `bio-${label}` }, p.auth);
    const s = await story(p, `caption-${label}`);
    await query(`UPDATE media SET status = 'ready' WHERE owner_id = :'id'`, { id: p.id });
    assert.equal((await get(`/u/${p.username}`)).headers.get("content-security-policy"), webProfileCsp(), `${label} shows before`);
    await change(p);
    for (const path of [`/u/${p.username}`, `/u/${p.username}?id=${p.id}`, `/s/${s}`]) {
      const reply = await get(path);
      assert.equal(reply.status, 200, path);
      assert.equal(strip(reply.text), minimal, `${label}: ${path}`);
      for (const secret of [`bio-${label}`, `caption-${label}`, p.email, p.displayName]) assert.ok(!reply.text.includes(secret), `${label} leaked ${secret}`);
    }
    for (const path of [`/u/${p.username}/photo`, `/s/${s}/image`]) assert.equal((await get(path)).status, 404, `${label}: ${path}`);
    return p;
  }

  it("a private account", async () => {
    await hidden("private", (p) => request("PATCH", "/api/v1/users/me", { isPrivate: true }, p.auth));
  });
  it("an account that turned off Show my profile on the web", async () => {
    const p = await hidden("optout", async (p) => {
      const r = await request("PATCH", "/api/v1/users/me", { showOnWeb: false }, p.auth);
      assert.equal(r.status, 200, r.text);
      assert.equal(r.body.user.showOnWeb, false);
    });
    // And back on: the profile is there again.
    assert.equal((await request("PATCH", "/api/v1/users/me", { showOnWeb: true }, p.auth)).body.user.showOnWeb, true);
    assert.equal((await get(`/u/${p.username}`)).headers.get("content-security-policy"), webProfileCsp());
  });
  it("suspended, restricted, disabled and deleted accounts", async () => {
    await hidden("suspended", (p) => query(`UPDATE users SET is_active = false, moderation_state = 'SUSPENDED' WHERE id = :'id'`, { id: p.id }));
    await hidden("restricted", (p) => query(`UPDATE users SET moderation_state = 'RESTRICTED' WHERE id = :'id'`, { id: p.id }));
    await hidden("disabled", (p) => query(`UPDATE users SET moderation_state = 'DISABLED' WHERE id = :'id'`, { id: p.id }));
    await hidden("deleted", (p) => query(`UPDATE users SET deleted_at = now() WHERE id = :'id'`, { id: p.id }));
  });
});

describe("the setting", () => {
  it("is on by default, in the account's own answers, and only a boolean", async () => {
    const p = await person("setting");
    const me = await request("GET", "/api/v1/auth/me", undefined, p.auth);
    assert.equal(me.status, 200, me.text);
    assert.equal(me.body.user.showOnWeb, true);
    const bad = await request("PATCH", "/api/v1/users/me", { showOnWeb: "no" }, p.auth);
    assert.equal(bad.status, 422);
    assert.match(bad.text, /showOnWeb must be a boolean/);
    assert.equal((await request("PATCH", "/api/v1/users/me", { showOnWeb: false })).status, 401);
  });
});

describe("search engines and counting", () => {
  it("lists only accounts that show on the web in the profile sitemap", async () => {
    const out = await person("sitemapout");
    await request("PATCH", "/api/v1/users/me", { showOnWeb: false }, out.auth);
    resetSitemapCache();
    const reply = await get("/sitemap-profiles.xml");
    assert.equal(reply.status, 200);
    assert.equal(reply.headers.get("content-type"), "application/xml; charset=utf-8");
    assert.ok(reply.text.includes(`<loc>https://katkee.com/u/${creator.username}</loc>`));
    assert.ok(!reply.text.includes(out.username));
    const robots = await get("/robots.txt");
    assert.match(robots.text, /Sitemap: https:\/\/katkee\.com\/sitemap-profiles\.xml/);
  });

  it("never counts a web visit as a Story view, profile visit or reach; only a daily page count", async () => {
    const views = () => queryOne(`SELECT count(*) AS n FROM story_views WHERE story_id = :'id'`, { id: ids.live }).then((r) => Number(r!.n));
    const visits = () => queryOne(`SELECT count(*) AS n FROM recommendation_events WHERE creator_id = :'id'`, { id: creator.id }).then((r) => Number(r?.n ?? 0)).catch(() => 0);
    const pages = () => queryOne(`SELECT COALESCE(sum(views), 0) AS n FROM web_page_views`, {}).then((r) => Number(r!.n));
    await flushWebPageCounts();
    const [v, e, p] = [await views(), await visits(), await pages()];
    await get(`/u/${creator.username}`);
    await get(`/s/${ids.live}`);
    await get(`/s/${ids.live}/image`);
    await request("HEAD", `/u/${creator.username}`);
    await flushWebPageCounts();
    assert.equal(await views(), v, "no Story view");
    assert.equal(await visits(), e, "no profile visit");
    assert.equal(await pages(), p + 2, "one profile page and one Story page, counted by kind only");
    const columns = await query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'web_page_views' ORDER BY column_name`, {});
    assert.deepEqual(columns.map((c) => c.column_name), ["day", "page", "views"], "nothing about who, or which profile");
  });
});

describe("abuse", () => {
  it("limits lookups per network address, with a plain 429", async () => {
    webPageLimiter.reset();
    let last: Reply | null = null;
    for (let i = 0; i < 121; i++) last = await get(`/u/nobody_${i}_x`);
    assert.equal(last!.status, 429);
    assert.equal(last!.headers.get("retry-after"), "60");
    assert.equal(last!.headers.get("cache-control"), "no-store");
    webPageLimiter.reset();
    webMediaLimiter.reset();
    assert.equal((await get(`/u/${creator.username}`)).status, 200);
  });

  it("escapes the data block so nothing in a Story can end it", () => {
    assert.equal(jsonForScript({ a: "</script><b>&\u2028" }), '{"a":"\\u003c/script\\u003e\\u003cb\\u003e\\u0026\\u2028"}');
  });
});

function escapeRe(s: string) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
