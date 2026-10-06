/**
 * Production build of the Admin web console: admin/ (source) → dist/admin.
 *
 *   node dist/scripts/build-admin.js [sourceDir=../admin] [outDir=dist/admin]
 *
 * - app.js is minified (terser); style.css is copied as is (small, and compressed below).
 * - Each asset gets a content-hashed name (app.3f9c2a1b4d5e.js), so it can be cached for a year
 *   and a deploy never mixes old pages with new scripts.
 * - Pages reference assets with Subresource Integrity (sha384), so a tampered file is refused.
 * - Assets are precompressed (brotli and gzip) once, at build time.
 * - manifest.json lists everything; the server serves a built console only when it is present.
 *
 * The output is deterministic: the same sources always give byte-identical files.
 */
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import * as zlib from "node:zlib";
import { minify } from "terser";

export interface BuiltAsset {
  /** Served at /admin/assets/<file>. */
  file: string;
  integrity: string;
  contentType: string;
  bytes: number;
  /** Precompressed variants written next to the file. */
  encodings: Array<"br" | "gzip">;
}

export interface AdminManifest {
  version: 1;
  /** sha256 of the sources the build came from. */
  source: string;
  assets: Record<"app.js" | "style.css", BuiltAsset>;
  pages: string[];
}

const PAGES = ["index.html", "login.html"];

const sha256 = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");
const stripBom = (text: string) => text.replace(/^﻿/, "");

async function minifyScript(code: string): Promise<string> {
  const result = await minify(code, {
    ecma: 2020,
    compress: { passes: 2 },
    mangle: true,
    format: { comments: false },
  });
  if (!result.code) throw new Error("terser produced no output for app.js");
  return result.code;
}

function writeAsset(outDir: string, logical: "app.js" | "style.css", content: Buffer, contentType: string): BuiltAsset {
  const ext = path.extname(logical);
  const file = `${path.basename(logical, ext)}.${sha256(content).slice(0, 12)}${ext}`;
  const assetsDir = path.join(outDir, "assets");
  fs.writeFileSync(path.join(assetsDir, file), content);
  fs.writeFileSync(path.join(assetsDir, `${file}.br`), zlib.brotliCompressSync(content, {
    params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: content.length },
  }));
  // mtime 0 in the gzip header keeps the output byte-identical between builds.
  fs.writeFileSync(path.join(assetsDir, `${file}.gz`), zlib.gzipSync(content, { level: 9 }));
  return {
    file,
    integrity: `sha384-${createHash("sha384").update(content).digest("base64")}`,
    contentType,
    bytes: content.length,
    encodings: ["br", "gzip"],
  };
}

/** Rewrites one asset reference in a page; the reference must exist exactly once. */
function pointAt(html: string, page: string, attribute: "href" | "src", from: string, asset: BuiltAsset): string {
  const needle = `${attribute}="${from}"`;
  const count = html.split(needle).length - 1;
  if (count !== 1) throw new Error(`${page}: expected ${needle} once, found ${count}`);
  return html.replace(needle, `${attribute}="/admin/assets/${asset.file}" integrity="${asset.integrity}"`);
}

export async function buildAdminConsole(sourceDir: string, outDir: string): Promise<AdminManifest> {
  const read = (name: string) => fs.readFileSync(path.join(sourceDir, name));
  const sources = ["app.js", "style.css", ...PAGES].map((name) => [name, read(name)] as const);
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(outDir, "assets"), { recursive: true });

  const script = Buffer.from(await minifyScript(stripBom(read("app.js").toString("utf8"))), "utf8");
  const assets = {
    "app.js": writeAsset(outDir, "app.js", script, "text/javascript; charset=utf-8"),
    "style.css": writeAsset(outDir, "style.css", Buffer.from(stripBom(read("style.css").toString("utf8")), "utf8"), "text/css; charset=utf-8"),
  };
  for (const page of PAGES) {
    let html = stripBom(read(page).toString("utf8"));
    html = pointAt(html, page, "href", "/admin/style.css", assets["style.css"]);
    html = pointAt(html, page, "src", "/admin/app.js", assets["app.js"]);
    fs.writeFileSync(path.join(outDir, page), html);
  }

  const manifest: AdminManifest = {
    version: 1,
    source: sha256(sources.map(([name, data]) => `${name}\0${sha256(data)}`).join("\n")),
    assets,
    pages: PAGES,
  };
  fs.writeFileSync(path.join(outDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

if (require.main === module) {
  const [sourceDir = path.resolve(process.cwd(), "../admin"), outDir = path.resolve(process.cwd(), "dist/admin")] = process.argv.slice(2);
  buildAdminConsole(path.resolve(sourceDir), path.resolve(outDir))
    .then((manifest) => {
      for (const [name, asset] of Object.entries(manifest.assets)) console.log(`${name} -> assets/${asset.file} (${asset.bytes} bytes, ${asset.integrity})`);
      console.log(`Admin console built in ${path.resolve(outDir)}`);
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    });
}
