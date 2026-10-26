/**
 * Sharing your own Story to other apps, as a picture or a video with a small Katkee mark.
 *
 * A photo Story is drawn and saved on the phone. A video Story is put together here, because a
 * phone can't re-encode video with the Story's text on it:
 *
 *   POST /media/overlays                    -> the app's drawing of the text, stickers, drawing and
 *                                              mark, as a transparent PNG (kept as drawn)
 *   POST /stories/:id/export                -> queued for the media worker (owner only, videos only)
 *   GET  /stories/:id/export/:exportId      -> processing | ready (a signed URL) | failed
 *
 * The overlay is never served and can't be used for anything else; the job deletes it when done.
 * The finished MP4 is for its owner only and is deleted 24 hours later (retention.ts).
 */
import { randomUUID } from "node:crypto";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import sharp, { type OutputInfo } from "sharp";
import { config } from "../../config/env";
import { query, queryOne, type Row } from "../../db/psql";
import { HttpError } from "../../http/errors";
import { enforceSharedLimit } from "../../shared/sharedRateLimit";
import { findTrack } from "../music/music.repository";
import { cdnEnabled, signedCdnUrl } from "./delivery";
import { findMediaById, mapMediaRow, MEDIA_COLUMNS, type MediaRecord } from "./media.repository";
import { composeStoryExport, EXPORT_SIZE, MediaRejectedError, sha256File } from "./processing";
import type { ObjectStore } from "./storage";
import { streamObject } from "./stream";
import { MAX_VIDEO_BYTES } from "./validation";

/** Videos one person may prepare for sharing in a day (each is a full encode). */
export const EXPORTS_PER_DAY = 20;
/** Overlay uploads a day: a few retries more than exports. */
export const OVERLAYS_PER_DAY = 40;
/** An overlay is a flat 720×1280 or 1080×1920 PNG; with drawing on it, still well under this. */
export const MAX_OVERLAY_BYTES = 8 * 1024 * 1024;
/** How long a prepared video can be downloaded. */
export const EXPORT_HOURS = 24;
const MAX_MUSIC_BYTES = 30 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const GENERIC_FAILURE = "We couldn't prepare this video. Try again.";
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

async function readBody(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > maxBytes) throw new HttpError(413, `The overlay can be up to ${maxBytes / (1024 * 1024)} MiB.`);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/**
 * Stores the app's transparent drawing of a Story. 9:16 between 360 and 1080 wide, decoded and
 * written again (no metadata), transparency kept.
 */
export async function receiveOverlay(req: IncomingMessage, ownerId: string, store: ObjectStore): Promise<{ id: string; width: number; height: number }> {
  if ((req.headers["content-type"] ?? "").split(";")[0]!.trim().toLowerCase() !== "image/png") throw new HttpError(415, "The overlay must be a PNG.");
  await enforceSharedLimit(`story-overlay:${ownerId}`, OVERLAYS_PER_DAY, 86400, "You've shared a lot today.");
  const buf = await readBody(req, MAX_OVERLAY_BYTES);
  if (buf.length < 24 || !buf.subarray(0, 8).equals(PNG_MAGIC) || buf.subarray(12, 16).toString("ascii") !== "IHDR") {
    throw new HttpError(415, "The overlay must be a PNG.");
  }
  const width = buf.readUInt32BE(16), height = buf.readUInt32BE(20);
  if (width < 360 || width > 1080 || Math.abs(height - (width * 16) / 9) > Math.max(2, height * 0.01)) {
    throw new HttpError(422, "The overlay must be 9:16, between 360 and 1080 pixels wide.");
  }
  const workDir = await fsp.mkdtemp(path.join(os.tmpdir(), "katkee-upload-"));
  try {
    const file = path.join(workDir, "overlay.png");
    let info: OutputInfo;
    try {
      info = await sharp(buf, { failOn: "error", limitInputPixels: 1080 * 1920 }).ensureAlpha().png({ compressionLevel: 8 }).toFile(file);
    } catch (error) {
      throw new HttpError(422, "The overlay couldn't be read.", { overlay: (error as Error).message.slice(0, 120) });
    }
    const id = randomUUID();
    // The API may write only originals (infra: m/*/original); for an overlay that is all there is.
    const key = `m/${id}/original`;
    await store.putFile(key, file, "image/png");
    await query(
      `INSERT INTO media (id, owner_id, kind, mime_type, byte_size, width, height, checksum_sha256, storage_key, status, processed_at, export_overlay)
       VALUES (:'id', :'owner', 'photo', 'image/png', :'size', :'width'::integer, :'height'::integer, :'checksum', :'key', 'ready', now(), true)`,
      { id, owner: ownerId, size: info.size, width: info.width, height: info.height, checksum: await sha256File(file), key },
    );
    return { id, width: info.width, height: info.height };
  } finally {
    await fsp.rm(workDir, { recursive: true, force: true });
  }
}

interface ShareableStory {
  id: string;
  ownerId: string;
  media: MediaRecord;
}

/** The owner's own Story (live, expired or archived; not deleted or removed by moderation). */
async function ownStory(ownerId: string, storyId: string): Promise<ShareableStory> {
  if (!UUID.test(storyId)) throw new HttpError(404, "Story not found.");
  const row = await queryOne(
    `SELECT s.id AS story_id, s.owner_id AS story_owner, s.deleted_at IS NULL AND s.moderation_removed_at IS NULL AS available,
            ${MEDIA_COLUMNS.split(", ").map((c) => `m.${c}`).join(", ")}
     FROM stories s JOIN media m ON m.id = s.media_id WHERE s.id = :'id'`,
    { id: storyId },
  );
  if (!row || row.story_owner !== ownerId || row.available !== "t") throw new HttpError(404, "Story not found.");
  return { id: row.story_id as string, ownerId, media: mapMediaRow(row) };
}

export function parseExportInput(body: unknown): { overlayMediaId: string | null } {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const overlay = b.overlayMediaId ?? null;
  if (overlay !== null && (typeof overlay !== "string" || !UUID.test(overlay))) {
    throw new HttpError(422, "Invalid export request.", { overlayMediaId: "overlayMediaId must be an id or null." });
  }
  return { overlayMediaId: overlay === null ? null : overlay.toLowerCase() };
}

export interface ExportStatus {
  id: string;
  status: "processing" | "ready" | "failed";
  url?: string;
  error?: string;
  expiresAt: string;
}

/** Queues a video Story for sharing. */
export async function requestExport(ownerId: string, storyId: string, input: { overlayMediaId: string | null }): Promise<ExportStatus> {
  const story = await ownStory(ownerId, storyId);
  if (story.media.kind !== "video") throw new HttpError(422, "Only video Stories are prepared here; photos are saved on your phone.");
  if (story.media.status !== "ready" || story.media.purgedAt || !(story.media.variants.video_720 ?? story.media.variants.video_480)) {
    throw new HttpError(409, "This Story's video isn't available.");
  }
  if (input.overlayMediaId) {
    const overlay = await findMediaById(input.overlayMediaId);
    if (!overlay || overlay.ownerId !== ownerId || overlay.purgedAt) throw new HttpError(404, "Overlay not found.");
    if (!overlay.exportOverlay || overlay.status !== "ready") {
      throw new HttpError(422, "Invalid export request.", { overlayMediaId: "Upload the overlay with POST /api/v1/media/overlays." });
    }
  }
  await enforceSharedLimit(`story-export:${ownerId}`, EXPORTS_PER_DAY, 86400, "You've shared a lot of videos today.");
  // Each overlay goes with one export: the job deletes it when it's done.
  const row = await queryOne(
    `WITH e AS (
       INSERT INTO story_exports (story_id, owner_id, overlay_media_id, expires_at)
       SELECT :'story', :'owner', NULLIF(:'overlay', '')::uuid, now() + make_interval(hours => :'hours'::integer)
       WHERE NULLIF(:'overlay', '') IS NULL OR NOT EXISTS (SELECT 1 FROM story_exports WHERE overlay_media_id = NULLIF(:'overlay', '')::uuid)
       RETURNING id, expires_at)
     SELECT e.id, e.expires_at, pg_notify('media_jobs', e.id::text) AS notified FROM e`,
    { story: story.id, owner: ownerId, overlay: input.overlayMediaId ?? "", hours: EXPORT_HOURS },
  );
  if (!row) throw new HttpError(409, "This overlay was already used. Upload it again.");
  return { id: row.id as string, status: "processing", expiresAt: new Date(row.expires_at as string).toISOString() };
}

interface ExportRow {
  id: string;
  storyId: string;
  ownerId: string;
  overlayMediaId: string | null;
  status: "queued" | "running" | "ready" | "failed";
  attempts: number;
  maxAttempts: number;
  storageKey: string | null;
  byteSize: number;
  error: string | null;
  expiresAt: string;
}

const EXPORT_COLUMNS = "id, story_id, owner_id, overlay_media_id, status, attempts, max_attempts, storage_key, byte_size, error, expires_at";

function mapExport(row: Row): ExportRow {
  return {
    id: row.id as string,
    storyId: row.story_id as string,
    ownerId: row.owner_id as string,
    overlayMediaId: row.overlay_media_id ?? null,
    status: row.status as ExportRow["status"],
    attempts: Number(row.attempts),
    maxAttempts: Number(row.max_attempts),
    storageKey: row.storage_key ?? null,
    byteSize: Number(row.byte_size ?? 0),
    error: row.error ?? null,
    expiresAt: new Date(row.expires_at as string).toISOString(),
  };
}

async function ownExport(ownerId: string, storyId: string, exportId: string): Promise<ExportRow> {
  await ownStory(ownerId, storyId);
  if (!UUID.test(exportId)) throw new HttpError(404, "Export not found.");
  const row = await queryOne(
    `SELECT ${EXPORT_COLUMNS} FROM story_exports WHERE id = :'id' AND story_id = :'story' AND owner_id = :'owner' AND expires_at > now()`,
    { id: exportId, story: storyId, owner: ownerId },
  );
  if (!row) throw new HttpError(404, "Export not found.");
  return mapExport(row);
}

export async function getExport(ownerId: string, storyId: string, exportId: string): Promise<ExportStatus> {
  const job = await ownExport(ownerId, storyId, exportId);
  const base = { id: job.id, expiresAt: job.expiresAt };
  if (job.status === "failed") return { ...base, status: "failed", error: job.error ?? GENERIC_FAILURE };
  if (job.status !== "ready" || !job.storageKey) return { ...base, status: "processing" };
  // A signed CDN URL in production; this API (with the sign-in header) in development and tests.
  const url = cdnEnabled() ? signedCdnUrl(job.storageKey).url : `/api/v1/stories/${job.storyId}/export/${job.id}/file`;
  return { ...base, status: "ready", url };
}

/** Development and tests: streams the prepared video (production redirects to the CDN). */
export async function sendExportFile(req: IncomingMessage, res: ServerResponse, ownerId: string, storyId: string, exportId: string, store: ObjectStore): Promise<void> {
  const job = await ownExport(ownerId, storyId, exportId);
  if (job.status !== "ready" || !job.storageKey) throw new HttpError(404, "Export not found.");
  if (cdnEnabled()) {
    res.writeHead(302, { Location: signedCdnUrl(job.storageKey).url, "Cache-Control": "private, no-store" });
    res.end();
    return;
  }
  await streamObject(req, res, { key: job.storageKey, mimeType: "video/mp4", size: job.byteSize, etag: `"export-${job.id}"` }, store);
}

// --- the worker side ---------------------------------------------------------------------------

export async function claimExportJob(workerId: string, leaseSeconds: number): Promise<ExportRow | null> {
  const row = await queryOne(
    `UPDATE story_exports e
        SET status = 'running', attempts = e.attempts + 1, locked_by = :'worker',
            locked_until = now() + make_interval(secs => :'lease'::integer)
      WHERE e.id = (
        SELECT id FROM story_exports
         WHERE (status = 'queued' OR (status = 'running' AND locked_until < now())) AND expires_at > now()
         ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1)
      RETURNING ${EXPORT_COLUMNS.split(", ").map((c) => `e.${c}`).join(", ")}`,
    { worker: workerId, lease: leaseSeconds },
  );
  return row ? mapExport(row) : null;
}

/** The overlay has done its job (or the export can't use it): its object and row go now. */
async function deleteOverlay(store: ObjectStore, mediaId: string | null): Promise<void> {
  if (!mediaId) return;
  const media = await findMediaById(mediaId);
  if (!media?.exportOverlay) return;
  await store.deleteObjects([media.storageKey]).catch(() => undefined);
  await query(`DELETE FROM media WHERE id = :'id' AND export_overlay`, { id: media.id });
}

async function failExport(job: ExportRow, workerId: string, userMessage: string, detail: string, retryable: boolean): Promise<"retrying" | "failed"> {
  if (retryable && job.attempts < job.maxAttempts) {
    await query(
      `UPDATE story_exports SET status = 'queued', locked_by = NULL, locked_until = NULL, last_error = left(:'detail', 2000)
       WHERE id = :'id' AND status = 'running' AND locked_by = :'worker'`,
      { id: job.id, worker: workerId, detail },
    );
    return "retrying";
  }
  await query(
    `UPDATE story_exports SET status = 'failed', error = :'message', last_error = left(:'detail', 2000), finished_at = now(), locked_until = NULL
     WHERE id = :'id' AND status = 'running'`,
    { id: job.id, message: userMessage, detail },
  );
  return "failed";
}

export interface ExportProcessOptions {
  workerId: string;
  leaseSeconds: number;
  jobTimeoutSeconds: number;
  log?: (event: Record<string, unknown>) => void;
}

/** Puts one claimed export together. Never throws for problems with the Story; records them. */
export async function processExportJob(job: ExportRow, store: ObjectStore, options: ExportProcessOptions): Promise<"done" | "retrying" | "failed"> {
  const log = options.log ?? ((event: Record<string, unknown>) => console.log(JSON.stringify({ ts: new Date().toISOString(), ...event })));
  const started = Date.now();
  const workDir = await fsp.mkdtemp(path.join(os.tmpdir(), "katkee-media-"));
  const heartbeat = setInterval(() => {
    query(`UPDATE story_exports SET locked_until = now() + make_interval(secs => :'lease'::integer) WHERE id = :'id' AND status = 'running' AND locked_by = :'worker'`,
      { id: job.id, lease: options.leaseSeconds, worker: options.workerId }).catch(() => undefined);
  }, Math.max(5, options.leaseSeconds / 3) * 1000);
  try {
    if (job.attempts > job.maxAttempts) {
      // A lease ran out on the last attempt (the worker died).
      const outcome = await failExport(job, options.workerId, GENERIC_FAILURE, "attempts exhausted after lease expiry", false);
      await deleteOverlay(store, job.overlayMediaId);
      return outcome;
    }
    const row = await queryOne(
      `SELECT s.deleted_at IS NULL AND s.moderation_removed_at IS NULL AS available, s.audio_muted, s.crop, s.music, s.media_id
       FROM stories s WHERE s.id = :'id'`,
      { id: job.storyId },
    );
    const media = row ? await findMediaById(row.media_id as string) : null;
    const variant = media?.variants.video_720 ?? media?.variants.video_480;
    if (!row || row.available !== "t" || !media || media.purgedAt || media.kind !== "video" || !variant) {
      throw new MediaRejectedError("This Story is no longer available.");
    }
    const video = path.join(workDir, "video.mp4");
    await store.downloadToFile(variant.key, video, MAX_VIDEO_BYTES);
    let overlay: string | null = null;
    if (job.overlayMediaId) {
      const media = await findMediaById(job.overlayMediaId);
      if (!media?.exportOverlay || media.purgedAt) throw new MediaRejectedError(GENERIC_FAILURE, "overlay missing");
      overlay = path.join(workDir, "overlay.png");
      await store.downloadToFile(media.storageKey, overlay, MAX_OVERLAY_BYTES);
    }
    let music: { file: string; startMs: number; durationMs: number } | null = null;
    const storyMusic = row.music ? (JSON.parse(row.music) as { trackId?: string; startMs?: number; durationMs?: number }) : null;
    const track = storyMusic?.trackId ? await findTrack(storyMusic.trackId) : null;
    if (track && storyMusic) {
      music = { file: path.join(workDir, "music.mp3"), startMs: Math.max(0, Number(storyMusic.startMs) || 0), durationMs: Math.max(1000, Number(storyMusic.durationMs) || 15_000) };
      await store.downloadToFile(track.storageKey, music.file, MAX_MUSIC_BYTES);
    }
    const crop = row.crop ? (JSON.parse(row.crop) as { zoom?: number; offsetX?: number; offsetY?: number }) : {};
    const output = path.join(workDir, "story.mp4");
    const result = await composeStoryExport(
      { video, overlay, music, audioMuted: row.audio_muted === "t", crop: { zoom: Number(crop.zoom ?? 1), offsetX: Number(crop.offsetX ?? 0), offsetY: Number(crop.offsetY ?? 0) } },
      output,
      { ffmpeg: config.media.ffmpegPath, ffprobe: config.media.ffprobePath, maxSeconds: config.media.maxVideoSeconds, deadline: started + options.jobTimeoutSeconds * 1000 },
    );
    // Under m/ like every media object (the worker may write only there; export ids are UUIDs
    // too), one name per attempt so a worker that lost its lease never overwrites the kept copy.
    const key = `m/${job.id}/export-${job.attempts}.mp4`;
    await store.putFile(key, output, "video/mp4", "private, max-age=86400");
    const saved = await query(
      `UPDATE story_exports SET status = 'ready', storage_key = :'key', byte_size = :'size'::bigint, finished_at = now(), locked_until = NULL, error = NULL
       WHERE id = :'id' AND status = 'running' AND locked_by = :'worker' RETURNING id`,
      { id: job.id, key, size: result.byteSize, worker: options.workerId },
    );
    // Another worker took over after our lease ran out; its copy is the one kept.
    if (!saved.length) await store.deleteObjects([key]).catch(() => undefined);
    await deleteOverlay(store, job.overlayMediaId);
    log({ event: "story_export_ready", exportId: job.id, attempt: job.attempts, ms: Date.now() - started, bytes: result.byteSize, size: EXPORT_SIZE });
    return "done";
  } catch (error) {
    const rejected = error instanceof MediaRejectedError;
    const detail = error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error);
    const outcome = await failExport(job, options.workerId, rejected ? error.userMessage : GENERIC_FAILURE, detail, !rejected);
    if (outcome === "failed") await deleteOverlay(store, job.overlayMediaId);
    log({ event: "story_export_error", exportId: job.id, attempt: job.attempts, outcome, error: (error as Error)?.message?.slice(0, 300) });
    return outcome;
  } finally {
    clearInterval(heartbeat);
    await fsp.rm(workDir, { recursive: true, force: true });
  }
}

/** Retention: prepared videos (and any export record) go once they expire. */
export async function expiredExports(store: ObjectStore, batch: number): Promise<number> {
  const rows = await query(`SELECT id, storage_key, overlay_media_id FROM story_exports WHERE expires_at < now() ORDER BY expires_at LIMIT :'batch'`, { batch });
  for (const row of rows) {
    if (row.storage_key) await store.deleteObjects([row.storage_key]);
    await deleteOverlay(store, row.overlay_media_id ?? null);
    await query(`DELETE FROM story_exports WHERE id = :'id'`, { id: row.id as string });
  }
  return rows.length;
}
