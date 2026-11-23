// Story understanding: the worker sends a new Story's picture and words to Claude and keeps the
// topic, picture description and safety reading it gets back, without overriding what the person
// chose themselves; refusals, bad keys and busy APIs each end the right way.
import "./env";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { buildApp } from "../src/app";
import { config } from "../src/config/env";
import { query, queryOne } from "../src/db/psql";
import { mediaStorage } from "../src/modules/media/instance";
import {
  AUTO_REMOVAL_REASON, ClaudeStoryAi, FRAME_POINTS, MAX_AI_ALT_TEXT, StoryAiWorker, claimStories, parseUnderstanding, storyAiActive, storyWords, supportsServerFallback, understandStory, videoFrames,
  type StoryAiClient, type StoryForAi, type StoryUnderstanding,
} from "../src/modules/stories/story-ai";
import { PHOTO_REMOVAL_REASON, checkPhotos } from "../src/modules/stories/photo-check";
import { SUSPENSION_REASON } from "../src/modules/stories/story-ai";
import { aiClearedSql } from "../src/shared/aiCleared";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
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

async function postStory(extra: Record<string, unknown> = {}): Promise<string> {
  const input = uniqueUser();
  const signup = await client.post("/api/v1/auth/signup", input);
  const auth = authHeader(signup.body.tokens.accessToken as string);
  const up = await fetch(`${baseUrl}/api/v1/media/photos`, { method: "POST", headers: { "Content-Type": "image/png", ...auth }, body: buildTestPng(8, 8) });
  const mediaId = ((await up.json()) as { media: { id: string } }).media.id;
  const res = await client.post("/api/v1/stories", { mediaId, caption: "Sunday at the ground", audience: "public", allowComments: "everyone", allowSharing: true, ...extra }, auth);
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.story.id as string;
}

const row = async (id: string) => {
  const r = (await queryOne(`SELECT topic, alt_text, ai_topic, ai_safety, ai_checked_at IS NOT NULL AS checked, ai_lease_until IS NOT NULL AS leased, ai_attempts FROM stories WHERE id = :'id'`, { id }))!;
  const yes = (v: unknown) => v === true || v === "t";
  const text = (v: unknown) => (v === null || v === undefined ? null : String(v));
  return {
    topic: text(r.topic), alt_text: text(r.alt_text), ai_topic: text(r.ai_topic), ai_safety: text(r.ai_safety),
    checked: yes(r.checked), leased: yes(r.leased), ai_attempts: Number(r.ai_attempts),
  };
};

/** A stand-in for Claude that answers (or fails) as told, and remembers what it was shown. */
function fakeAi(answer: StoryUnderstanding | "refused" | Error): StoryAiClient & { seen: StoryForAi[] } {
  const seen: StoryForAi[] = [];
  return {
    seen,
    async understand(story) {
      seen.push(story);
      if (answer instanceof Error) throw answer;
      return answer;
    },
  };
}

describe("understanding a new Story", () => {
  it("gives it the AI's topic, picture description and safety reading", async () => {
    const id = await postStory();
    const ai = fakeAi({ topic: "Cricket", altText: "A crowd cheering at a cricket ground.", safety: "ok", festival: false });
    const [claimed] = await claimStories(5, [id]);
    assert.ok(claimed);
    assert.equal(await understandStory(claimed, ai, mediaStorage), "understood");
    // Claude saw the picture itself and the caption.
    assert.equal(ai.seen.length, 1);
    assert.match(ai.seen[0]!.image.mediaType, /^image\/(jpeg|png|webp)$/);
    assert.ok(ai.seen[0]!.image.data.length > 20);
    assert.equal(ai.seen[0]!.caption, "Sunday at the ground");
    const after = await row(id);
    assert.equal(after.topic, "Cricket");
    assert.equal(after.ai_topic, "Cricket");
    assert.equal(after.alt_text, "A crowd cheering at a cricket ground.");
    assert.equal(after.ai_safety, "ok");
    assert.equal(after.checked, true);
    assert.equal(after.leased, false);
    // Done once: it isn't claimed again.
    assert.deepEqual(await claimStories(5, [id]), []);
  });

  it("keeps a topic and description the person chose themselves", async () => {
    const id = await postStory({ topic: "Food", altText: "My mother's poha" });
    const [claimed] = await claimStories(5, [id]);
    await understandStory(claimed!, fakeAi({ topic: "Travel", altText: "A plate of food.", safety: "ok", festival: false }), mediaStorage);
    const after = await row(id);
    assert.equal(after.topic, "Food");
    assert.equal(after.alt_text, "My mother's poha");
    assert.equal(after.ai_topic, "Travel");
  });

  it("a refusal is still marked done, with nothing guessed, and kept from strangers until a person looks", async () => {
    const id = await postStory();
    const [claimed] = await claimStories(5, [id]);
    assert.equal(await understandStory(claimed!, fakeAi("refused"), mediaStorage), "refused");
    const after = await row(id);
    assert.equal(after.checked, true);
    assert.equal(after.topic, null);
    assert.equal(after.ai_safety, "other");
  });

  it("a busy API puts the Story back for a later round, up to 3 tries", async () => {
    const id = await postStory();
    for (let attempt = 1; attempt <= 3; attempt++) {
      const [claimed] = await claimStories(5, [id]);
      assert.ok(claimed, `attempt ${attempt}`);
      assert.equal(await understandStory(claimed, fakeAi(new Error("overloaded")), mediaStorage), "retry");
      assert.equal((await row(id)).leased, false);
    }
    assert.equal((await row(id)).ai_attempts, 3);
    assert.deepEqual(await claimStories(5, [id]), []);
  });

  it("a held Story isn't claimed twice", async () => {
    const id = await postStory();
    assert.equal((await claimStories(5, [id])).length, 1);
    assert.deepEqual(await claimStories(5, [id]), []);
  });

  it("a key the API rejects pauses the worker and puts the Stories back", async () => {
    const ids = [await postStory(), await postStory()];
    const anthropicError = await rejectedKeyError();
    const worker = new StoryAiWorker({ ai: fakeAi(anthropicError), store: mediaStorage, everyMs: 1000, batchSize: 5, only: ids });
    const first = await worker.runOnce();
    assert.equal(first.bad_key, 1);
    for (const id of ids) assert.equal((await row(id)).leased, false);
    // Paused: the next round doesn't call the API at all.
    const second = await worker.runOnce();
    assert.equal(Object.values(second).reduce((a, b) => a + b, 0), 0);
  });
});

/** The SDK's own error for a rejected key, from a stand-in API that answers 401. */
async function rejectedKeyError(): Promise<Error> {
  const api = http.createServer((_req, res) => {
    res.writeHead(401, { "content-type": "application/json" });
    res.end(JSON.stringify({ type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }));
  });
  await new Promise<void>((resolve) => api.listen(0, resolve));
  try {
    const claude = new ClaudeStoryAi("sk-ant-test", "claude-opus-5-5", { baseURL: `http://127.0.0.1:${(api.address() as AddressInfo).port}`, maxRetries: 0 });
    return await claude.understand({ image: { data: "AAAA", mediaType: "image/png" }, caption: "", words: [], song: null, festival: null })
      .then(() => new Error("expected a rejection"), (error: Error) => error);
  } finally {
    await new Promise<void>((resolve) => api.close(() => resolve()));
  }
}

describe("festival rings, decided by the AI", () => {
  const settings = config.storyAi as { enabled: boolean; apiKey: string };
  const saved = { ...settings };
  const slug = `ai-fest-${Date.now()}`;
  before(async () => {
    // This file's own database: a real festival in the calendar on the day the tests run
    // (a festival counts from the day before to the day after: Guru Nanak Jayanti on 24 Nov 2026) would otherwise be the day's festival instead.
    await query(`DELETE FROM festivals WHERE (now() AT TIME ZONE 'Asia/Kolkata')::date BETWEEN starts_on - 1 AND ends_on + 1`);
    await query(
      `INSERT INTO festivals (slug, name, emoji, greeting, starts_on, ends_on)
       VALUES (:'slug', 'Chhath Puja', '🌅', 'Happy Chhath Puja', (now() AT TIME ZONE 'Asia/Kolkata')::date, (now() AT TIME ZONE 'Asia/Kolkata')::date)`,
      { slug },
    );
    settings.enabled = true;
    settings.apiKey = "sk-ant-test";
  });
  after(async () => {
    Object.assign(settings, saved);
    await query(`UPDATE stories SET festival = NULL WHERE festival = :'slug'`, { slug });
    await query(`DELETE FROM festivals WHERE slug = :'slug'`, { slug });
  });
  const festivalOf = async (id: string) => (await queryOne(`SELECT festival FROM stories WHERE id = :'id'`, { id }))!.festival ?? null;

  it("ignores the festival an older app sends, and asks the AI about the day's festival", async () => {
    const id = await postStory({ festival: slug });
    assert.equal(await festivalOf(id), null, "nobody chooses the ring");
    const [claimed] = await claimStories(1, [id]);
    assert.deepEqual(claimed!.festivalOfDay, { slug, name: "Chhath Puja" });
    const ai = fakeAi({ topic: "Festivals", altText: "Women offering prayers to the setting sun at a river.", safety: "ok", festival: true });
    await understandStory(claimed!, ai, mediaStorage);
    assert.equal(ai.seen[0]!.festival, "Chhath Puja");
    assert.equal(await festivalOf(id), slug);
  });

  it("an ordinary Story on the festival day, or an unsafe one, stays out of the ring", async () => {
    for (const answer of [
      { topic: "Food" as const, altText: "A plate of poha.", safety: "ok" as const, festival: false },
      { topic: null, altText: null, safety: "violence" as const, festival: true },
    ]) {
      const id = await postStory();
      const [claimed] = await claimStories(1, [id]);
      await understandStory(claimed!, fakeAi(answer), mediaStorage);
      assert.equal(await festivalOf(id), null, JSON.stringify(answer));
    }
  });
});

describe("the request to Claude", () => {
  it("sends the picture, the Story's words and the fixed topic list, and reads the answer", async () => {
    let body: Record<string, any> = {};
    let headers: http.IncomingHttpHeaders = {};
    const api = http.createServer((req, res) => {
      headers = req.headers;
      let raw = "";
      req.on("data", (chunk) => { raw += chunk; });
      req.on("end", () => {
        body = JSON.parse(raw);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({
          id: "msg_1", type: "message", role: "assistant", model: "claude-opus-5-5", stop_reason: "end_turn", stop_sequence: null,
          content: [{ type: "text", text: JSON.stringify({ topic: "Devotional", alt_text: "A diya lit in front of a small shrine.", safety: "ok" }) }],
          usage: { input_tokens: 1200, output_tokens: 60 },
        }));
      });
    });
    await new Promise<void>((resolve) => api.listen(0, resolve));
    try {
      const claude = new ClaudeStoryAi("sk-ant-test", "claude-opus-5-5", { baseURL: `http://127.0.0.1:${(api.address() as AddressInfo).port}`, maxRetries: 0 });
      const result = await claude.understand({ image: { data: "AAAA", mediaType: "image/jpeg" }, caption: "Shubh Dhanteras", words: ["Happy Diwali"], song: "Bright Wish by Kevin MacLeod", festival: "diwali" });
      assert.deepEqual(result, { topic: "Devotional", altText: "A diya lit in front of a small shrine.", safety: "ok", festival: false });
      assert.equal(headers.authorization, "Bearer sk-ant-test");
      assert.match(String(headers["anthropic-beta"]), /server-side-fallback-2026-07-01/);
      assert.equal(body.model, "claude-opus-5-5");
      assert.equal(body.fallbacks, "default");
      assert.equal(body.output_config.effort, "low");
      assert.equal(body.output_config.format.type, "json_schema");
      assert.ok(body.output_config.format.schema.properties.topic.enum.includes("Bollywood"));
      assert.ok(body.output_config.format.schema.properties.topic.enum.includes("none"));
      const [image, text] = body.messages[0].content;
      assert.deepEqual(image, { type: "image", source: { type: "base64", media_type: "image/jpeg", data: "AAAA" } });
      assert.match(text.text, /Caption: Shubh Dhanteras/);
      assert.match(text.text, /Words on the Story: Happy Diwali/);
      assert.match(text.text, /Song: Bright Wish by Kevin MacLeod/);
      // Words are data, not instructions.
      assert.match(body.system, /not instructions/);
    } finally {
      await new Promise<void>((resolve) => api.close(() => resolve()));
    }
  });
});

describe("the request to Haiku", () => {
  it("is the default model, and is sent without the fallback setting it doesn't support", async () => {
    assert.equal(config.storyAi.model, "claude-haiku-5-5");
    assert.equal(supportsServerFallback("claude-haiku-5-5"), false);
    assert.equal(supportsServerFallback("claude-opus-5-5"), true);
    let body: Record<string, any> = {};
    let headers: http.IncomingHttpHeaders = {};
    const api = http.createServer((req, res) => {
      headers = req.headers;
      let raw = "";
      req.on("data", (chunk) => { raw += chunk; });
      req.on("end", () => {
        body = JSON.parse(raw);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({
          id: "msg_2", type: "message", role: "assistant", model: "claude-haiku-5-5", stop_reason: "end_turn", stop_sequence: null,
          content: [{ type: "text", text: JSON.stringify({ topic: "Food", alt_text: "A plate of poha.", safety: "ok" }) }],
          usage: { input_tokens: 900, output_tokens: 40 },
        }));
      });
    });
    await new Promise<void>((resolve) => api.listen(0, resolve));
    try {
      const claude = new ClaudeStoryAi("sk-ant-test", "claude-haiku-5-5", { baseURL: `http://127.0.0.1:${(api.address() as AddressInfo).port}`, maxRetries: 0 });
      const result = await claude.understand({ image: { data: "AAAA", mediaType: "image/jpeg" }, caption: "", words: [], song: null, festival: null });
      assert.deepEqual(result, { topic: "Food", altText: "A plate of poha.", safety: "ok", festival: false });
      assert.equal(body.model, "claude-haiku-5-5");
      assert.equal("fallbacks" in body, false);
      assert.doesNotMatch(String(headers["anthropic-beta"] ?? ""), /server-side-fallback/);
      assert.equal(body.output_config.effort, "low");
    } finally {
      await new Promise<void>((resolve) => api.close(() => resolve()));
    }
  });
});

describe("reading the answer", () => {
  it("keeps only listed topics and safety readings, and tidies the description", () => {
    assert.deepEqual(parseUnderstanding(JSON.stringify({ topic: "cricket", alt_text: "  Two  friends\nat a match. ", safety: "ok" })),
      { topic: "Cricket", altText: "Two friends at a match.", safety: "ok", festival: false });
    assert.equal(parseUnderstanding(JSON.stringify({ topic: "Festivals", alt_text: "x", safety: "ok", festival: true }))!.festival, true);
    assert.equal(parseUnderstanding(JSON.stringify({ topic: "none", alt_text: "x", safety: "ok" }))!.topic, null);
    assert.equal(parseUnderstanding(JSON.stringify({ topic: "Astrology", alt_text: "x", safety: "ok" }))!.topic, null);
    assert.equal(parseUnderstanding(JSON.stringify({ topic: "Food", alt_text: "", safety: "ok" }))!.altText, null);
    assert.equal(parseUnderstanding(JSON.stringify({ topic: "Food", alt_text: "a".repeat(900), safety: "ok" }))!.altText!.length, MAX_AI_ALT_TEXT);
    assert.equal(parseUnderstanding(JSON.stringify({ topic: "Food", alt_text: "x", safety: "weird" })), null);
    assert.equal(parseUnderstanding("not json"), null);
  });

  it("reads the words written on a Story from its text overlays", () => {
    assert.deepEqual(storyWords([
      { type: "text", properties: { text: " Happy Diwali " } },
      { type: "emoji", properties: { emoji: "🪔" } },
      { type: "text", properties: { text: "" } },
      { type: "text", properties: { text: "from Pune" } },
    ]), ["Happy Diwali", "from Pune"]);
    assert.deepEqual(storyWords(null), []);
  });

  it("is on only when turned on and given a real Anthropic key", () => {
    const saved = { ...config.storyAi };
    try {
      Object.assign(config.storyAi, { enabled: true, apiKey: "placeholder-from-secrets-manager" });
      assert.equal(storyAiActive(), false);
      Object.assign(config.storyAi, { enabled: true, apiKey: "sk-ant-api03-abc" });
      assert.equal(storyAiActive(), true);
      Object.assign(config.storyAi, { enabled: false });
      assert.equal(storyAiActive(), false);
    } finally {
      Object.assign(config.storyAi, saved);
    }
  });
});

describe("nudity and sexual content", () => {
  it("a Story the check finds it in is taken down at once, and its owner told and able to appeal", async () => {
    const id = await postStory();
    const [claimed] = await claimStories(5, [id]);
    assert.equal(await understandStory(claimed!, fakeAi({ topic: null, altText: "A person.", safety: "sexual", festival: false }), mediaStorage), "removed");
    const story = (await queryOne(`SELECT owner_id, deleted_at IS NOT NULL AS gone, moderation_removed_at IS NOT NULL AS moderated FROM stories WHERE id = :'id'`, { id }))!;
    assert.equal(story.gone, "t");
    assert.equal(story.moderated, "t");
    const notice = await queryOne(
      `SELECT a.action, a.reason, a.actor_id, moderation_action_appealable(a.action) AS appealable
       FROM moderation_notices n JOIN moderation_actions a ON a.id = n.action_id WHERE n.user_id = :'owner' AND a.target_id = :'id'`,
      { owner: story.owner_id as string, id },
    );
    assert.ok(notice);
    assert.equal(notice.action, "remove");
    assert.equal(notice.reason, AUTO_REMOVAL_REASON);
    assert.equal(notice.actor_id, null);
    assert.equal(notice.appealable, "t");
  });

  it("strangers see a public Story only once the check found nothing unsafe; with the check off, as before", async () => {
    const saved = { ...config.storyAi };
    const cleared = async (id: string) => (await queryOne(`SELECT ${aiClearedSql("s")} AS ok FROM stories s WHERE s.id = :'id'`, { id }))!.ok === "t";
    try {
      Object.assign(config.storyAi, { enabled: true, apiKey: "sk-ant-api03-test" });
      const waiting = await postStory();
      assert.equal(await cleared(waiting), false, "not until it has been checked");
      const [a] = await claimStories(5, [waiting]);
      await understandStory(a!, fakeAi({ topic: null, altText: null, safety: "ok", festival: false }), mediaStorage);
      assert.equal(await cleared(waiting), true);
      const unsure = await postStory();
      const [b] = await claimStories(5, [unsure]);
      await understandStory(b!, fakeAi("refused"), mediaStorage);
      assert.equal(await cleared(unsure), false, "a declined look stays away from strangers");
      Object.assign(config.storyAi, { enabled: false });
      assert.equal(aiClearedSql("s"), "true");
    } finally {
      Object.assign(config.storyAi, saved);
    }
  });

  it("a video is judged by frames from all through it, not its cover alone", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "katkee-video-"));
    const file = path.join(dir, "v.mp4");
    execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=size=320x240:rate=10", "-t", "4", "-pix_fmt", "yuv420p", file]);
    const key = `m/${crypto.randomUUID()}/video_480.mp4`;
    await mediaStorage.putFile(key, file, "video/mp4");
    const media = { kind: "video", durationMs: 4000, variants: { video_480: { key, byteSize: fs.statSync(file).size, mimeType: "video/mp4" } } } as never;
    const frames = await videoFrames(media, mediaStorage);
    assert.equal(frames.length, FRAME_POINTS.length);
    assert.ok(frames.every((f) => f.mediaType === "image/jpeg" && f.data.length > 100));
    // A photo has none; a rendition that can't be read gives none, and the cover is still checked.
    assert.deepEqual(await videoFrames({ kind: "photo", variants: {} } as never, mediaStorage), []);
    assert.deepEqual(await videoFrames({ kind: "video", durationMs: 4000, variants: { video_480: { key: `m/${crypto.randomUUID()}/video_480.mp4`, byteSize: 10, mimeType: "video/mp4" } } } as never, mediaStorage), []);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("a new profile photo showing it is taken off the profile, with a notice; a fine one stays, and each is looked at once", async () => {
    const setPhoto = async () => {
      const input = uniqueUser();
      const signup = await client.post("/api/v1/auth/signup", input);
      const auth = authHeader(signup.body.tokens.accessToken as string);
      const up = await fetch(`${baseUrl}/api/v1/media/photos`, { method: "POST", headers: { "Content-Type": "image/png", ...auth }, body: buildTestPng(8, 8) });
      const mediaId = ((await up.json()) as { media: { id: string } }).media.id;
      const res = await client.patch("/api/v1/users/me", { avatarMediaId: mediaId }, auth);
      assert.equal(res.status, 200, JSON.stringify(res.body));
      return { id: signup.body.user.id as string, mediaId };
    };
    const bad = await setPhoto();
    const good = await setPhoto();
    const unsafe = fakeAi({ topic: null, altText: null, safety: "sexual", festival: false });
    assert.deepEqual(await checkPhotos(unsafe, mediaStorage, 5, [bad.id]), { checked: 1, removed: 1 });
    assert.equal((await queryOne(`SELECT avatar_media_id FROM users WHERE id = :'id'`, { id: bad.id }))!.avatar_media_id, null);
    const notice = await queryOne(`SELECT a.action, a.reason FROM moderation_notices n JOIN moderation_actions a ON a.id = n.action_id WHERE n.user_id = :'id'`, { id: bad.id });
    assert.equal(notice?.action, "remove_profile_photo");
    assert.equal(notice?.reason, PHOTO_REMOVAL_REASON);
    const fine = fakeAi({ topic: null, altText: null, safety: "ok", festival: false });
    assert.deepEqual(await checkPhotos(fine, mediaStorage, 5, [good.id]), { checked: 1, removed: 0 });
    assert.equal((await queryOne(`SELECT avatar_media_id FROM users WHERE id = :'id'`, { id: good.id }))!.avatar_media_id, good.mediaId);
    assert.deepEqual(await checkPhotos(fine, mediaStorage, 5, [good.id]), { checked: 0, removed: 0 });
  });

  it("an account whose uploads are taken down twice in a day is suspended; once is a warning", async () => {
    const input = uniqueUser();
    const signup = await client.post("/api/v1/auth/signup", input);
    const auth = authHeader(signup.body.tokens.accessToken as string);
    const userId = signup.body.user.id as string;
    const post = async () => {
      const up = await fetch(`${baseUrl}/api/v1/media/photos`, { method: "POST", headers: { "Content-Type": "image/png", ...auth }, body: buildTestPng(8, 8) });
      const mediaId = ((await up.json()) as { media: { id: string } }).media.id;
      const res = await client.post("/api/v1/stories", { mediaId, caption: "", audience: "public", allowComments: "everyone", allowSharing: true }, auth);
      return res.body.story.id as string;
    };
    const unsafe = fakeAi({ topic: null, altText: null, safety: "sexual", festival: false });
    const state = async () => (await queryOne(`SELECT moderation_state, is_active FROM users WHERE id = :'id'`, { id: userId }))!;
    const first = await post();
    const second = await post();
    const [a] = await claimStories(5, [first]);
    await understandStory(a!, unsafe, mediaStorage);
    assert.equal((await state()).moderation_state, "ACTIVE", "one removal: the account stays");
    const [b] = await claimStories(5, [second]);
    await understandStory(b!, unsafe, mediaStorage);
    const after = await state();
    assert.equal(after.moderation_state, "SUSPENDED");
    assert.equal(after.is_active, "f");
    const action = await queryOne(`SELECT action, reason, actor_id FROM moderation_actions WHERE target_type = 'user' AND target_id = :'id'`, { id: userId });
    assert.equal(action?.action, "suspend");
    assert.equal(action?.reason, SUSPENSION_REASON);
    assert.equal(action?.actor_id, null);
    // Its sessions end at once.
    assert.equal((await client.get("/api/v1/users/me", auth)).status >= 400, true);
  });
});
