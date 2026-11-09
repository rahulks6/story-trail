#!/usr/bin/env node
/**
 * Translates the app's English catalogue (src/i18n/en.ts) into another language with Claude, and
 * writes src/i18n/<lang>.ts. Resumable: keys already translated in <lang>.ts are kept, so a run
 * that stops (or a later English change) only translates what's missing.
 *
 * Every translation is checked before it's kept: the same {placeholders} and <marked> parts as the
 * English, no empty text, and the plural forms the language needs. Anything that fails is asked
 * again once, then left out (the typecheck then names it).
 *
 * Usage: ANTHROPIC_API_KEY=... node scripts/translate-catalog.cjs es [pt id fr de ar]
 */
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const I18N = path.join(__dirname, "../src/i18n");
const MODEL = process.env.TRANSLATE_MODEL || "claude-haiku-5-5";
const BATCH = 60;
const PARALLEL = 4;

const LANGS = {
  es: { label: "Spanish (Español)", name: "Spanish (neutral Latin American, as in Instagram and WhatsApp for Latin America)", plurals: ["one", "many", "other"], terms: "Story/Stories = historia/historias; Highlights = Destacadas; Follow = Seguir; Following = Siguiendo; Followers = Seguidores; Close Friends = Mejores amigos; Like = Me gusta; Messages = Mensajes; Explore = Explorar; Layout = Layout. Use tú, not usted." },
  pt: { label: "Portuguese (Português)", name: "Brazilian Portuguese (as in Instagram and WhatsApp for Brazil)", plurals: ["one", "many", "other"], terms: "Story/Stories = story/stories (as Instagram Brazil says); Highlights = Destaques; Follow = Seguir; Following = Seguindo; Followers = Seguidores; Close Friends = Melhores Amigos; Like = Curtir; Messages = Mensagens; Explore = Explorar. Use você." },
  id: { label: "Indonesian (Bahasa Indonesia)", name: "Indonesian (as in Instagram and WhatsApp for Indonesia)", plurals: ["other"], terms: "Story/Stories = Story; Highlights = Sorotan; Follow = Ikuti; Following = Mengikuti; Followers = Pengikut; Close Friends = Teman Dekat; Like = Suka; Messages = Pesan; Explore = Jelajahi. Use kamu, friendly." },
  fr: { label: "French (Français)", name: "French (France, as in Instagram and WhatsApp in French)", plurals: ["one", "many", "other"], terms: "Story/Stories = story/stories; Highlights = Stories à la une; Follow = Suivre; Following = Abonnements (tab) / Suivi(e) (state); Followers = Abonnés; Close Friends = Amis proches; Like = J'aime; Messages = Messages; Explore = Explorer. Use tu. French typography: a space before : ; ? !" },
  de: { label: "German (Deutsch)", name: "German (as in Instagram and WhatsApp in German)", plurals: ["one", "other"], terms: "Story/Stories = Story/Storys; Highlights = Highlights; Follow = Folgen; Following = Gefolgt (state) / Abonniert (tab); Followers = Follower; Close Friends = Enge Freunde; Like = Gefällt mir; Messages = Nachrichten; Explore = Entdecken. Use du." },
  ar: { label: "Arabic (العربية)", name: "Modern Standard Arabic, simple and friendly (as in Instagram and WhatsApp in Arabic)", plurals: ["zero", "one", "two", "few", "many", "other"], terms: "Story/Stories = قصة/القصص; Highlights = اللحظات البارزة; Follow = متابعة; Following = متابَعون (tab) / تتابعه (state); Followers = المتابِعون; Close Friends = الأصدقاء المقربون; Like = إعجاب; Messages = الرسائل; Explore = استكشاف. Western digits (0-9) are fine." },
};

/** A TypeScript catalogue file, evaluated: { key: string | { one, other, ... } }. */
function loadCatalogue(file, exportName) {
  if (!fs.existsSync(file)) return {};
  const js = ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const module = { exports: {} };
  new Function("module", "exports", "require", js)(module, module.exports, () => ({}));
  return module.exports[exportName] ?? {};
}

const placeholders = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
const tags = (s) => [...s.matchAll(/<\/?(\w+)>/g)].map((m) => m[0]).sort().join(",");
const texts = (v) => (typeof v === "string" ? [v] : Object.values(v));

/** Why a translation can't be kept, or null. */
function problem(english, translated, lang) {
  if (translated === undefined || translated === null) return "missing";
  const plural = typeof english !== "string";
  if (plural !== (typeof translated !== "string")) return plural ? "needs plural forms" : "must be one string";
  for (const s of texts(translated)) if (typeof s !== "string" || !s.trim()) return "empty";
  const englishPlaceholders = new Set(texts(english).flatMap((s) => placeholders(s).split(",").filter(Boolean)));
  const englishTags = tags(texts(english)[texts(english).length - 1]);
  if (plural) {
    for (const category of LANGS[lang].plurals) if (typeof translated[category] !== "string") return `plural form "${category}" missing`;
    for (const [category, s] of Object.entries(translated)) {
      if (!["zero", "one", "two", "few", "many", "other"].includes(category)) return `unknown plural form ${category}`;
      for (const name of placeholders(s).split(",").filter(Boolean)) if (!englishPlaceholders.has(name) && name !== "count") return `unknown {${name}}`;
    }
    const other = placeholders(translated.other).split(",").filter(Boolean);
    for (const name of englishPlaceholders) if (name !== "count" && !other.includes(name)) return `{${name}} dropped`;
    return null;
  }
  if (placeholders(english) !== placeholders(translated)) return `placeholders differ: ${placeholders(english)} vs ${placeholders(translated)}`;
  if (englishTags !== tags(translated)) return "marked parts differ";
  return null;
}

async function ask(lang, entries, apiKey) {
  const spec = LANGS[lang];
  const system = `You translate the user-interface text of Katkee, a Stories and chat app (like Instagram Stories plus WhatsApp), from English into ${spec.name}.
Rules:
- Sound like a polished, popular social app in that language: short, natural, friendly. Never word-for-word.
- Keep exactly: the name Katkee (Latin letters), every {placeholder} (move it where the sentence needs it), every <tag>…</tag> marked part, @usernames, URLs, emails and emoji.
- Use these feature words consistently: ${spec.terms}
- Keep the meaning, length and tone of buttons short; don't add punctuation the English lacks.
- Plural entries are objects. Give exactly these forms for this language: ${spec.plurals.join(", ")}. Each form is a full phrase; {count} is the number.
Return every key you were given, translated, through the submit tool.`;
  const body = {
    model: MODEL,
    max_tokens: 16000,
    system,
    tools: [{ name: "submit", description: "The translations, keyed exactly as given.", input_schema: { type: "object", properties: { translations: { type: "object", additionalProperties: true } }, required: ["translations"] } }],
    tool_choice: { type: "tool", name: "submit" },
    messages: [{ role: "user", content: `Translate these entries (JSON, key: English):\n${JSON.stringify(entries, null, 1)}` }],
  };
  for (let attempt = 1; ; attempt++) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      const json = await res.json();
      usage.input += json.usage?.input_tokens ?? 0;
      usage.output += json.usage?.output_tokens ?? 0;
      const tool = json.content.find((c) => c.type === "tool_use");
      return tool?.input?.translations ?? {};
    }
    const text = await res.text();
    if (res.status === 400 && /credit balance/i.test(text)) throw new Error("The Anthropic account is out of credit: top it up and run again (finished keys are kept).");
    if ((res.status === 429 || res.status >= 500) && attempt < 6) { await new Promise((r) => setTimeout(r, 4000 * attempt)); continue; }
    throw new Error(`Anthropic API ${res.status}: ${text.slice(0, 300)}`);
  }
}

const usage = { input: 0, output: 0 };

function write(lang, english, done) {
  const lines = [
    "/**",
    ` * ${LANGS[lang].label}: every key in en.ts (the typecheck fails on a missing one). Translated`,
    " * by scripts/translate-catalog.cjs; placeholders and <marked> parts are kept as in English.",
    " * Edit freely: the script only fills in keys that are missing.",
    " */",
    'import type { Catalogue } from "./types";',
    "",
    `export const ${lang}: Partial<Catalogue> = {`,
  ];
  for (const key of Object.keys(english)) {
    if (!(key in done)) continue;
    lines.push(`  ${JSON.stringify(key)}: ${JSON.stringify(done[key])},`);
  }
  lines.push("};", "");
  fs.writeFileSync(path.join(I18N, `${lang}.ts`), lines.join("\n"));
}

async function translate(lang, apiKey) {
  const english = loadCatalogue(path.join(I18N, "en.ts"), "en");
  const done = loadCatalogue(path.join(I18N, `${lang}.ts`), lang);
  for (const key of Object.keys(done)) if (!(key in english) || problem(english[key], done[key], lang)) delete done[key];
  let missing = Object.keys(english).filter((k) => !(k in done));
  // A trial run: TRANSLATE_LIMIT=60 translates only that many.
  if (process.env.TRANSLATE_LIMIT) missing = missing.slice(0, Number(process.env.TRANSLATE_LIMIT));
  console.log(`${lang}: ${Object.keys(done).length} kept, ${missing.length} to translate`);
  for (let round = 1; round <= 2 && missing.length; round++) {
    const batches = [];
    for (let i = 0; i < missing.length; i += BATCH) batches.push(missing.slice(i, i + BATCH));
    let next = 0;
    const worker = async () => {
      while (next < batches.length) {
        const batch = batches[next++];
        const result = await ask(lang, Object.fromEntries(batch.map((k) => [k, english[k]])), apiKey);
        for (const key of batch) {
          const why = problem(english[key], result[key], lang);
          if (!why) done[key] = result[key];
          else if (round === 2) console.log(`  ${lang} ${key}: ${why}`);
        }
        write(lang, english, done); // saved as it goes, so a stop loses at most a batch
      }
    };
    await Promise.all(Array.from({ length: PARALLEL }, worker));
    missing = missing.filter((k) => !(k in done));
  }
  console.log(`${lang}: ${Object.keys(done).length} of ${Object.keys(english).length} translated`);
  return missing.length;
}

/**
 * Without the API: --export writes the English as numbered lines (number, tab, JSON value) for a
 * person to translate; --import reads lines in the same shape (number, tab, JSON translation),
 * checks each like the API's, and adds the good ones to <lang>.ts.
 *   node scripts/translate-catalog.cjs --export <dir>
 *   node scripts/translate-catalog.cjs --import es <file>...
 */
function exportLines(dir) {
  const english = loadCatalogue(path.join(I18N, "en.ts"), "en");
  fs.mkdirSync(dir, { recursive: true });
  const keys = Object.keys(english);
  fs.writeFileSync(path.join(dir, "keys.json"), JSON.stringify(keys));
  fs.writeFileSync(path.join(dir, "en.txt"), keys.map((k, i) => `${i}\t${JSON.stringify(english[k])}`).join("\n") + "\n");
  console.log(`${keys.length} lines in ${dir}/en.txt`);
}

function importLines(lang, files) {
  const english = loadCatalogue(path.join(I18N, "en.ts"), "en");
  const keys = Object.keys(english);
  const done = loadCatalogue(path.join(I18N, `${lang}.ts`), lang);
  let added = 0;
  const bad = [];
  for (const file of files) {
    for (const line of fs.readFileSync(file, "utf8").split("\n")) {
      if (!line.trim()) continue;
      // "12<tab>json" or "12|json".
      const match = /^(\d+)[\t|](.*)$/.exec(line);
      if (!match) { bad.push(`${line.slice(0, 20)}: not a numbered line`); continue; }
      const index = Number(match[1]);
      const tab = match[1].length;
      const key = keys[index];
      let value;
      try { value = JSON.parse(line.slice(tab + 1)); } catch { bad.push(`${index}: not JSON`); continue; }
      if (!key) { bad.push(`${index}: no such line`); continue; }
      const why = problem(english[key], value, lang);
      if (why) { bad.push(`${index} ${key}: ${why}`); continue; }
      if (!(key in done)) added++;
      done[key] = value;
    }
  }
  write(lang, english, done);
  console.log(`${lang}: +${added}, ${Object.keys(done).length} of ${keys.length} done`);
  for (const b of bad) console.log(`  rejected ${b}`);
  return bad.length;
}

(async () => {
  if (process.argv[2] === "--export") return exportLines(process.argv[3]);
  if (process.argv[2] === "--import") { process.exit(importLines(process.argv[3], process.argv.slice(4)) ? 1 : 0); }
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("Set ANTHROPIC_API_KEY.");
  const langs = process.argv.slice(2);
  if (!langs.length || langs.some((l) => !LANGS[l])) throw new Error(`Languages: ${Object.keys(LANGS).join(" ")}`);
  let left = 0;
  for (const lang of langs) left += await translate(lang, apiKey);
  console.log(`tokens: ${usage.input} in, ${usage.output} out`);
  process.exit(left ? 1 : 0);
})().catch((e) => { console.error(e.message); process.exit(1); });
