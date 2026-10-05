import type { Router } from "../../http/router";
import { requireAuth } from "../../http/middleware/auth.middleware";
import { sendJson } from "../../http/respond";
import { HttpError } from "../../http/errors";
import * as mediaService from "./media.service";
import * as mediaRepo from "./media.repository";
import { mediaStorage } from "./instance";
import type { MediaRecord } from "./media.repository";
import { deliveryFor, parseVariant, sendMediaFile } from "./delivery";
import * as uploads from "./uploads";
import * as storiesService from "../stories/stories.service";

export function toPublicMedia(media: MediaRecord, isOwner = true) {
  return {
    id: media.id,
    kind: media.kind,
    mimeType: media.mimeType,
    byteSize: media.byteSize,
    width: media.width,
    height: media.height,
    durationMs: media.durationMs,
    status: media.status,
    createdAt: media.createdAt,
    // Why processing failed, and whether "Retry" can help (owner only).
    processingError: isOwner ? media.processingError : null,
    retryable: isOwner ? media.status === "failed" && media.processingErrorRetryable : false,
    delivery: deliveryFor(media, isOwner),
  };
}

/**
 * Owner-only, UNLESS the media has been published as a Story the viewer
 * is otherwise allowed to see (audience/privacy/block rules all reused
 * from stories.service — see canAccessMediaViaStory's own comment).
 */
async function requireAccessibleMedia(id: string, viewerId: string): Promise<MediaRecord> {
  const media = await mediaRepo.findMediaById(id, true);
  if (!media || media.purgedAt) throw new HttpError(404, "Media not found.");
  if (media.ownerId === viewerId) return media;
  if (media.status === "ready" && (await storiesService.canAccessMediaViaStory(id, viewerId))) return media;
  throw new HttpError(404, "Media not found.");
}

function queryOf(url: string | undefined): URLSearchParams {
  const raw = url ?? "";
  const i = raw.indexOf("?");
  return new URLSearchParams(i === -1 ? "" : raw.slice(i + 1));
}

export function registerMediaRoutes(router: Router): void {
  router.post(
    "/api/v1/media/photos",
    async (req, res) => {
      requireAuth(req);
      const media = await mediaService.receiveUpload(req, req.userId as string, "photo", mediaStorage);
      sendJson(res, 201, { media: toPublicMedia(media) });
    },
    { rawBody: true },
  );

  router.post(
    "/api/v1/media/videos",
    async (req, res) => {
      requireAuth(req);
      const media = await mediaService.receiveUpload(req, req.userId as string, "video", mediaStorage);
      sendJson(res, 201, { media: toPublicMedia(media) });
    },
    { rawBody: true },
  );

  // Resumable direct-to-storage uploads (see uploads.ts).
  router.post("/api/v1/media/uploads", async (req, res) => {
    requireAuth(req);
    const input = uploads.parseCreateUploadInput(req.body);
    const result = await uploads.createUpload(mediaStorage, req.userId as string, input);
    sendJson(res, result.created ? 201 : 200, { media: toPublicMedia(result.media), upload: result.upload });
  });

  router.get("/api/v1/media/uploads/:id", async (req, res) => {
    requireAuth(req);
    const result = await uploads.getUpload(mediaStorage, req.userId as string, req.params.id as string);
    sendJson(res, 200, { media: toPublicMedia(result.media), upload: result.upload });
  });

  router.post("/api/v1/media/uploads/:id/complete", async (req, res) => {
    requireAuth(req);
    const media = await uploads.completeUpload(mediaStorage, req.userId as string, req.params.id as string);
    sendJson(res, 200, { media: toPublicMedia(media) });
  });

  router.post("/api/v1/media/uploads/:id/abort", async (req, res) => {
    requireAuth(req);
    await uploads.abortUpload(mediaStorage, req.userId as string, req.params.id as string);
    sendJson(res, 204, undefined);
  });

  // Signed part URLs of the local development store. Like S3, the signature is the credential.
  router.put(
    "/api/v1/media/uploads/:id/parts/:partNumber",
    async (req, res) => {
      const etag = await uploads.receiveLocalPart(
        mediaStorage, req.params.id as string, req.params.partNumber as string, queryOf(req.url), req, req.headers["content-length"],
      );
      res.writeHead(200, { ETag: etag, "Content-Length": "0" });
      res.end();
    },
    { rawBody: true },
  );

  router.post("/api/v1/media/:id/retry-processing", async (req, res) => {
    requireAuth(req);
    const media = await uploads.retryProcessing(req.userId as string, req.params.id as string);
    sendJson(res, 200, { media: toPublicMedia(media) });
  });

  router.get("/api/v1/media/:id", async (req, res) => {
    requireAuth(req);
    const media = await requireAccessibleMedia(req.params.id as string, req.userId as string);
    sendJson(res, 200, { media: toPublicMedia(media, media.ownerId === req.userId) });
  });

  // ?variant=original|display|thumbnail|poster|video_720|video_480. Originals are owner-only.
  router.get("/api/v1/media/:id/file", async (req, res) => {
    requireAuth(req);
    const variant = parseVariant(queryOf(req.url).get("variant"));
    const media = await requireAccessibleMedia(req.params.id as string, req.userId as string);
    await sendMediaFile(req, res, media, variant, media.ownerId === req.userId, mediaStorage);
  });
}
