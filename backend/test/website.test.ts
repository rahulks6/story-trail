// The katkee.com website as the API serves it (modules/website): the pages the app and the stores
// link to, behind strict headers, cached and compressed; and, with WEBSITE_HOST set as in
// production, one address per page and nothing but the website on the website's host.
import "./env";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as http from "node:http";
import * as os from "node:os";
import * as path from "node:path";
import * as zlib from "node:zlib";
import type { AddressInfo } from "node:net";
import { config } from "../src/config/env";
import { buildApp } from "../src/app";
import { WEBSITE_CSP } from "../src/modules/website/website.routes";

const siteRoot = path.join(__dirname, "../../../website/public");
const manifest = JSON.parse(fs.readFileSync(path.join(siteRoot, "manifest.json"), "utf8")) as {
  pages: Record<string, string>; notFound: string; assets: Record<string, string>; files: Record<string, { file: string; type: string }>;
};
/** The website's host as production sets it (the config is read-only in its type only). */
const setSiteHost = (host: string) => { (config.website as { host: string }).host = host; };

type Reply = { status: number; headers: http.IncomingHttpHeaders; body: Buffer };
let port = 0;
function request(method: string, urlPath: string, headers: Record<string, string> = {}): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, method, path: urlPath, headers, agent: false }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on("error", reject);
    req.end();
  });
}
const get = (urlPath: string, headers?: Record<string, string>) => request("GET", urlPath, headers);
/** The status a WebSocket upgrade to the realtime path gets (no token). */
function upgradeStatus(host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: "127.0.0.1", port, path: "/api/v1/realtime", agent: false,
      headers: { Host: host, Connection: "Upgrade", Upgrade: "websocket", "Sec-WebSocket-Version": "13", "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==" },
    });
    req.on("response", (res) => { res.resume(); resolve(res.statusCode ?? 0); });
    req.on("upgrade", (_res, socket) => { socket.destroy(); resolve(101); });
    req.on("error", reject);
    req.end();
  });
}
const file = (name: string) => fs.readFileSync(path.join(siteRoot, name));

const server = buildApp();
before(async () => {
  assert.equal(path.resolve(config.website.root), path.resolve(siteRoot), "tests serve the repository's website/public");
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as AddressInfo).port;
});
after(async () => {
  setSiteHost("");
  await new Promise<void>((r) => server.close(() => r()));
});

describe("the website's pages", () => {
  it("serves the landing page, Help Center, policy, terms and deletion page the app and stores link to", async () => {
    assert.deepEqual(Object.keys(manifest.pages).sort(), ["/", "/delete-account", "/privacy", "/support", "/terms"]);
    for (const [route, name] of Object.entries(manifest.pages)) {
      const reply = await get(route);
      assert.equal(reply.status, 200, route);
      assert.equal(reply.headers["content-type"], "text/html; charset=utf-8", route);
      assert.ok(reply.body.equals(file(name)), `${route} is ${name}`);
    }
    const privacy = (await get("/privacy")).body.toString();
    assert.match(privacy, /<h1>Privacy Policy<\/h1>/);
    assert.match(privacy, /<a href="mailto:privacy@katkee\.com">privacy@katkee\.com<\/a>/);
    const terms = (await get("/terms")).body.toString();
    assert.match(terms, /<h1>Terms of Service<\/h1>/);
    assert.match(terms, /zero tolerance for objectionable content/);
    assert.match((await get("/delete-account")).body.toString(), /Settings<\/strong>[\s\S]*Delete account/);
    // What a store reviewer opens must be the finished text, not the drafting notes.
    for (const route of Object.keys(manifest.pages)) {
      const html = (await get(route)).body.toString();
      assert.doesNotMatch(html, /not legal advice|fill in|\[Your |TODO|lorem/i, route);
    }
  });

  it("sends every page with headers that run no script, allow no framing and load nothing from elsewhere", async () => {
    for (const route of Object.keys(manifest.pages)) {
      const reply = await get(route);
      assert.equal(reply.headers["content-security-policy"], WEBSITE_CSP, route);
      assert.equal(reply.headers["x-content-type-options"], "nosniff", route);
      assert.equal(reply.headers["x-frame-options"], "DENY", route);
      assert.equal(reply.headers["referrer-policy"], "strict-origin-when-cross-origin", route);
      assert.equal(reply.headers["cross-origin-opener-policy"], "same-origin", route);
    }
    assert.match(WEBSITE_CSP, /default-src 'none'/);
    assert.doesNotMatch(WEBSITE_CSP, /unsafe|script-src|\*/);
    assert.equal((await get("/")).headers["strict-transport-security"], undefined, "HSTS only in production");
    const nodeEnv = config.nodeEnv;
    (config as { nodeEnv: string }).nodeEnv = "production";
    try {
      assert.equal((await get("/")).headers["strict-transport-security"], "max-age=31536000");
    } finally {
      (config as { nodeEnv: string }).nodeEnv = nodeEnv;
    }
  });

  it("is cached briefly and revalidated, compressed when the browser accepts it, and answers HEAD", async () => {
    const first = await get("/terms");
    assert.equal(first.headers["cache-control"], "public, max-age=600");
    const etag = first.headers.etag!;
    assert.match(etag, /^"[0-9a-f]{32}"$/);
    const again = await get("/terms", { "If-None-Match": etag });
    assert.equal(again.status, 304);
    assert.equal(again.body.length, 0);
    assert.equal((await get("/terms", { "If-None-Match": `W/${etag}, "other"` })).status, 304);
    assert.equal((await get("/terms", { "If-None-Match": '"stale"' })).status, 200);

    const br = await get("/terms", { "Accept-Encoding": "gzip, br" });
    assert.equal(br.headers["content-encoding"], "br");
    assert.equal(br.headers.vary, "Accept-Encoding");
    assert.ok(zlib.brotliDecompressSync(br.body).equals(first.body));
    const gzip = await get("/terms", { "Accept-Encoding": "gzip" });
    assert.equal(gzip.headers["content-encoding"], "gzip");
    assert.ok(zlib.gunzipSync(gzip.body).equals(first.body));
    assert.ok(br.body.length < first.body.length / 2, "the text compresses");

    const head = await request("HEAD", "/terms");
    assert.equal(head.status, 200);
    assert.equal(head.body.length, 0);
    assert.equal(Number(head.headers["content-length"]), first.body.length);
    assert.equal(head.headers.etag, etag);
  });

  it("serves content-hashed assets as immutable, and the conventional files at their fixed paths", async () => {
    const assets = Object.entries(manifest.assets);
    assert.ok(assets.length >= 3);
    for (const [name, type] of assets) {
      assert.match(name, /^[a-z-]+\.[0-9a-f]{10}\.(css|svg|png)$/);
      const reply = await get(`/assets/${name}`);
      assert.equal(reply.status, 200, name);
      assert.equal(reply.headers["content-type"], type, name);
      assert.equal(reply.headers["cache-control"], "public, max-age=31536000, immutable", name);
      assert.ok(reply.body.equals(file(`assets/${name}`)), name);
      // Every page that uses an asset uses exactly this version of it.
      assert.ok(Object.values(manifest.pages).some((page) => file(page).toString().includes(`/assets/${name}`)), `${name} is used`);
    }
    for (const [route, { file: name, type }] of Object.entries(manifest.files)) {
      const reply = await get(route);
      assert.equal(reply.status, 200, route);
      assert.equal(reply.headers["content-type"], type, route);
      assert.ok(reply.body.equals(file(name)), route);
    }
    assert.match((await get("/robots.txt")).body.toString(), /^Sitemap: https:\/\/katkee\.com\/sitemap\.xml$/m);
    assert.match((await get("/sitemap.xml")).body.toString(), /<loc>https:\/\/katkee\.com\/privacy<\/loc>/);
  });

  it("answers an unknown asset with the website's 404 page and never reads outside the site", async () => {
    for (const target of ["/assets/site.0000000000.css", "/assets/manifest.json", "/assets/..%2Fmanifest.json", "/assets/%2e%2e%2f%2e%2e%2fpackage.json"]) {
      const reply = await get(target);
      assert.equal(reply.status, 404, target);
      assert.equal(reply.headers["content-type"], "text/html; charset=utf-8", target);
      assert.ok(reply.body.equals(file(manifest.notFound)), target);
    }
  });
});

describe("with WEBSITE_HOST, as in production", () => {
  before(() => setSiteHost("katkee.test"));
  after(() => setSiteHost(""));

  it("serves the website on its own host, whatever the case or port", async () => {
    for (const host of ["katkee.test", "KATKEE.test:443", "katkee.test."]) {
      const reply = await get("/privacy", { Host: host });
      assert.equal(reply.status, 200, host);
      assert.ok(reply.body.equals(file("privacy.html")), host);
    }
    assert.equal((await get("/assets/" + Object.keys(manifest.assets)[0], { Host: "katkee.test" })).status, 200);
    assert.equal((await get("/favicon.ico", { Host: "katkee.test" })).status, 200);
  });

  it("never exposes the API or the Admin console on the website's host", async () => {
    for (const target of ["/health", "/ready", "/api/v1/auth/login", "/api/v1/users/me", "/admin", "/admin/login", "/api/v1/admin/session"]) {
      const reply = await get(target, { Host: "katkee.test" });
      assert.equal(reply.status, 404, target);
      assert.equal(reply.headers["content-type"], "text/html; charset=utf-8", target);
      assert.equal(reply.headers["content-security-policy"], WEBSITE_CSP, target);
      assert.ok(reply.body.equals(file(manifest.notFound)), target);
    }
    const post = await request("POST", "/api/v1/auth/login", { Host: "katkee.test", "Content-Type": "application/json" });
    assert.equal(post.status, 404);
    const write = await request("POST", "/privacy", { Host: "katkee.test" });
    assert.equal(write.status, 405);
    assert.equal(write.headers.allow, "GET, HEAD");
    // Nor the realtime socket: refused before any authentication on the website's names.
    for (const host of ["katkee.test", "www.katkee.test"]) assert.equal(await upgradeStatus(host), 404, host);
    assert.equal(await upgradeStatus("api.katkee.test"), 401, "the API's own host still asks for a token");
  });

  it("redirects www to the website's host, keeping the path and query", async () => {
    for (const [target, location] of [["/terms?ref=app", "https://katkee.test/terms?ref=app"], ["/", "https://katkee.test/"], ["/api/v1/users/me", "https://katkee.test/api/v1/users/me"]]) {
      const reply = await get(target!, { Host: "www.katkee.test" });
      assert.equal(reply.status, 301, target);
      assert.equal(reply.headers.location, location, target);
      assert.equal(reply.headers["cache-control"], "public, max-age=86400");
    }
  });

  it("gives each page one address: asked for on the API's host, it redirects to the website", async () => {
    for (const route of Object.keys(manifest.pages)) {
      const reply = await get(route, { Host: "api.katkee.test" });
      assert.equal(reply.status, 301, route);
      assert.equal(reply.headers.location, `https://katkee.test${route}`, route);
    }
    // The API itself is unchanged there.
    const health = await get("/health", { Host: "api.katkee.test" });
    assert.notEqual(health.status, 301);
    assert.match(String(health.headers["content-type"]), /application\/json/);
    const missing = await get("/api/v1/nothing-here", { Host: "api.katkee.test" });
    assert.equal(missing.status, 404);
    assert.match(String(missing.headers["content-type"]), /application\/json/);
  });

  it("never redirects off the website's host, whatever the request target", async () => {
    const reply = await get("//evil.example/x", { Host: "www.katkee.test" });
    assert.equal(reply.headers.location, "https://katkee.test//evil.example/x");
    assert.equal(new URL(reply.headers.location!).host, "katkee.test");
    // An absolute-form target ("GET http://other/ HTTP/1.1") is answered as the home page.
    const absolute = await get("http://evil.example/x", { Host: "www.katkee.test" });
    assert.equal(absolute.headers.location, "https://katkee.test/");
  });
});

describe("startup", () => {
  /** Loads the configuration in a fresh process, as the API does when it starts. */
  const load = (env: Record<string, string>) =>
    spawnSync(process.execPath, ["-e", `require(${JSON.stringify(path.join(__dirname, "../src/config/env.js"))})`], {
      cwd: os.tmpdir(),
      env: { PATH: process.env.PATH ?? "", JWT_ACCESS_SECRET: randomBytes(32).toString("hex"), JWT_REFRESH_SECRET: randomBytes(32).toString("hex"), ...env },
      encoding: "utf8",
    });

  it("refuses a WEBSITE_HOST that is not a host name, or without the built website", () => {
    assert.equal(load({ WEBSITE_HOST: "katkee.com", WEBSITE_ROOT: siteRoot }).status, 0);
    for (const host of ["https://katkee.com", "katkee", "katkee.com/privacy", "-katkee.com"]) {
      const result = load({ WEBSITE_HOST: host, WEBSITE_ROOT: siteRoot });
      assert.notEqual(result.status, 0, host);
      assert.match(result.stderr, /WEBSITE_HOST must be a host name/, host);
    }
    const missing = load({ WEBSITE_HOST: "katkee.com", WEBSITE_ROOT: fs.mkdtempSync(path.join(os.tmpdir(), "katkee-no-site-")) });
    assert.notEqual(missing.status, 0);
    assert.match(missing.stderr, /WEBSITE_HOST needs the built website/);
  });
});
