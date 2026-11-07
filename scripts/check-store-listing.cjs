#!/usr/bin/env node
// Checks the Google Play listing text in docs/PLAY_STORE_LISTING.md against Play's limits: app
// name 30 characters, short description 80, full description 4,000 (Play counts characters, so
// Devanagari counts per code point here too). Run: node scripts/check-store-listing.cjs
const fs = require("node:fs");
const path = require("node:path");

const LIMITS = { title: 30, short: 80, full: 4000 };
const text = fs.readFileSync(path.join(__dirname, "../docs/PLAY_STORE_LISTING.md"), "utf8");
const fields = [...text.matchAll(/<!-- field:(\w+):(\w+) -->\n([\s\S]*?)\n<!-- \/field -->/g)];
let failed = false;
for (const [, kind, lang, value] of fields) {
  const length = [...value].length;
  const limit = LIMITS[kind];
  const ok = limit !== undefined && length <= limit && length > 0;
  if (!ok) failed = true;
  console.log(`${ok ? "ok  " : "FAIL"} ${lang} ${kind.padEnd(5)} ${String(length).padStart(4)} / ${limit}`);
}
if (fields.length !== 9) { console.log(`expected 9 fields (3 languages x 3), found ${fields.length}`); failed = true; }
process.exit(failed ? 1 : 0);
