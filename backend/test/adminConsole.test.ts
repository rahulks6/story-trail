// The Admin web console as production serves it: built once (scripts/build-admin.ts), versioned,
// integrity-checked, precompressed and behind strict headers. Development serves the sources.
import "./admin-env";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as http from "node:http";
import * as os from "node:os";
import * as path from "node:path";
import * as zlib from "node:zlib";
import type { AddressInfo } from "node:net";
import { buildAdminConsole, type AdminManifest } from "../scripts/build-admin";
import { config } from "../src/config/env";
import { buildApp } from "../src/app";
import { CONSOLE_CSP, pickEncoding } from "../src/modules/admin/console-assets";

const sourceDir = path.join(__dirname, "../../../admin");
/** Points the running server at a console directory (the config is read-only in its type only). */
const serveConsoleFrom = (root: string) => { (config.admin as { staticRoot: string }).staticRoot = root; };
const tmp = (name: string) => fs.mkdtempSync(path.join(os.tmpdir(), `katkee-admin-${name}-`));
const files = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(path.join(dir, e.name)).map((f) => `${e.name}/${f}`) : [e.name])).sort();

type Reply = { status: number; headers: http.IncomingHttpHeaders; body: Buffer };
let port = 0;
function get(urlPath: string, headers: Record<string, string> = {}): Promise<Reply> {
  return new Promise((resolve, reject) => {
    http.get({ host: "127.0.0.1", port, path: urlPath, headers, agent: false }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
    }).on("error", reject);
  });
}

const server = buildApp();
let built = "";
let manifest: AdminManifest;
before(async () => {
  built = tmp("built");
  manifest = await buildAdminConsole(sourceDir, built);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as AddressInfo).port;
});
after(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

describe("the console build", () => {
  it("is deterministic, minified, and points pages at hashed, integrity-checked assets", async () => {
    const again = tmp("again");
    await buildAdminConsole(sourceDir, again);
    assert.deepEqual(files(again), files(built));
    for (const f of files(built)) assert.ok(fs.readFileSync(path.join(again, f)).equals(fs.readFileSync(path.join(built, f))), `${f} differs between builds`);

    const app = manifest.assets["app.js"], css = manifest.assets["style.css"];
    assert.match(app.file, /^app\.[0-9a-f]{12}\.js$/);
    assert.match(css.file, /^style\.[0-9a-f]{12}\.css$/);
    assert.ok(app.bytes < fs.statSync(path.join(sourceDir, "app.js")).size, "minified");
    for (const page of ["index.html", "login.html"]) {
      const html = fs.readFileSync(path.join(built, page), "utf8");
      assert.ok(html.includes(`src="/admin/assets/${app.file}" integrity="${app.integrity}"`), page);
      assert.ok(html.includes(`href="/admin/assets/${css.file}" integrity="${css.integrity}"`), page);
      assert.ok(!html.includes('"/admin/app.js"') && !html.includes('"/admin/style.css"'), `${page} still points at unversioned files`);
    }
    const raw = fs.readFileSync(path.join(built, "assets", app.file));
    assert.ok(zlib.brotliDecompressSync(fs.readFileSync(path.join(built, "assets", `${app.file}.br`))).equals(raw));
    assert.ok(zlib.gunzipSync(fs.readFileSync(path.join(built, "assets", `${app.file}.gz`))).equals(raw));
  });

  it("fails when a page no longer references its assets the expected way", async () => {
    const broken = tmp("broken-src");
    for (const f of ["app.js", "style.css", "index.html", "login.html"]) fs.copyFileSync(path.join(sourceDir, f), path.join(broken, f));
    fs.writeFileSync(path.join(broken, "login.html"), fs.readFileSync(path.join(broken, "login.html"), "utf8").replace('src="/admin/app.js"', 'src="app.js"'));
    await assert.rejects(buildAdminConsole(broken, tmp("broken-out")), /login\.html: expected src="\/admin\/app\.js" once, found 0/);
  });
});

describe("serving the built console", () => {
  before(() => serveConsoleFrom(built));

  it("pages are never cached and carry the strict headers", async () => {
    const page = await get("/admin/login");
    assert.equal(page.status, 200);
    assert.ok(page.body.equals(fs.readFileSync(path.join(built, "login.html"))));
    assert.equal(page.headers["cache-control"], "no-store");
    assert.equal(page.headers["content-security-policy"], CONSOLE_CSP);
    assert.match(CONSOLE_CSP, /require-trusted-types-for 'script'/);
    assert.deepEqual(
      [page.headers["x-content-type-options"], page.headers["referrer-policy"], page.headers["cross-origin-opener-policy"], page.headers["x-frame-options"]],
      ["nosniff", "no-referrer", "same-origin", "DENY"],
    );
    assert.equal((await get("/admin")).status, 401, "the console itself still needs an Admin session");
  });

  it("assets are immutable, match their integrity hash, and come precompressed", async () => {
    const html = (await get("/admin/login")).body.toString("utf8");
    const refs = [...html.matchAll(/(?:src|href)="(\/admin\/assets\/[^"]+)" integrity="([^"]+)"/g)];
    assert.equal(refs.length, 2);
    for (const [, url, integrity] of refs) {
      const plain = await get(url!);
      assert.equal(plain.status, 200);
      assert.equal(plain.headers["content-encoding"], undefined);
      assert.equal(`sha384-${createHash("sha384").update(plain.body).digest("base64")}`, integrity, "what the browser receives passes SRI");
      assert.equal(plain.headers["cache-control"], "private, max-age=31536000, immutable");
      assert.equal(plain.headers.vary, "Accept-Encoding");
      assert.equal(Number(plain.headers["content-length"]), plain.body.length);

      const br = await get(url!, { "Accept-Encoding": "gzip, deflate, br" });
      assert.equal(br.headers["content-encoding"], "br");
      assert.ok(zlib.brotliDecompressSync(br.body).equals(plain.body));
      assert.ok(br.body.length < plain.body.length);
      const gz = await get(url!, { "Accept-Encoding": "br;q=0, gzip" });
      assert.equal(gz.headers["content-encoding"], "gzip");
      assert.ok(zlib.gunzipSync(gz.body).equals(plain.body));

      const revalidated = await get(url!, { "If-None-Match": String(plain.headers.etag) });
      assert.deepEqual([revalidated.status, revalidated.body.length], [304, 0]);
    }
  });

  it("serves only the build's own asset names", async () => {
    const app = manifest.assets["app.js"].file;
    for (const bad of ["/admin/assets/app.js", "/admin/assets/nope.0123456789ab.js", "/admin/assets/..%2Fmanifest.json", `/admin/assets/${app}.br`, "/admin/assets/%2e%2e%2f%2e%2e%2fpackage.json"]) {
      assert.equal((await get(bad)).status, 404, bad);
    }
    const legacy = await get("/admin/app.js");
    assert.equal(legacy.status, 200);
    assert.equal(legacy.headers["cache-control"], "no-cache", "the old unversioned URL gets the current build and revalidates");
    assert.ok(legacy.body.equals(fs.readFileSync(path.join(built, "assets", app))));
  });

  it("negotiates encodings by quality", () => {
    assert.equal(pickEncoding("gzip, br"), "br");
    assert.equal(pickEncoding("br;q=0, gzip;q=0.5"), "gzip");
    assert.equal(pickEncoding("identity"), null);
    assert.equal(pickEncoding("*"), "br");
    assert.equal(pickEncoding("*;q=0"), null);
    assert.equal(pickEncoding(undefined), null);
  });
});

describe("development and production", () => {
  it("development serves the sources and has no versioned assets", async () => {
    serveConsoleFrom(sourceDir);
    const script = await get("/admin/app.js");
    assert.deepEqual([script.status, script.headers["cache-control"]], [200, "no-store"]);
    assert.ok(script.body.equals(fs.readFileSync(path.join(sourceDir, "app.js"))));
    assert.equal((await get(`/admin/assets/${manifest.assets["app.js"].file}`)).status, 404);
    serveConsoleFrom(built);
  });

  it("production refuses to start with an unbuilt console", () => {
    const env = {
      PATH: process.env.PATH ?? "", NODE_ENV: "production",
      JWT_ACCESS_SECRET: randomBytes(32).toString("hex"), JWT_REFRESH_SECRET: randomBytes(32).toString("hex"),
      EMAIL_PROVIDER: "ses", EMAIL_FROM: "Katkee <no-reply@katkee.example>",
      MEDIA_STORE: "s3", MEDIA_S3_BUCKET: "katkee-media", MEDIA_CDN_DOMAIN: "media.katkee.example",
      CLOUDFRONT_KEY_PAIR_ID: "K2TESTKEYPAIR", CLOUDFRONT_PRIVATE_KEY: "test-only",
      ADMIN_CONSOLE_ENABLED: "true", ADMIN_ORIGIN: "https://admin.katkee.example",
      ADMIN_MFA_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
    };
    const load = (root: string) => spawnSync(process.execPath, ["-e", `require(${JSON.stringify(path.join(__dirname, "../src/config/env.js"))})`], {
      cwd: os.tmpdir(), env: { ...env, ADMIN_STATIC_ROOT: root }, encoding: "utf8",
    });
    const unbuilt = load(sourceDir);
    assert.notEqual(unbuilt.status, 0);
    assert.match(unbuilt.stderr, /Production Admin Console requires the built console/);
    const ok = load(built);
    assert.equal(ok.status, 0, ok.stderr);
  });
});
