/**
 * Serves the Admin web console.
 *
 * - A **built** console (`node dist/scripts/build-admin.js`, see scripts/build-admin.ts: a
 *   manifest.json is present) is read once into memory. Its content-hashed assets are cached by
 *   browsers for a year, in brotli or gzip when accepted; pages are never cached and load
 *   their assets with Subresource Integrity. Production requires a built console
 *   (config/env.ts).
 * - Otherwise (development) the source files are read on each request, as before.
 *
 * Asset names come only from the manifest, never from a path on disk.
 */
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { config } from "../../config/env";
import { HttpError } from "../../http/errors";

/** No inline script or style, no plugins or framing, and Trusted Types against DOM XSS. */
export const CONSOLE_CSP = [
  "default-src 'self'", "script-src 'self'", "style-src 'self'", "img-src 'self' blob:", "media-src 'self' blob:",
  "connect-src 'self'", "object-src 'none'", "frame-ancestors 'none'", "base-uri 'none'", "form-action 'self'",
  "require-trusted-types-for 'script'", "trusted-types 'none'",
].join("; ");

interface Asset {
  raw: Buffer;
  br: Buffer;
  gzip: Buffer;
  contentType: string;
  etag: string;
}
interface BuiltConsole {
  pages: Map<string, Buffer>;
  /** By hashed file name (served at /admin/assets/<file>). */
  assets: Map<string, Asset>;
  /** Logical name (app.js, style.css) → hashed file name, for the old unversioned URLs. */
  current: Map<string, string>;
}

const loaded = new Map<string, BuiltConsole | null>();

/** The built console at `root`, or null when `root` holds sources. Read once per root. */
export function builtConsole(root: string): BuiltConsole | null {
  if (loaded.has(root)) return loaded.get(root)!;
  const manifestPath = path.join(root, "manifest.json");
  let built: BuiltConsole | null = null;
  if (fs.existsSync(manifestPath)) {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
      assets: Record<string, { file: string; contentType: string }>;
      pages: string[];
    };
    built = { pages: new Map(), assets: new Map(), current: new Map() };
    for (const page of manifest.pages) built.pages.set(page, fs.readFileSync(path.join(root, page)));
    for (const [logical, { file, contentType }] of Object.entries(manifest.assets)) {
      const raw = fs.readFileSync(path.join(root, "assets", file));
      built.assets.set(file, {
        raw,
        br: fs.readFileSync(path.join(root, "assets", `${file}.br`)),
        gzip: fs.readFileSync(path.join(root, "assets", `${file}.gz`)),
        contentType,
        etag: `W/"${createHash("sha256").update(raw).digest("hex").slice(0, 32)}"`,
      });
      built.current.set(logical, file);
    }
  }
  loaded.set(root, built);
  return built;
}

/** Headers for every console response. */
export function consoleHeaders(res: ServerResponse): void {
  res.setHeader("Content-Security-Policy", CONSOLE_CSP);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
  res.setHeader("X-Frame-Options", "DENY");
  if (config.nodeEnv === "production") res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
}

/** The encoding to send for an Accept-Encoding header: br, then gzip, honouring q=0. */
export function pickEncoding(header: string | string[] | undefined): "br" | "gzip" | null {
  const offered = new Map<string, number>();
  for (const part of String(header ?? "").split(",")) {
    const [name, ...params] = part.trim().toLowerCase().split(";");
    if (!name) continue;
    const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
    offered.set(name, q ? Number(q.slice(2)) || 0 : 1);
  }
  const accepts = (name: string) => (offered.get(name) ?? offered.get("*") ?? 0) > 0;
  return accepts("br") ? "br" : accepts("gzip") ? "gzip" : null;
}

function sendAsset(req: IncomingMessage, res: ServerResponse, asset: Asset, cacheControl: string): void {
  consoleHeaders(res);
  res.setHeader("Cache-Control", cacheControl);
  res.setHeader("Vary", "Accept-Encoding");
  res.setHeader("ETag", asset.etag);
  if (req.headers["if-none-match"] === asset.etag) {
    res.statusCode = 304;
    res.end();
    return;
  }
  const encoding = pickEncoding(req.headers["accept-encoding"]);
  const body = encoding === "br" ? asset.br : encoding === "gzip" ? asset.gzip : asset.raw;
  res.setHeader("Content-Type", asset.contentType);
  if (encoding) res.setHeader("Content-Encoding", encoding);
  res.setHeader("Content-Length", body.length);
  res.end(body);
}

const SOURCE_TYPES: Record<string, string> = {
  "index.html": "text/html; charset=utf-8",
  "login.html": "text/html; charset=utf-8",
  "app.js": "text/javascript; charset=utf-8",
  "style.css": "text/css; charset=utf-8",
};

/** A page (index.html, login.html): never cached. */
export async function sendPage(res: ServerResponse, page: "index.html" | "login.html"): Promise<void> {
  const built = builtConsole(config.admin.staticRoot);
  consoleHeaders(res);
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", SOURCE_TYPES[page]!);
  res.end(built ? built.pages.get(page)! : await fs.promises.readFile(path.join(config.admin.staticRoot, page)));
}

/** A versioned asset, /admin/assets/<hashed file>: immutable. */
export function sendVersionedAsset(req: IncomingMessage, res: ServerResponse, file: string): void {
  const asset = builtConsole(config.admin.staticRoot)?.assets.get(file);
  if (!asset) throw new HttpError(404, "Not found.");
  sendAsset(req, res, asset, "private, max-age=31536000, immutable");
}

/** The unversioned /admin/app.js and /admin/style.css: the current build (revalidated), or the source. */
export async function sendUnversionedAsset(req: IncomingMessage, res: ServerResponse, logical: "app.js" | "style.css"): Promise<void> {
  const built = builtConsole(config.admin.staticRoot);
  const asset = built?.assets.get(built.current.get(logical) ?? "");
  if (asset) {
    sendAsset(req, res, asset, "no-cache");
    return;
  }
  consoleHeaders(res);
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", SOURCE_TYPES[logical]!);
  res.end(await fs.promises.readFile(path.join(config.admin.staticRoot, logical)));
}
