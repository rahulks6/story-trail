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
import { queryOne } from "../src/db/psql";
import { mediaStorage } from "../src/modules/media/instance";
import {
  ClaudeStoryAi, MAX_AI_ALT_TEXT, StoryAiWorker, claimStories, parseUnderstanding, storyAiActive, storyWords, supportsServerFallback, understandStory,
  type StoryAiClient, type StoryForAi, type StoryUnderstanding,
} from "../src/modules/stories/story-ai";
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
    const ai = fakeAi({ topic: "Cricket", altText: "A crowd cheering at a cricket ground.", safety: "ok" });
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
    await understandStory(claimed!, fakeAi({ topic: "Travel", altText: "A plate of food.", safety: "ok" }), mediaStorage);
    const after = await row(id);
    assert.equal(after.topic, "Food");
    assert.equal(after.alt_text, "My mother's poha");
    assert.equal(after.ai_topic, "Travel");
  });

  it("a refusal is still marked done, with nothing guessed", async () => {
    const id = await postStory();
    const [claimed] = await claimStories(5, [id]);
    assert.equal(await understandStory(claimed!, fakeAi("refused"), mediaStorage), "refused");
    const after = await row(id);
    assert.equal(after.checked, true);
    assert.equal(after.topic, null);
    assert.equal(after.ai_safety, null);
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
      assert.deepEqual(result, { topic: "Devotional", altText: "A diya lit in front of a small shrine.", safety: "ok" });
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
      assert.deepEqual(result, { topic: "Food", altText: "A plate of poha.", safety: "ok" });
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
      { topic: "Cricket", altText: "Two friends at a match.", safety: "ok" });
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
