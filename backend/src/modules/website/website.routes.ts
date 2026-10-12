/**
 * Serves the katkee.com website: the landing page, Help Center, Privacy Policy, Terms of Service
 * and account deletion page. website/build.cjs builds it into website/public (committed); the
 * image carries it as dist/website.
 *
 * - Read once into memory, with brotli and gzip copies of the text files. Pages are cached for
 *   ten minutes and revalidated with ETags; content-hashed assets are immutable.
 * - Strict headers: the pages run no scripts at all, can't be framed, and load nothing from
 *   anywhere else.
 * - With WEBSITE_HOST set (production: katkee.com), that host serves only the website (anything
 *   else gets the site's 404 page, so the API and the Admin console are never reachable there),
 *   www.<host> redirects to it, and the website's pages asked for on any other host (the API's)
 *   redirect to it, so each page has one address.
 */
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import * as zlib from "node:zlib";
import type { IncomingMessage, ServerResponse } from "node:http";
import { config } from "../../config/env";
import type { KatkeeRequest, Router } from "../../http/router";
import { pickEncoding } from "../admin/console-assets";

/** No scripts, no inline styles, nothing from other origins, no framing. */
export const WEBSITE_CSP = [
  "default-src 'none'", "img-src 'self'", "style-src 'self'", "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'",
].join("; ");

interface WebsiteFile {
  body: Buffer;
  br: Buffer | null;
  gzip: Buffer | null;
  type: string;
  etag: string;
  cacheControl: string;
}
interface Website {
  /** By path: "/", "/privacy", ... */
  pages: Map<string, WebsiteFile>;
  /** By hashed file name, served at /assets/<file>. */
  assets: Map<string, WebsiteFile>;
  /** Fixed paths: /favicon.ico, /apple-touch-icon.png, /robots.txt, /sitemap.xml. */
  files: Map<string, WebsiteFile>;
  notFound: WebsiteFile;
}
interface Manifest {
  pages: Record<string, string>;
  notFound: string;
  assets: Record<string, string>;
  files: Record<string, { file: string; type: string }>;
}

const PAGE_CACHE = "public, max-age=600";
const ASSET_CACHE = "public, max-age=31536000, immutable";
const FILE_CACHE = "public, max-age=86400";
const HTML = "text/html; charset=utf-8";

function load(root: string, file: string, type: string, cacheControl: string): WebsiteFile {
  const body = fs.readFileSync(path.join(root, file));
  const text = /^(text\/|application\/xml|image\/svg\+xml)/.test(type);
  return {
    body,
    br: text ? zlib.brotliCompressSync(body, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 } }) : null,
    gzip: text ? zlib.gzipSync(body, { level: 9 }) : null,
    type,
    etag: `"${createHash("sha256").update(body).digest("hex").slice(0, 32)}"`,
    cacheControl,
  };
}

const loaded = new Map<string, Website | null>();

/** The built website at `root`, or null when there is none. Read once per root. */
export function loadWebsite(root: string): Website | null {
  if (loaded.has(root)) return loaded.get(root)!;
  let site: Website | null = null;
  const manifestPath = path.join(root, "manifest.json");
  if (fs.existsSync(manifestPath)) {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as Manifest;
    const safe = (name: string) => {
      // Names come from the manifest the build wrote; still never leave the site's folder.
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) throw new Error(`website manifest: bad file name ${name}`);
      return name;
    };
    site = {
      pages: new Map(Object.entries(manifest.pages).map(([route, file]) => [route, load(root, safe(file), HTML, PAGE_CACHE)])),
      assets: new Map(Object.entries(manifest.assets).map(([file, type]) => [file, load(root, path.join("assets", safe(file)), type, ASSET_CACHE)])),
      files: new Map(Object.entries(manifest.files).map(([route, { file, type }]) => [route, load(root, safe(file), type, FILE_CACHE)])),
      notFound: load(root, safe(manifest.notFound), HTML, "no-cache"),
    };
  }
  loaded.set(root, site);
  return site;
}

const website = () => loadWebsite(config.website.root);

export function websiteHeaders(res: ServerResponse): void {
  res.setHeader("Content-Security-Policy", WEBSITE_CSP);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
  if (config.nodeEnv === "production") res.setHeader("Strict-Transport-Security", "max-age=31536000");
}

function send(req: IncomingMessage, res: ServerResponse, file: WebsiteFile, status = 200): void {
  websiteHeaders(res);
  res.setHeader("Cache-Control", file.cacheControl);
  if (file.gzip) res.setHeader("Vary", "Accept-Encoding");
  if (status === 200) {
    res.setHeader("ETag", file.etag);
    const tags = String(req.headers["if-none-match"] ?? "").split(",").map((t) => t.trim().replace(/^W\//, ""));
    if (tags.includes(file.etag)) {
      res.statusCode = 304;
      res.end();
      return;
    }
  }
  const encoding = file.gzip ? pickEncoding(req.headers["accept-encoding"]) : null;
  const body = encoding === "br" ? file.br! : encoding === "gzip" ? file.gzip! : file.body;
  res.statusCode = status;
  res.setHeader("Content-Type", file.type);
  if (encoding) res.setHeader("Content-Encoding", encoding);
  res.setHeader("Content-Length", body.length);
  res.end(req.method === "HEAD" ? undefined : body);
}

function sendNotFound(req: IncomingMessage, res: ServerResponse, site: Website): void {
  send(req, res, site.notFound, 404);
}

export function registerWebsiteRoutes(router: Router): void {
  const site = website();
  if (!site) return;
  const both = (route: string, handler: (req: IncomingMessage, res: ServerResponse) => void) => {
    router.get(route, handler);
    router.add("HEAD", route, handler);
  };
  for (const [route, page] of site.pages) both(route, (req, res) => send(req, res, page));
  for (const [route, file] of site.files) both(route, (req, res) => send(req, res, file));
  both("/assets/:file", (req, res) => {
    const asset = site.assets.get((req as KatkeeRequest).params.file ?? "");
    if (asset) send(req, res, asset);
    else sendNotFound(req, res, site);
  });
}

/** The request's host name, lower-case, without a port or a trailing dot. */
function hostOf(req: IncomingMessage): string {
  const host = String(req.headers.host ?? "").trim().toLowerCase();
  const name = host.startsWith("[") ? host.slice(0, host.indexOf("]") + 1) : host.split(":")[0]!;
  return name.replace(/\.$/, "");
}

/** True for requests to the website's own host or its www name (with WEBSITE_HOST set). */
export function isWebsiteHost(req: IncomingMessage): boolean {
  const siteHost = config.website.host;
  if (!siteHost) return false;
  const host = hostOf(req);
  return host === siteHost || host === `www.${siteHost}`;
}

function redirect(res: ServerResponse, location: string): void {
  res.statusCode = 301;
  res.setHeader("Location", location);
  // A day, not forever: a browser keeps a bare 301 indefinitely.
  res.setHeader("Cache-Control", "public, max-age=86400");
  res.end();
}

/**
 * Applies WEBSITE_HOST before routing. Returns true when it answered the request itself; the
 * server then routes nothing. Without WEBSITE_HOST (development, tests), the website is served
 * on every host and nothing here applies.
 */
export function websiteGate(req: IncomingMessage, res: ServerResponse): boolean {
  const siteHost = config.website.host;
  const site = website();
  if (!siteHost || !site) return false;
  const host = hostOf(req);
  // Origin-form targets only ("/path?query"); anything else is answered as "/".
  const target = (req.url ?? "/").startsWith("/") ? req.url! : "/";
  const pathname = target.split("?")[0]!;
  const readOnly = req.method === "GET" || req.method === "HEAD";
  if (host === `www.${siteHost}`) {
    redirect(res, `https://${siteHost}${target}`);
    return true;
  }
  if (host === siteHost) {
    const known = site.pages.has(pathname) || site.files.has(pathname) || pathname.startsWith("/assets/");
    if (known && readOnly) return false;
    if (known) {
      websiteHeaders(res);
      res.statusCode = 405;
      res.setHeader("Allow", "GET, HEAD");
      res.end();
      return true;
    }
    sendNotFound(req, res, site);
    return true;
  }
  if (readOnly && site.pages.has(pathname)) {
    redirect(res, `https://${siteHost}${target}`);
    return true;
  }
  return false;
}
