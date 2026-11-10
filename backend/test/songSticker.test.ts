import "./env";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { buildApp } from "../src/app";
import { authHeader, makeClient, uniqueUser } from "./helpers";
import { buildTestPng } from "./fixtures";
import { allowedArtworkUrl, lookupSong, parseSongUrl, tidyVideoTitle } from "../src/modules/stories/song-links";

// Song stickers: a popular song as a link to Spotify / YouTube Music / YouTube, never played by Katkee.
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

/** A stand-in for Spotify's and YouTube's public pages, so tests never touch the internet. */
function fakeFetch(pages: Record<string, { status?: number; body?: string; headers?: Record<string, string> }>): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input);
    const page = Object.entries(pages).find(([prefix]) => url.startsWith(prefix))?.[1];
    if (!page) return new Response("not found", { status: 404 });
    return new Response(page.body ?? "", { status: page.status ?? 200, headers: page.headers ?? {} });
  }) as typeof fetch;
}

const SPOTIFY_ID = "4cOdK2wGLETKBW3PvgPWqT";
const spotifyPage = `<html><head>
  <meta property="og:title" content="Kesariya (From &quot;Brahmastra&quot;)"/>
  <meta property="og:description" content="Pritam, Arijit Singh · Kesariya · Song · 2022"/>
  <meta name="music:musician_description" content="Pritam, Arijit Singh"/>
  <meta property="og:image" content="https://i.scdn.co/image/ab67616d0000b273abc"/>
</head></html>`;

describe("song links", () => {
  it("recognise Spotify, YouTube Music and YouTube songs, as clean canonical links", () => {
    assert.deepEqual(parseSongUrl(`https://open.spotify.com/track/${SPOTIFY_ID}?si=abc123`), { provider: "spotify", url: `https://open.spotify.com/track/${SPOTIFY_ID}` });
    assert.deepEqual(parseSongUrl(`open.spotify.com/intl-hi/track/${SPOTIFY_ID}`), { provider: "spotify", url: `https://open.spotify.com/track/${SPOTIFY_ID}` });
    assert.deepEqual(parseSongUrl("https://music.youtube.com/watch?v=BddP6PYo2gs&si=x"), { provider: "youtube_music", url: "https://music.youtube.com/watch?v=BddP6PYo2gs" });
    assert.deepEqual(parseSongUrl("https://youtu.be/BddP6PYo2gs?t=10"), { provider: "youtube", url: "https://www.youtube.com/watch?v=BddP6PYo2gs" });
    assert.deepEqual(parseSongUrl("https://m.youtube.com/watch?v=BddP6PYo2gs"), { provider: "youtube", url: "https://www.youtube.com/watch?v=BddP6PYo2gs" });
    assert.deepEqual(parseSongUrl("https://www.youtube.com/shorts/BddP6PYo2gs"), { provider: "youtube", url: "https://www.youtube.com/watch?v=BddP6PYo2gs" });
    // Not a song on a supported service.
    for (const bad of [`https://open.spotify.com/album/${SPOTIFY_ID}`, "https://evil.example/track/x", "https://open.spotify.com.evil.example/track/" + SPOTIFY_ID, "https://user@open.spotify.com/track/" + SPOTIFY_ID, "javascript:alert(1)", "https://www.youtube.com/watch?v=short", 42]) {
      assert.equal(parseSongUrl(bad), null, String(bad));
    }
  });

  it("accept covers only from the services' own image hosts", () => {
    assert.equal(allowedArtworkUrl("https://i.scdn.co/image/abc"), "https://i.scdn.co/image/abc");
    assert.equal(allowedArtworkUrl("https://i.ytimg.com/vi/x/hqdefault.jpg"), "https://i.ytimg.com/vi/x/hqdefault.jpg");
    assert.equal(allowedArtworkUrl("https://image-cdn-ak.spotifycdn.com/image/abc"), "https://image-cdn-ak.spotifycdn.com/image/abc");
    assert.equal(allowedArtworkUrl("http://i.scdn.co/image/abc"), null);
    assert.equal(allowedArtworkUrl("https://evil.example/cover.jpg"), null);
    assert.equal(allowedArtworkUrl("https://i.scdn.co.evil.example/x"), null);
  });

  it("tidy video titles", () => {
    assert.equal(tidyVideoTitle("Kesariya (Official Video) | Brahmastra"), "Kesariya | Brahmastra");
    assert.equal(tidyVideoTitle("Song [Lyric Video]"), "Song");
    assert.equal(tidyVideoTitle("Tum Hi Ho (Unplugged)"), "Tum Hi Ho (Unplugged)");
  });

  it("look up a Spotify song's title, artist and cover", async () => {
    const song = await lookupSong(`https://open.spotify.com/track/${SPOTIFY_ID}?si=1`, fakeFetch({ "https://open.spotify.com/track/": { body: spotifyPage } }));
    assert.deepEqual(song, { provider: "spotify", url: `https://open.spotify.com/track/${SPOTIFY_ID}`, title: 'Kesariya (From "Brahmastra")', artist: "Pritam, Arijit Singh", artworkUrl: "https://i.scdn.co/image/ab67616d0000b273abc" });
  });

  it("follow a spotify.link short link to the track", async () => {
    const song = await lookupSong("https://spotify.link/AbCd123", fakeFetch({
      "https://spotify.link/": { status: 302, headers: { location: `https://open.spotify.com/track/${SPOTIFY_ID}?si=z` } },
      "https://open.spotify.com/track/": { body: spotifyPage },
    }));
    assert.equal(song.url, `https://open.spotify.com/track/${SPOTIFY_ID}`);
  });

  it("look up a YouTube Music song: the '- Topic' channel is the artist", async () => {
    const song = await lookupSong("https://music.youtube.com/watch?v=BddP6PYo2gs", fakeFetch({
      "https://www.youtube.com/oembed": { body: JSON.stringify({ title: "Kesariya", author_name: "Arijit Singh - Topic", thumbnail_url: "https://i.ytimg.com/vi/BddP6PYo2gs/hqdefault.jpg" }) },
    }));
    assert.deepEqual(song, { provider: "youtube_music", url: "https://music.youtube.com/watch?v=BddP6PYo2gs", title: "Kesariya", artist: "Arijit Singh", artworkUrl: "https://i.ytimg.com/vi/BddP6PYo2gs/hqdefault.jpg" });
  });

  it("keep a label's full title, and drop the artist's own name from 'Artist - Song'", async () => {
    const label = await lookupSong("https://youtu.be/AAAAAAAAAAA", fakeFetch({
      "https://www.youtube.com/oembed": { body: JSON.stringify({ title: "Kesariya - Brahmāstra | Ranbir Kapoor (Official Video)", author_name: "T-Series" }) },
    }));
    assert.equal(label.title, "Kesariya - Brahmāstra | Ranbir Kapoor");
    assert.equal(label.artist, "T-Series");
    assert.equal(label.artworkUrl, null);
    const own = await lookupSong("https://youtu.be/BBBBBBBBBBB", fakeFetch({
      "https://www.youtube.com/oembed": { body: JSON.stringify({ title: "Arijit Singh - Tum Hi Ho", author_name: "Arijit Singh" }) },
    }));
    assert.equal(own.title, "Tum Hi Ho");
  });

  it("explain a link that isn't a song, and a service that can't be reached", async () => {
    await assert.rejects(lookupSong("https://example.com/song", fakeFetch({})), (e: any) => e.status === 422);
    await assert.rejects(lookupSong("https://youtu.be/CCCCCCCCCCC", fakeFetch({})), (e: any) => e.status === 404);
    const offline = (async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch;
    await assert.rejects(lookupSong("https://youtu.be/DDDDDDDDDDD", offline), (e: any) => e.status === 503);
  });
});

describe("song stickers on Stories", () => {
  it("publish with the canonical link, a safe cover only, and one per Story", async () => {
    const input = uniqueUser();
    const res = await client.post("/api/v1/auth/signup", input);
    const token = res.body.tokens.accessToken as string;
    const upload = await fetch(`${baseUrl}/api/v1/media/photos`, { method: "POST", headers: { "Content-Type": "image/png", ...authHeader(token) }, body: buildTestPng(4, 4) });
    const mediaId = ((await upload.json()) as { media: { id: string } }).media.id;
    const at = { x: 0.5, y: 0.5, scale: 1, rotation: 0, zIndex: 1 };
    const song = (id: string, url: string, artworkUrl: string) => ({ id, type: "song", ...at, properties: { url, title: "  Kesariya  ", artist: "Arijit Singh", artworkUrl } });
    const published = await client.post("/api/v1/stories", {
      mediaId, caption: "", audience: "public", allowComments: "everyone", allowSharing: true,
      overlays: [
        song("song-1", `https://open.spotify.com/track/${SPOTIFY_ID}?si=track`, "https://evil.example/cover.jpg"),
        song("song-2", "https://youtu.be/BddP6PYo2gs", "https://i.ytimg.com/vi/x/hq.jpg"),
        { id: "song-3", type: "song", ...at, properties: { url: "https://evil.example/song", title: "Nope", artist: "", artworkUrl: null } },
      ],
    }, authHeader(token));
    assert.equal(published.status, 201, JSON.stringify(published.body));
    const songs = (published.body.story.overlays as any[]).filter((o) => o.type === "song");
    assert.equal(songs.length, 1, "one song sticker per Story; an unsupported link is dropped");
    assert.deepEqual(songs[0].properties, { provider: "spotify", url: `https://open.spotify.com/track/${SPOTIFY_ID}`, title: "Kesariya", artist: "Arijit Singh", artworkUrl: null });
  });

  it("the lookup endpoint needs sign-in and a song link", async () => {
    assert.equal((await client.post("/api/v1/stories/song-lookup", { url: "https://youtu.be/BddP6PYo2gs" })).status, 401);
    const input = uniqueUser();
    const token = (await client.post("/api/v1/auth/signup", input)).body.tokens.accessToken as string;
    assert.equal((await client.post("/api/v1/stories/song-lookup", { url: "https://example.com/x" }, authHeader(token))).status, 422);
  });
});
