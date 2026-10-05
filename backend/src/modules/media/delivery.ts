/**
 * Which stored object a viewer gets, and how it reaches them.
 *
 * People other than the uploader only ever receive processed variants (metadata
 * stripped); the original is owner-only. With a CDN configured (required in
 * production) media is delivered by CloudFront signed URLs: API responses embed
 * them, and /file answers with a redirect. Expiries are rounded up to a TTL
 * boundary so a URL stays identical, and cacheable on the device, for a while.
 * Without a CDN (development, tests) the API streams the object itself.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { getSignedUrl } from "@aws-sdk/cloudfront-signer";
import { config } from "../../config/env";
import { HttpError } from "../../http/errors";
import type { MediaRecord, MediaStatus } from "./media.repository";
import type { ObjectStore } from "./storage";
import { streamObject } from "./stream";

export const REQUESTABLE_VARIANTS = ["original", "display", "thumbnail", "poster", "video_720", "video_480"] as const;
export type RequestedVariant = (typeof REQUESTABLE_VARIANTS)[number];

export interface DeliverableObject {
  variant: RequestedVariant;
  key: string;
  mimeType: string;
  size: number;
  etag: string;
}

export function parseVariant(value: string | null): RequestedVariant | null {
  if (value === null || value === "") return null;
  if ((REQUESTABLE_VARIANTS as readonly string[]).includes(value)) return value as RequestedVariant;
  throw new HttpError(400, "Unknown media variant.");
}

const IMAGE_FALLBACKS: Record<string, RequestedVariant[]> = {
  thumbnail: ["thumbnail", "display", "poster"],
  display: ["display", "poster", "thumbnail"],
  poster: ["poster", "display", "thumbnail"],
};
const VIDEO_FALLBACKS: Record<string, RequestedVariant[]> = {
  video_720: ["video_720", "video_480"],
  video_480: ["video_480", "video_720"],
};

/**
 * Resolves a request to a stored object, or null when nothing suitable exists.
 * Media uploaded before the pipeline (never processed) keeps serving its original
 * until the backfill job has produced variants, exactly as it did before.
 */
export function chooseObject(media: MediaRecord, requested: RequestedVariant | null, isOwner: boolean): DeliverableObject | null {
  if (media.purgedAt) return null;
  if (!isOwner && media.status !== "ready") return null;
  const tag = media.checksumSha256 ?? media.id;
  const variant = (name: RequestedVariant): DeliverableObject | null => {
    const v = media.variants[name as keyof MediaRecord["variants"]];
    return v ? { variant: name, key: v.key, mimeType: v.mimeType, size: v.byteSize, etag: `"${tag}-${name}"` } : null;
  };
  const original: DeliverableObject | null = media.originalPurgedAt || media.status === "uploading"
    ? null
    : { variant: "original", key: media.storageKey, mimeType: media.mimeType, size: media.byteSize, etag: `"${tag}"` };
  const unprocessed = media.processedAt === null && Object.keys(media.variants).length === 0;
  const best = () => media.kind === "photo"
    ? variant("display") ?? variant("thumbnail") ?? (unprocessed ? original : null)
    : variant("video_720") ?? variant("video_480") ?? (unprocessed ? original : null);

  if (requested === null) return isOwner && original ? original : best();
  if (requested === "original") return isOwner ? original ?? best() : null;
  const imageChain = IMAGE_FALLBACKS[requested];
  if (imageChain) {
    for (const name of imageChain) {
      const found = variant(name);
      if (found) return found;
    }
    return unprocessed && media.kind === "photo" ? original : null;
  }
  for (const name of VIDEO_FALLBACKS[requested] ?? []) {
    const found = variant(name);
    if (found) return found;
  }
  return unprocessed && media.kind === "video" ? original : null;
}

export function cdnEnabled(): boolean {
  return config.media.cdn.domain !== "";
}

function privateKeyPem(): string {
  const raw = config.media.cdn.privateKey;
  return raw.includes("BEGIN") ? raw.replace(/\\n/g, "\n") : Buffer.from(raw, "base64").toString("utf8");
}

/** Epoch seconds, rounded up to a multiple of the TTL: valid for between one and two TTLs. */
export function urlExpiry(nowMs: number, ttlSeconds: number): number {
  return Math.ceil((nowMs / 1000 + ttlSeconds) / ttlSeconds) * ttlSeconds;
}

export function signedCdnUrl(key: string, nowMs = Date.now()): { url: string; expiresAt: string } {
  const expires = urlExpiry(nowMs, config.media.cdn.urlTtlSeconds);
  const path = key.split("/").map(encodeURIComponent).join("/");
  const url = getSignedUrl({
    url: `https://${config.media.cdn.domain}/${path}`,
    keyPairId: config.media.cdn.keyPairId,
    privateKey: privateKeyPem(),
    dateLessThan: new Date(expires * 1000),
    algorithm: process.env.CLOUDFRONT_SIGNING_ALGORITHM === "SHA256" ? "SHA256" : "SHA1",
  });
  return { url, expiresAt: new Date(expires * 1000).toISOString() };
}

const apiFileUrl = (media: MediaRecord, variant: RequestedVariant) => `/api/v1/media/${media.id}/file?variant=${variant}`;

export interface MediaDelivery {
  status: MediaStatus;
  kind: MediaRecord["kind"];
  width: number | null;
  height: number | null;
  durationMs: number | null;
  /** Small image for grids, rings and covers. */
  thumbnailUrl: string | null;
  /** Full-screen image: the photo itself, or a video's poster frame (show it while the video loads). */
  imageUrl: string | null;
  /** Best first; pick a lower one on slow or metered connections. */
  videos: { variant: "video_720" | "video_480"; url: string; width: number; height: number; bitrate: number | null }[];
  /** Absolute URLs are signed CDN URLs valid until then; relative URLs are this API and need the bearer token. */
  urlsExpireAt: string | null;
}

/** URLs for everything a client needs to show this media. Call only after authorizing the viewer. */
export function deliveryFor(media: MediaRecord, isOwner: boolean, nowMs = Date.now()): MediaDelivery {
  const base = { status: media.status, kind: media.kind, width: media.width, height: media.height, durationMs: media.durationMs };
  if (media.status !== "ready" || media.purgedAt) {
    return { ...base, thumbnailUrl: null, imageUrl: null, videos: [], urlsExpireAt: null };
  }
  let expiresAt: string | null = null;
  const urlFor = (requested: RequestedVariant): string | null => {
    const object = chooseObject(media, requested, isOwner);
    if (!object) return null;
    // Unprocessed legacy media goes through the API, which applies the fallback rules.
    if (!cdnEnabled() || object.variant === "original") return apiFileUrl(media, requested);
    const signed = signedCdnUrl(object.key, nowMs);
    expiresAt = signed.expiresAt;
    return signed.url;
  };
  const videos: MediaDelivery["videos"] = [];
  if (media.kind === "video") {
    for (const name of ["video_720", "video_480"] as const) {
      const v = media.variants[name];
      const url = v ? urlFor(name) : null;
      if (v && url) videos.push({ variant: name, url, width: v.width, height: v.height, bitrate: v.bitrate ?? null });
    }
    if (!videos.length) {
      const url = urlFor("video_720");
      if (url) videos.push({ variant: "video_720", url, width: media.width ?? 0, height: media.height ?? 0, bitrate: null });
    }
  }
  return {
    ...base,
    thumbnailUrl: urlFor("thumbnail"),
    imageUrl: urlFor(media.kind === "photo" ? "display" : "poster"),
    videos,
    urlsExpireAt: expiresAt,
  };
}

/** Answers a file request for already-authorized media: CDN redirect, or a ranged stream. */
export async function sendMediaFile(
  req: IncomingMessage, res: ServerResponse, media: MediaRecord, requested: RequestedVariant | null, isOwner: boolean, store: ObjectStore,
  options: { redirect?: boolean } = {},
): Promise<void> {
  const object = chooseObject(media, requested, isOwner);
  if (!object) throw new HttpError(404, "Media not found.");
  // The Admin console reads media with same-origin fetch(), so it is always streamed.
  if (cdnEnabled() && options.redirect !== false) {
    res.writeHead(302, { Location: signedCdnUrl(object.key).url, "Cache-Control": "private, no-store" });
    res.end();
    return;
  }
  await streamObject(req, res, object, store);
}
