/**
 * Serves the katkee.com website: the landing page, Help Center, Privacy Policy, Terms of Service
 * and account deletion page. website/build.cjs builds it into website/public (committed); the
 * image carries it as dist/website.
 *
 * Shared links are katkee.com addresses too: /u/<username>?id=<account id> and /s/<story id>.
 * With the app installed, Android App Links and iOS Universal Links open them in the app (the
 * /.well-known files say which app may). Without it, an account that shows on the web (public,
 * in good standing, "Show my profile on the web" on: web-profile.ts) gets its web profile, and a
 * public Story of one plays in the web Story player. Every other link gets the "Open in Katkee"
 * page, the same for an account that is private, suspended, deleted, opted out or never existed,
 * and for a Story that is followers-only, Close Friends, expired or removed, so it can't reveal
 * which. Watching on the web is never a Story view, a profile visit or reach.
 *
 * Invite links are katkee.com/i/<code> (Settings > Invite friends). Their page does look the code
 * up, to say whose invite it is ("Asha invited you to Katkee"): that's the point of sending it.
 * It shows only the inviter's display name, and a link that doesn't work (unknown code, or an
 * inviter who deleted their account or was suspended) gets the same page with a plain "You're
 * invited", so the page can't be used to find out more.
 *
 * - Read once into memory, with brotli and gzip copies of the text files. Pages are cached for
 *   ten minutes and revalidated with ETags; content-hashed assets are immutable.
 * - Strict headers: the pages run no scripts at all, can't be framed, and load nothing from
 *   anywhere else. Web profiles run one script, the site's own Story player, and load media
 *   from the CDN the API already delivers it from (webProfileCsp).
 * - Web profiles and shared links are cached for a minute only, so an account that turns private
 *   or opts out disappears quickly; their media addresses check again on every request. No auth
 *   and no cookies: a signed-in app's token sent here is ignored. Lookups are rate limited per
 *   network address, and the only record of a visit is a daily count per kind of page.
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
import { INVITE_CODE_RE, inviterForCode } from "../growth/invites";
import { HttpError } from "../../http/errors";
import { RateLimiter, clientIp } from "../../http/rateLimiter";
import { cdnEnabled, chooseObject, signedCdnUrl, type RequestedVariant } from "../media/delivery";
import { mediaStorage } from "../media/instance";
import type { MediaRecord } from "../media/media.repository";
import { streamObject } from "../media/stream";
import { fillWebPage, webPageValues, type WebMarkers } from "./web-pages";
import { countWebPage, findWebAccount, findWebStoryOwner, sitemapUsernames, webProfile, webProfilePhoto, webStoryMedia } from "./web-profile";

/** No scripts, no inline styles, nothing from other origins, no framing. */
export const WEBSITE_CSP = [
  "default-src 'none'", "img-src 'self'", "style-src 'self'", "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'",
].join("; ");

/**
 * Web profiles: the same, plus the site's own Story player script and media from the CDN (the
 * media addresses on this site redirect there). Still nothing inline and no other origin.
 */
export function webProfileCsp(): string {
  const cdn = config.media.cdn.domain ? ` https://${config.media.cdn.domain}` : "";
  return [
    "default-src 'none'", `img-src 'self'${cdn}`, `media-src 'self'${cdn}`, "style-src 'self'", "script-src 'self'",
    "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'",
  ].join("; ");
}

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
  /** Fixed paths: /favicon.ico, /robots.txt, ..., and the app-link files under /.well-known. */
  files: Map<string, WebsiteFile>;
  notFound: WebsiteFile;
  /** The "Open in Katkee" page, with the markers each request's own link replaces. */
  openInApp: { template: string; markers: OpenMarkers } | null;
  /** The invite page, with the markers each invite link's own values replace. */
  invite: { template: string; markers: InviteMarkers } | null;
  /** The web profile page, with the markers each profile's own values replace. */
  webProfile: { template: string; markers: WebMarkers } | null;
  /** The website's origin (https://katkee.com), for absolute addresses in link previews. */
  origin: string;
  /** The site's link-preview image, for an account without a photo. */
  socialCard: string;
}
interface OpenMarkers { appLink: string; linkPath: string }
interface InviteMarkers { appLink: string; linkPath: string; headline: string }
interface Manifest {
  pages: Record<string, string>;
  notFound: string;
  openInApp?: { file: string; markers: OpenMarkers };
  invite?: { file: string; markers: InviteMarkers };
  webProfile?: { file: string; markers: WebMarkers };
  host: string;
  assets: Record<string, string>;
  files: Record<string, { file: string; type: string }>;
}

const PAGE_CACHE = "public, max-age=600";
/** Pages that depend on an account: a minute, so a change of privacy shows quickly. */
const SHARED_CACHE = "public, max-age=60";
const ASSET_CACHE = "public, max-age=31536000, immutable";
const FILE_CACHE = "public, max-age=86400";
const HTML = "text/html; charset=utf-8";

/** `quality` is brotli's: the best for files read once, a quicker one for pages made per request. */
function prepare(body: Buffer, type: string, cacheControl: string, quality = 11): WebsiteFile {
  const text = /^(text\/|application\/(xml|json)|image\/svg\+xml)/.test(type);
  return {
    body,
    br: text ? zlib.brotliCompressSync(body, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: quality } }) : null,
    gzip: text ? zlib.gzipSync(body, { level: 9 }) : null,
    type,
    etag: `"${createHash("sha256").update(body).digest("hex").slice(0, 32)}"`,
    cacheControl,
  };
}

function load(root: string, file: string, type: string, cacheControl: string): WebsiteFile {
  return prepare(fs.readFileSync(path.join(root, file)), type, cacheControl);
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
      openInApp: manifest.openInApp
        ? { template: fs.readFileSync(path.join(root, safe(manifest.openInApp.file)), "utf8"), markers: manifest.openInApp.markers }
        : null,
      invite: manifest.invite
        ? { template: fs.readFileSync(path.join(root, safe(manifest.invite.file)), "utf8"), markers: manifest.invite.markers }
        : null,
      webProfile: manifest.webProfile
        ? { template: fs.readFileSync(path.join(root, safe(manifest.webProfile.file)), "utf8"), markers: manifest.webProfile.markers }
        : null,
      origin: `https://${manifest.host}`,
      socialCard: `https://${manifest.host}/assets/${Object.keys(manifest.assets).find((f) => f.startsWith("social-card.")) ?? ""}`,
    };
  }
  loaded.set(root, site);
  return site;
}

const website = () => loadWebsite(config.website.root);

export function websiteHeaders(res: ServerResponse, csp = WEBSITE_CSP): void {
  res.setHeader("Content-Security-Policy", csp);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
  if (config.nodeEnv === "production") res.setHeader("Strict-Transport-Security", "max-age=31536000");
}

function send(req: IncomingMessage, res: ServerResponse, file: WebsiteFile, status = 200, csp = WEBSITE_CSP): void {
  websiteHeaders(res, csp);
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

const USERNAME = /^[a-z0-9_.]{3,30}$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * For a shared link's request target ("/u/<username>?id=<uuid>", "/s/<story id>"): the app's
 * katkee:// link and the page's own path, or null for anything else. Strict, and checked on the
 * raw (still percent-encoded) path, so only plain names and IDs are ever echoed into the page.
 * A missing or malformed ?id= is dropped: the username alone still finds the profile.
 */
export function sharedLink(target: string): { appLink: string; linkPath: string } | null {
  const q = target.indexOf("?");
  const pathname = q < 0 ? target : target.slice(0, q);
  const profile = /^\/u\/([^/]+)\/?$/.exec(pathname)?.[1];
  if (profile !== undefined) {
    if (!USERNAME.test(profile)) return null;
    const username = profile.toLowerCase();
    const id = new URLSearchParams(q < 0 ? "" : target.slice(q + 1)).get("id")?.toLowerCase();
    const query = id && UUID.test(id) ? `?id=${id}` : "";
    return { appLink: `katkee://user/${username}${query}`, linkPath: `u/${username}${query}` };
  }
  const story = /^\/s\/([^/]+)\/?$/.exec(pathname)?.[1];
  if (story !== undefined && UUID.test(story)) {
    const id = story.toLowerCase();
    return { appLink: `katkee://story/${id}`, linkPath: `s/${id}` };
  }
  return null;
}

/** For "/i/<code>": the code (lower-case) and the app's katkee:// link, or null for anything else. */
export function inviteLinkTarget(target: string): { code: string; appLink: string; linkPath: string } | null {
  const pathname = target.split("?")[0]!;
  const raw = /^\/i\/([^/]+)\/?$/.exec(pathname)?.[1];
  if (raw === undefined) return null;
  const code = raw.toLowerCase();
  if (!INVITE_CODE_RE.test(code)) return null;
  return { code, appLink: `katkee://invite/${code}`, linkPath: `i/${code}` };
}

/** The invite page's headline (also its title, so chat link previews name the friend). */
export function inviteHeadline(inviterName: string | null): string {
  return inviterName ? `${inviterName} invited you to Katkee` : "You're invited to Katkee";
}

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function openPage(open: NonNullable<Website["openInApp"]>, link: { appLink: string; linkPath: string }): WebsiteFile {
  const html = open.template
    .split(open.markers.appLink).join(escapeHtml(link.appLink))
    .split(open.markers.linkPath).join(escapeHtml(link.linkPath));
  return prepare(Buffer.from(html), HTML, SHARED_CACHE, 5);
}

function invitePage(invite: NonNullable<Website["invite"]>, link: { appLink: string; linkPath: string }, headline: string): WebsiteFile {
  const html = invite.template
    .split(invite.markers.appLink).join(escapeHtml(link.appLink))
    .split(invite.markers.linkPath).join(escapeHtml(link.linkPath))
    .split(invite.markers.headline).join(escapeHtml(headline));
  return prepare(Buffer.from(html), HTML, PAGE_CACHE, 5);
}

function sendNotFound(req: IncomingMessage, res: ServerResponse, site: Website): void {
  send(req, res, site.notFound, 404);
}

/** Lookups that read the database: generous for a person, a wall for a scraper. */
export const webPageLimiter = new RateLimiter(60_000, 120);
/** Media addresses: a profile with many Highlights asks for many at once. */
export const webMediaLimiter = new RateLimiter(60_000, 900);

/** True when the request may go on; otherwise it has been answered with a plain 429. */
function withinLimit(req: IncomingMessage, res: ServerResponse, limiter: RateLimiter): boolean {
  try {
    limiter.check(clientIp(req));
    return true;
  } catch (error) {
    if (!(error instanceof HttpError)) throw error;
    websiteHeaders(res);
    res.statusCode = 429;
    res.setHeader("Retry-After", "60");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end(req.method === "HEAD" ? undefined : "Too many requests. Try again in a minute.\n");
    return false;
  }
}

const PROFILE_FILES = new Set(["photo", "cover"]);
const STORY_FILES = new Set(["image", "thumb", "video"]);
type WebMediaTarget =
  | { kind: "profile"; username: string; file: "photo" | "cover" }
  | { kind: "story"; storyId: string; file: "image" | "thumb" | "video" };

/**
 * For a web media address ("/u/<username>/photo", "/s/<story id>/image", ...): what it names,
 * or null for anything else. Checked on the raw path, like sharedLink.
 */
export function webMediaTarget(target: string): WebMediaTarget | null {
  const pathname = target.split("?")[0]!;
  const profile = /^\/u\/([^/]+)\/([a-z]+)$/.exec(pathname);
  if (profile && USERNAME.test(profile[1]!) && PROFILE_FILES.has(profile[2]!)) {
    return { kind: "profile", username: profile[1]!.toLowerCase(), file: profile[2] as "photo" | "cover" };
  }
  const story = /^\/s\/([^/]+)\/([a-z]+)$/.exec(pathname);
  if (story && UUID.test(story[1]!) && STORY_FILES.has(story[2]!)) {
    return { kind: "story", storyId: story[1]!.toLowerCase(), file: story[2] as "image" | "thumb" | "video" };
  }
  return null;
}

/** Which stored variant a web media address gets: processed ones only, never an original. */
function variantFor(media: MediaRecord, file: WebMediaTarget["file"]): RequestedVariant | null {
  if (file === "photo" || file === "thumb") return "thumbnail";
  if (file === "cover") return "display";
  if (file === "image") return media.kind === "photo" ? "display" : "poster";
  return media.kind === "video" ? "video_720" : null;
}

/**
 * Sends media the web may show: a redirect to a signed CDN URL (production), or the file
 * itself (development, tests), exactly as the app gets it. 404 for anything else.
 */
async function sendWebMedia(req: IncomingMessage, res: ServerResponse, site: Website): Promise<void> {
  const target = webMediaTarget(req.url ?? "");
  if (!target) return sendNotFound(req, res, site);
  if (!withinLimit(req, res, webMediaLimiter)) return;
  const media = target.kind === "profile" ? await webProfilePhoto(target.username, target.file) : await webStoryMedia(target.storyId);
  const variant = media ? variantFor(media, target.file) : null;
  const object = media && variant ? chooseObject(media, variant, false) : null;
  if (!object || object.variant === "original") return sendNotFound(req, res, site);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Robots-Tag", "noindex");
  if (cdnEnabled()) {
    res.statusCode = 302;
    res.setHeader("Location", signedCdnUrl(object.key).url);
    res.setHeader("Cache-Control", SHARED_CACHE);
    res.end();
    return;
  }
  await streamObject(req, res, object, mediaStorage);
}

/** The profile sitemap, made at most once an hour: the newest 50,000 accounts that show on the web. */
let sitemapCache: { file: WebsiteFile; at: number } | null = null;
const SITEMAP_TTL_MS = 3_600_000;
export const resetSitemapCache = () => { sitemapCache = null; };

async function profileSitemap(origin: string): Promise<WebsiteFile> {
  if (sitemapCache && Date.now() - sitemapCache.at < SITEMAP_TTL_MS) return sitemapCache.file;
  const names = await sitemapUsernames(50_000);
  const urls = names.map((n) => `  <url><loc>${origin}/u/${escapeHtml(n)}</loc></url>\n`).join("");
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}</urlset>\n`;
  const file = prepare(Buffer.from(body), "application/xml; charset=utf-8", "public, max-age=3600", 5);
  sitemapCache = { file, at: Date.now() };
  return file;
}

/** The web profile for a shared link's path ("u/<name>?id=<id>", "s/<id>"), when there is one to show. */
async function webPageFor(site: Website, linkPath: string): Promise<{ story: boolean; values: ReturnType<typeof webPageValues> } | null> {
  if (linkPath.startsWith("u/")) {
    const [username, search] = linkPath.slice(2).split("?");
    const account = await findWebAccount(username!, new URLSearchParams(search ?? "").get("id"));
    return account ? { story: false, values: webPageValues(await webProfile(account), null, site.origin, site.socialCard) } : null;
  }
  const found = await findWebStoryOwner(linkPath.slice(2));
  if (!found) return null;
  const profile = await webProfile(found.account);
  // Expired or not ready between the two reads: the minimal page, like any other gone Story.
  if (!profile.stories.some((s) => s.id === found.storyId)) return null;
  return { story: true, values: webPageValues(profile, found.storyId, site.origin, site.socialCard) };
}

export function registerWebsiteRoutes(router: Router): void {
  const site = website();
  if (!site) return;
  const both = (route: string, handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>) => {
    router.get(route, handler);
    router.add("HEAD", route, handler);
  };
  for (const [route, page] of site.pages) both(route, (req, res) => send(req, res, page));
  for (const [route, file] of site.files) both(route, (req, res) => send(req, res, file));
  const open = site.openInApp;
  const web = site.webProfile;
  if (open) {
    for (const route of ["/u/:username", "/s/:storyId"]) {
      both(route, async (req, res) => {
        const link = sharedLink(req.url ?? "");
        if (!link) return sendNotFound(req, res, site);
        if (web) {
          if (!withinLimit(req, res, webPageLimiter)) return;
          // A database hiccup still answers, with the page that works for every link.
          const page = await webPageFor(site, link.linkPath).catch(() => null);
          if (page) {
            if (page.story) res.setHeader("X-Robots-Tag", "noindex");
            if (req.method === "GET") countWebPage(page.story ? "story" : "profile");
            const html = fillWebPage(web.template, web.markers, page.values);
            return send(req, res, prepare(Buffer.from(html), HTML, SHARED_CACHE, 5), 200, webProfileCsp());
          }
        }
        // Also in the page's <meta>; the header covers crawlers that only read headers.
        res.setHeader("X-Robots-Tag", "noindex");
        send(req, res, openPage(open, link));
      });
    }
  }
  if (web) {
    for (const route of ["/u/:username/:file", "/s/:storyId/:file"]) both(route, (req, res) => sendWebMedia(req, res, site));
    both("/sitemap-profiles.xml", async (req, res) => {
      if (!withinLimit(req, res, webPageLimiter)) return;
      send(req, res, await profileSitemap(site.origin));
    });
  }
  const invite = site.invite;
  if (invite) {
    both("/i/:code", async (req, res) => {
      const link = inviteLinkTarget(req.url ?? "");
      if (!link) return sendNotFound(req, res, site);
      // A database hiccup still shows the page (with the plain headline): it works without a name.
      const inviter = await inviterForCode(link.code).catch(() => null);
      res.setHeader("X-Robots-Tag", "noindex");
      send(req, res, invitePage(invite, link, inviteHeadline(inviter?.displayName ?? null)));
    });
  }
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
    // The Admin console lives on the API host; katkee.com/admin points there.
    if (readOnly && (pathname === "/admin" || pathname.startsWith("/admin/"))) {
      res.statusCode = 302;
      res.setHeader("Location", `${config.admin.origin}/admin/login`);
      res.setHeader("Cache-Control", "no-store");
      res.end();
      return true;
    }
    const known = site.pages.has(pathname) || site.files.has(pathname) || pathname.startsWith("/assets/") || (!!site.openInApp && sharedLink(target) !== null)
      || (!!site.invite && inviteLinkTarget(target) !== null) || (!!site.webProfile && (webMediaTarget(target) !== null || pathname === "/sitemap-profiles.xml"));
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
  if (readOnly && (site.pages.has(pathname) || (!!site.openInApp && sharedLink(target) !== null) || (!!site.invite && inviteLinkTarget(target) !== null))) {
    redirect(res, `https://${siteHost}${target}`);
    return true;
  }
  return false;
}
