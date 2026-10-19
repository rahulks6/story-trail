#!/usr/bin/env node
/**
 * Adds one openly licensed song to Katkee's music catalogue.
 *
 *   node scripts/add-music.cjs <file> --title "..." --artist "..." --license "CC BY 4.0" \
 *     --license-url https://creativecommons.org/licenses/by/4.0/ --source-url https://... [--mood Happy] [--upload]
 *
 * It converts the file to a 128 kbps MP3 (at most 3 minutes), reads its length, and appends
 * it to backend/migrations/music/catalogue.json with the credit shown on Stories. With
 * --upload it also copies the MP3 to the media bucket (MUSIC_BUCKET, default the production
 * one) at m/<id>/audio.mp3. The next deploy's migrate step adds it to the picker.
 *
 * Only add songs whose licence allows use in an app without asking (CC0, CC BY, or a
 * licence you bought that says so), and keep the source link.
 */
const { execFileSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--") && !args[args.indexOf(a) - 1]?.startsWith("--"));
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const title = opt("title"), artist = opt("artist"), license = opt("license"), licenseUrl = opt("license-url"), sourceUrl = opt("source-url");
const mood = opt("mood") ?? "";
if (!file || !fs.existsSync(file) || !title || !artist || !license || !licenseUrl || !sourceUrl) {
  console.error("Usage: node scripts/add-music.cjs <file> --title T --artist A --license L --license-url URL --source-url URL [--mood M] [--upload]");
  process.exit(1);
}
if (!/^(CC0( 1\.0)?|CC BY \d\.\d|CC BY-SA \d\.\d|Licensed \(.+\))$/.test(license)) {
  console.error(`Refusing licence "${license}": use CC0, CC BY or CC BY-SA (no NC/ND), or "Licensed (…)" for a bought licence.`);
  process.exit(1);
}

const catalogueFile = path.join(__dirname, "..", "backend", "migrations", "music", "catalogue.json");
const catalogue = JSON.parse(fs.readFileSync(catalogueFile, "utf8"));
if (catalogue.some((t) => t.sourceUrl === sourceUrl)) {
  console.error("Already in the catalogue:", sourceUrl);
  process.exit(1);
}

const id = crypto.randomUUID();
const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "katkee-music-")), "audio.mp3");
execFileSync("ffmpeg", ["-v", "error", "-y", "-i", file, "-t", "180", "-vn", "-ac", "2", "-ar", "44100", "-b:a", "128k", "-map_metadata", "-1", out]);
const seconds = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", out], { encoding: "utf8" }).trim());
if (!(seconds > 3)) throw new Error("Couldn't read the song's length");
const storageKey = `m/${id}/audio.mp3`;
const entry = {
  id, title, artist, mood,
  durationMs: Math.floor(seconds * 1000),
  storageKey, mimeType: "audio/mpeg", byteSize: fs.statSync(out).size,
  license, licenseUrl,
  attribution: `"${title}" by ${artist} (${license})`,
  sourceUrl,
};

if (args.includes("--upload")) {
  const bucket = process.env.MUSIC_BUCKET;
  if (!bucket) throw new Error("Set MUSIC_BUCKET to the media bucket's name.");
  execFileSync("aws", ["s3", "cp", out, `s3://${bucket}/${storageKey}`, "--content-type", "audio/mpeg", "--cache-control", "public, max-age=31536000, immutable", "--only-show-errors"], { stdio: "inherit" });
}
catalogue.push(entry);
fs.writeFileSync(catalogueFile, JSON.stringify(catalogue, null, 2) + "\n");
console.log(`Added ${entry.attribution}, ${Math.round(seconds)} s, ${storageKey}`);
