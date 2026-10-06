// Production startup checks (config/env.ts): a deploy with a broken signing key or an unwritable
// temporary directory stops at startup instead of failing requests later; migrations run with
// database settings only, so the migration task holds no app secrets.
import "./env";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const backendRoot = path.join(__dirname, "../..");
const pem = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs1", format: "pem" }).toString();

function production(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    PATH: process.env.PATH ?? "", NODE_ENV: "production",
    JWT_ACCESS_SECRET: randomBytes(32).toString("hex"), JWT_REFRESH_SECRET: randomBytes(32).toString("hex"),
    EMAIL_PROVIDER: "ses", EMAIL_FROM: "Katkee <no-reply@katkee.example>",
    MEDIA_STORE: "s3", MEDIA_S3_BUCKET: "katkee-media", MEDIA_CDN_DOMAIN: "media.katkee.example",
    CLOUDFRONT_KEY_PAIR_ID: "K2TESTKEYPAIR", CLOUDFRONT_PRIVATE_KEY: pem,
    ...overrides,
  };
}

/** Loads the configuration in a fresh process, as the API and worker do when they start. */
function load(env: Record<string, string>) {
  // Outside backend/, so no development .env is picked up.
  return spawnSync(process.execPath, ["-e", `require(${JSON.stringify(path.join(__dirname, "../src/config/env.js"))})`], { cwd: os.tmpdir(), env, encoding: "utf8" });
}

describe("production startup", () => {
  it("starts with a complete configuration; the key may be PEM, PEM with escaped line breaks, or base64", () => {
    for (const key of [pem, pem.replace(/\n/g, "\\n"), Buffer.from(pem).toString("base64")]) {
      const result = load(production({ CLOUDFRONT_PRIVATE_KEY: key }));
      assert.equal(result.status, 0, result.stderr);
    }
  });

  it("refuses a placeholder or damaged CloudFront signing key", () => {
    const bad = [
      "REPLACE_ME", // an unfilled secret
      randomBytes(24).toString("base64"), // a generated placeholder
      pem.slice(0, 400), // truncated when pasted
      generateKeyPairSync("rsa", { modulusLength: 2048 }).publicKey.export({ type: "spki", format: "pem" }).toString(), // the public half
    ];
    for (const key of bad) {
      const result = load(production({ CLOUDFRONT_PRIVATE_KEY: key }));
      assert.notEqual(result.status, 0, key.slice(0, 30));
      assert.match(result.stderr, /CLOUDFRONT_PRIVATE_KEY must be the private key of the CloudFront key pair/);
    }
  });

  it("refuses a temporary directory it cannot write", () => {
    const missing = path.join(os.tmpdir(), `katkee-missing-${Date.now()}`, "tmp");
    const cases = [missing];
    if (process.getuid?.() !== 0) {
      // Read-only for this user (root ignores permission bits, so only checked as a normal user).
      const readOnly = fs.mkdtempSync(path.join(os.tmpdir(), "katkee-readonly-"));
      fs.chmodSync(readOnly, 0o555);
      cases.push(readOnly);
    }
    for (const dir of cases) {
      const result = load(production({ TMPDIR: dir }));
      assert.notEqual(result.status, 0, dir);
      assert.match(result.stderr, /Production needs a writable temporary directory for uploads and media processing/);
    }
    const writable = fs.mkdtempSync(path.join(os.tmpdir(), "katkee-writable-"));
    assert.equal(load(production({ TMPDIR: writable })).status, 0);
  });

  it("migrations run with database settings only", () => {
    const db = Object.fromEntries(["PGHOST", "PGPORT", "PGUSER", "PGPASSWORD", "PGDATABASE"].flatMap((k) => (process.env[k] ? [[k, process.env[k]!]] : [])));
    const env = { PATH: process.env.PATH ?? "", NODE_ENV: "production", ...db };
    const migrate = spawnSync(process.execPath, ["dist/scripts/migrate.js"], { cwd: backendRoot, env, encoding: "utf8" });
    assert.equal(migrate.status, 0, migrate.stderr);
    assert.match(migrate.stdout, /Nothing to do/);
    // The app itself would refuse the same environment.
    const app = load(env);
    assert.notEqual(app.status, 0);
    assert.match(app.stderr, /Missing required environment variable: JWT_ACCESS_SECRET/);
  });
});
