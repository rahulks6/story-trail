import "./env";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { buildApp } from "../src/app";
import { config } from "../src/config/env";
import { authHeader, makeClient, uniqueUser } from "./helpers";
import { buildTestPng } from "./fixtures";
import { clearGiphyCache, giphyEnabled, giphyMediaUrl, giphyStickers } from "../src/modules/gifs/giphy";
import { katkeePack, searchKatkeePack } from "../src/modules/gifs/pack";

/** The tests turn GIPHY on and off (config is read-only to the app). */
const giphyConfig = config.giphy as { apiKey: string };

// Moving stickers: Katkee's own pack (assets/stickers) and GIPHY, searched through the server.
let client: ReturnType<typeof makeClient>;
let baseUrl: string;
const server = buildApp();
before(async () => {
  await new Promise<void>((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  client = makeClient(baseUrl);
});
after(async () => {
  giphyConfig.apiKey = "";
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const GIF_URL = "https://media2.giphy.com/media/v1.Y2lkPTc5MGI3NjEx/3o7abKhOpu0NwenH3O/200w.webp?cid=790b7611&rid=200w.webp&ct=s";

async function signUp(): Promise<string> {
  const res = await client.post("/api/v1/auth/signup", uniqueUser());
  return res.body.tokens.accessToken as string;
}

describe("Katkee's own sticker pack", () => {
  it("has its categories and stickers, served as animated WebP on this server", async () => {
    const pack = katkeePack();
    assert.ok(pack.categories.includes("birthday") && pack.categories.includes("festivals"));
    assert.ok(pack.stickers.length >= 50, `${pack.stickers.length} stickers`);
    for (const s of pack.stickers) assert.ok(pack.categories.includes(s.category), s.id);
    const res = await fetch(`${baseUrl}/stickers/cake.webp`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "image/webp");
    const bytes = Buffer.from(await res.arrayBuffer());
    assert.equal(bytes.subarray(0, 4).toString(), "RIFF");
    assert.equal(bytes.subarray(8, 12).toString(), "WEBP");
    for (const bad of ["nope.webp", "cake.png", "..%2Fmanifest.json", "manifest.json"]) {
      assert.equal((await fetch(`${baseUrl}/stickers/${bad}`)).status, 404, bad);
    }
  });

  it("finds stickers by their words, in English, Hindi and Marathi", () => {
    assert.equal(searchKatkeePack("birthday")[0]?.category, "birthday");
    assert.ok(searchKatkeePack("diwali").some((s) => s.id === "shubh-deepavali"));
    assert.ok(searchKatkeePack("वाढदिवस").some((s) => s.id === "vadhdivas"));
    assert.deepEqual(searchKatkeePack("   "), []);
  });

  it("the API lists the pack and searches it, for signed-in people", async () => {
    const token = await signUp();
    assert.equal((await client.get("/api/v1/gifs")).status, 401);
    const pack = await client.get("/api/v1/gifs", authHeader(token));
    assert.equal(pack.status, 200);
    assert.equal(pack.body.giphy, false, "GIPHY is off without a key");
    assert.ok(pack.body.stickers.some((s: { id: string; url: string }) => s.id === "cake" && s.url === "/stickers/cake.webp"));
    const found = await client.get("/api/v1/gifs/search?q=chai", authHeader(token));
    assert.equal(found.status, 200);
    assert.ok(found.body.katkee.some((s: { id: string }) => s.id === "chai-time"));
    assert.deepEqual(found.body.giphy, []);
    assert.equal(found.body.nextOffset, null);
  });
});

describe("GIPHY", () => {
  it("accepts only GIPHY's own media addresses", () => {
    assert.equal(giphyMediaUrl(GIF_URL), GIF_URL);
    assert.equal(giphyMediaUrl("https://i.giphy.com/3o7abKhOpu0NwenH3O.gif"), "https://i.giphy.com/3o7abKhOpu0NwenH3O.gif");
    for (const bad of [
      "http://media2.giphy.com/media/x/200w.webp", "https://media2.giphy.com.evil.example/media/x/200w.webp",
      "https://evil.example/media/x/200w.webp", "https://user@media.giphy.com/media/x/200w.webp",
      "https://media.giphy.com/media/x/200w.html", "https://media.giphy.com/media/../x/200w.gif",
      "https://media9.giphy.com/media/x/200w.gif", "javascript:alert(1)", "",
    ]) assert.equal(giphyMediaUrl(bad), null, bad);
  });

  it("is off with the stack's placeholder, on with a real key", () => {
    giphyConfig.apiKey = "p!aceholder-with-punctuation-0123456789";
    assert.equal(giphyEnabled(), false);
    giphyConfig.apiKey = "AbCdEf0123456789AbCdEf0123456789";
    assert.equal(giphyEnabled(), true);
  });

  it("searches stickers at a family rating, keeps only safe addresses, and caches", async () => {
    giphyConfig.apiKey = "AbCdEf0123456789AbCdEf0123456789";
    clearGiphyCache();
    const calls: string[] = [];
    const fake = (async (input: string | URL | Request) => {
      calls.push(String(input));
      return new Response(JSON.stringify({ data: [
        { id: "3o7abKhOpu0NwenH3O", title: "Birthday cake", images: { fixed_width: { webp: GIF_URL, url: GIF_URL, width: "200", height: "150" }, fixed_width_small: { webp: GIF_URL, width: "100", height: "75" } } },
        { id: "evilEvilEvil1", title: "x", images: { fixed_width: { webp: "https://evil.example/a.webp", width: "200", height: "200" } } },
        { id: "bad id!", images: { fixed_width: { webp: GIF_URL, width: "200", height: "200" } } },
      ] }), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch;
    const stickers = await giphyStickers("birthday", 0, "hi", fake);
    assert.deepEqual(stickers.map((s) => s.id), ["3o7abKhOpu0NwenH3O"]);
    assert.deepEqual([stickers[0]!.width, stickers[0]!.height], [200, 150]);
    const url = new URL(calls[0]!);
    assert.equal(url.pathname, "/v1/stickers/search");
    assert.equal(url.searchParams.get("rating"), "pg");
    assert.equal(url.searchParams.get("lang"), "hi");
    assert.equal(url.searchParams.get("q"), "birthday");
    await giphyStickers("Birthday", 0, "hi", fake);
    assert.equal(calls.length, 1, "the same search is served from the cache");
    await giphyStickers("", 0, "en", fake);
    assert.equal(new URL(calls[1]!).pathname, "/v1/stickers/trending");
    const down = (async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch;
    assert.deepEqual(await giphyStickers("cricket", 0, "en", down), []);
    giphyConfig.apiKey = "";
  });
});

describe("moving stickers on Stories", () => {
  it("keep Katkee's and GIPHY's, drop anything else", async () => {
    const token = await signUp();
    const upload = await fetch(`${baseUrl}/api/v1/media/photos`, { method: "POST", headers: { "Content-Type": "image/png", ...authHeader(token) }, body: buildTestPng(4, 4) });
    const mediaId = ((await upload.json()) as { media: { id: string } }).media.id;
    const at = { x: 0.5, y: 0.5, scale: 1, rotation: 0, zIndex: 1 };
    const gif = (id: string, properties: Record<string, unknown>) => ({ id, type: "gif", ...at, properties });
    const published = await client.post("/api/v1/stories", {
      mediaId, caption: "", audience: "public", allowComments: "everyone", allowSharing: true,
      overlays: [
        gif("g1", { source: "katkee", id: "cake", url: "https://evil.example/x.webp" }),
        gif("g2", { source: "giphy", id: "3o7abKhOpu0NwenH3O", url: GIF_URL, width: 200, height: 150 }),
        gif("g3", { source: "katkee", id: "not-a-sticker" }),
        gif("g4", { source: "giphy", id: "3o7abKhOpu0NwenH3O", url: "https://evil.example/x.gif", width: 200, height: 150 }),
        gif("g5", { source: "tenor", id: "abcdef", url: GIF_URL }),
        gif("g6", { source: "giphy", id: "3o7abKhOpu0NwenH3O", url: GIF_URL, width: 2000, height: 10 }),
      ],
    }, authHeader(token));
    assert.equal(published.status, 201, JSON.stringify(published.body));
    const gifs = (published.body.story.overlays as { id: string; properties: unknown }[]).filter((o) => o.id.startsWith("g"));
    assert.deepEqual(gifs.map((o) => o.id), ["g1", "g2"]);
    assert.deepEqual(gifs[0]!.properties, { source: "katkee", id: "cake", url: "/stickers/cake.webp", width: 320, height: 320 });
    assert.deepEqual(gifs[1]!.properties, { source: "giphy", id: "3o7abKhOpu0NwenH3O", url: GIF_URL, width: 200, height: 150 });
  });
});
