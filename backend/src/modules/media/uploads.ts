/**
 * Resumable direct-to-storage uploads.
 *
 *   POST /media/uploads            -> media row (status 'uploading') + signed part URLs
 *   PUT  <part url> x N            -> straight to S3 (or the local store in development)
 *   GET  /media/uploads/:id        -> which parts arrived, fresh URLs for the rest (resume)
 *   POST /media/uploads/:id/complete -> verify every byte arrived, then 'processing'
 *   POST /media/uploads/:id/abort
 *
 * Creating is idempotent per device outbox id, part URLs sign the exact part
 * length, and completion checks the assembled object's size against what was
 * declared before anything is processed.
 */
import { randomUUID } from "node:crypto";
import type { Readable } from "node:stream";
import { config } from "../../config/env";
import { query, queryOne } from "../../db/psql";
import { HttpError } from "../../http/errors";
import { enforceSharedLimit } from "../../shared/sharedRateLimit";
import { assertCanContribute } from "../admin/account-policy";
import { MEDIA_COLUMNS, mapMediaRow, findMediaById, type MediaRecord } from "./media.repository";
import { LocalObjectStore, ObjectTooLargeError, verifyLocalPartSignature, type ObjectStore } from "./storage";
import { MAX_PHOTO_BYTES, MAX_VIDEO_BYTES, type MediaKind } from "./validation";
import { notifyJobQueued } from "./jobs";

export const PHOTO_UPLOAD_TYPES = ["image/jpeg", "image/png", "image/webp"];
export const VIDEO_UPLOAD_TYPES = ["video/mp4", "video/quicktime"];
const CLIENT_UPLOAD_ID = /^[A-Za-z0-9_-]{16,100}$/;

export interface CreateUploadInput {
  clientUploadId: string;
  kind: MediaKind;
  mimeType: string;
  byteSize: number;
}

export function parseCreateUploadInput(body: unknown): CreateUploadInput {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const errors: Record<string, string> = {};
  const clientUploadId = typeof b.clientUploadId === "string" ? b.clientUploadId : "";
  if (!CLIENT_UPLOAD_ID.test(clientUploadId)) errors.clientUploadId = "clientUploadId must be 16-100 letters, digits, '-' or '_'.";
  const kind = b.kind === "photo" || b.kind === "video" ? b.kind : null;
  if (!kind) errors.kind = "kind must be photo or video.";
  const mimeType = typeof b.mimeType === "string" ? b.mimeType.toLowerCase() : "";
  if (kind === "photo" && (mimeType === "image/heic" || mimeType === "image/heif")) {
    throw new HttpError(415, "HEIC photos aren't supported yet. Choose a JPEG, or set your camera to Most Compatible.");
  }
  if (kind && !(kind === "photo" ? PHOTO_UPLOAD_TYPES : VIDEO_UPLOAD_TYPES).includes(mimeType)) {
    throw new HttpError(415, kind === "photo" ? "Only JPEG, PNG and WebP photos are supported." : "Only MP4 and MOV videos are supported.");
  }
  const byteSize = typeof b.byteSize === "number" ? b.byteSize : NaN;
  const max = kind === "video" ? MAX_VIDEO_BYTES : MAX_PHOTO_BYTES;
  if (!Number.isSafeInteger(byteSize) || byteSize <= 0) errors.byteSize = "byteSize must be a positive whole number of bytes.";
  else if (byteSize > max) throw new HttpError(413, `${kind === "video" ? "Videos" : "Photos"} can be up to ${max / (1024 * 1024)} MiB.`);
  if (Object.keys(errors).length || !kind) throw new HttpError(422, "Invalid upload request.", errors);
  return { clientUploadId, kind, mimeType, byteSize };
}

interface SessionRow {
  media: MediaRecord;
  clientUploadId: string;
  uploadId: string;
  partSize: number;
  partCount: number;
  expiresAt: string;
  expired: boolean;
}

const SESSION_SELECT = `SELECT ${MEDIA_COLUMNS.split(", ").map((c) => `m.${c}`).join(", ")},
  s.client_upload_id, s.multipart_upload_id, s.part_size, s.part_count, s.expires_at, s.expires_at <= now() AS expired
  FROM media_upload_sessions s JOIN media m ON m.id = s.media_id`;

function mapSession(row: Record<string, string | null>): SessionRow {
  return {
    media: mapMediaRow(row),
    clientUploadId: row.client_upload_id as string,
    uploadId: row.multipart_upload_id as string,
    partSize: Number(row.part_size),
    partCount: Number(row.part_count),
    expiresAt: row.expires_at as string,
    expired: row.expired === "t",
  };
}

async function sessionByMedia(ownerId: string, mediaId: string): Promise<SessionRow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(mediaId)) return null;
  const row = await queryOne(`${SESSION_SELECT} WHERE s.media_id = :'media' AND s.owner_id = :'owner'`, { media: mediaId, owner: ownerId });
  return row ? mapSession(row) : null;
}

async function sessionByClientId(ownerId: string, clientUploadId: string): Promise<SessionRow | null> {
  const row = await queryOne(`${SESSION_SELECT} WHERE s.owner_id = :'owner' AND s.client_upload_id = :'client'`, { owner: ownerId, client: clientUploadId });
  return row ? mapSession(row) : null;
}

export const partLength = (session: Pick<SessionRow, "partSize" | "partCount"> & { byteSize: number }, partNumber: number) =>
  partNumber < session.partCount ? session.partSize : session.byteSize - session.partSize * (session.partCount - 1);

export interface UploadPlan {
  partSize: number;
  partCount: number;
  parts: { partNumber: number; byteLength: number; uploaded: boolean; url: string | null }[];
  /** Relative URLs are this API (send no Authorization header to absolute ones). */
  urlsExpireAt: string;
  sessionExpiresAt: string;
}

const UPLOAD_GONE = new HttpError(410, "This upload expired. Start it again.");

/** Storage no longer has the multipart upload (aborted by its lifecycle rule, or by hand). */
function isUploadGone(error: unknown): boolean {
  const e = error as { name?: string; message?: string };
  return e?.name === "NoSuchUpload" || e?.message === "NoSuchUpload";
}

async function plan(store: ObjectStore, session: SessionRow): Promise<UploadPlan> {
  let listed;
  try {
    listed = await store.listParts(session.media.storageKey, session.uploadId);
  } catch (error) {
    if (isUploadGone(error)) throw UPLOAD_GONE;
    throw error;
  }
  const uploaded = new Map(listed.map((p) => [p.partNumber, p.size]));
  const ttl = config.media.partUrlTtlSeconds;
  const parts: UploadPlan["parts"] = [];
  for (let partNumber = 1; partNumber <= session.partCount; partNumber++) {
    const byteLength = partLength({ ...session, byteSize: session.media.byteSize }, partNumber);
    const done = uploaded.get(partNumber) === byteLength;
    parts.push({
      partNumber,
      byteLength,
      uploaded: done,
      url: done ? null : await store.presignPart({ key: session.media.storageKey, uploadId: session.uploadId, partNumber, byteLength, expiresInSeconds: ttl, mediaId: session.media.id }),
    });
  }
  return { partSize: session.partSize, partCount: session.partCount, parts, urlsExpireAt: new Date(Date.now() + ttl * 1000).toISOString(), sessionExpiresAt: session.expiresAt };
}

async function discard(store: ObjectStore, session: SessionRow): Promise<void> {
  await store.abortMultipartUpload(session.media.storageKey, session.uploadId).catch(() => undefined);
  await query(`DELETE FROM media WHERE id = :'id' AND status = 'uploading'`, { id: session.media.id });
}

export async function createUpload(store: ObjectStore, ownerId: string, input: CreateUploadInput): Promise<{ media: MediaRecord; upload: UploadPlan | null; created: boolean }> {
  await assertCanContribute(ownerId);
  const existing = await sessionByClientId(ownerId, input.clientUploadId);
  if (existing) {
    if (existing.media.status !== "uploading") return { media: existing.media, upload: null, created: false };
    if (!existing.expired) {
      if (existing.media.kind !== input.kind || existing.media.mimeType !== input.mimeType || existing.media.byteSize !== input.byteSize) {
        throw new HttpError(409, "This upload id was already used for a different file.");
      }
      try {
        return { media: existing.media, upload: await plan(store, existing), created: false };
      } catch (error) {
        if (error !== UPLOAD_GONE) throw error;
      }
    }
    await discard(store, existing); // expired or gone from storage: start over under the same outbox id
  }

  await enforceSharedLimit(`media-upload:${ownerId}`, config.media.uploadsPerHour, 3600, "You've uploaded a lot in the last hour. Try again later.");
  const open = await queryOne(`SELECT count(*) AS n FROM media WHERE owner_id = :'owner' AND status = 'uploading'`, { owner: ownerId });
  if (Number(open?.n ?? 0) >= config.media.maxOpenUploads) throw new HttpError(429, "Finish or cancel your other uploads first.");

  const mediaId = randomUUID();
  const key = `m/${mediaId}/original`;
  const partSize = config.media.partSizeBytes;
  const partCount = Math.max(1, Math.ceil(input.byteSize / partSize));
  const uploadId = await store.createMultipartUpload(key, input.mimeType);
  const row = await queryOne(
    `WITH m AS (
       INSERT INTO media (id, owner_id, kind, mime_type, byte_size, storage_key, status)
       VALUES (:'id', :'owner', :'kind', :'mime', :'size', :'key', 'uploading') RETURNING id, owner_id),
     s AS (
       INSERT INTO media_upload_sessions (media_id, owner_id, client_upload_id, multipart_upload_id, part_size, part_count, expires_at)
       SELECT id, owner_id, :'client', :'upload', :'part_size'::integer, :'part_count'::integer, now() + make_interval(hours => :'hours'::integer) FROM m
       ON CONFLICT (owner_id, client_upload_id) DO NOTHING RETURNING media_id)
     SELECT count(*) AS created FROM s`,
    {
      id: mediaId, owner: ownerId, kind: input.kind, mime: input.mimeType, size: input.byteSize, key,
      client: input.clientUploadId, upload: uploadId, part_size: partSize, part_count: partCount, hours: config.media.uploadSessionHours,
    },
  );
  if (Number(row?.created) !== 1) {
    // A concurrent request with the same outbox id won; use its session.
    await store.abortMultipartUpload(key, uploadId).catch(() => undefined);
    await query(`DELETE FROM media WHERE id = :'id' AND status = 'uploading'`, { id: mediaId });
    const winner = await sessionByClientId(ownerId, input.clientUploadId);
    if (!winner) throw new HttpError(409, "Upload could not be created. Try again.");
    return { media: winner.media, upload: winner.media.status === "uploading" ? await plan(store, winner) : null, created: false };
  }
  const session = await sessionByMedia(ownerId, mediaId);
  if (!session) throw new Error("Upload session vanished after creation.");
  return { media: session.media, upload: await plan(store, session), created: true };
}

export async function getUpload(store: ObjectStore, ownerId: string, mediaId: string): Promise<{ media: MediaRecord; upload: UploadPlan | null }> {
  const session = await sessionByMedia(ownerId, mediaId);
  if (!session) throw new HttpError(404, "Upload not found.");
  if (session.media.status !== "uploading") return { media: session.media, upload: null };
  if (session.expired) throw new HttpError(410, "This upload expired. Start it again.");
  return { media: session.media, upload: await plan(store, session) };
}

export async function completeUpload(store: ObjectStore, ownerId: string, mediaId: string): Promise<MediaRecord> {
  const session = await sessionByMedia(ownerId, mediaId);
  if (!session) throw new HttpError(404, "Upload not found.");
  if (session.media.status !== "uploading") return session.media; // already completed: idempotent
  if (session.expired) throw new HttpError(410, "This upload expired. Start it again.");
  const media = session.media;
  let listed;
  try {
    listed = await store.listParts(media.storageKey, session.uploadId);
  } catch (error) {
    if (isUploadGone(error)) throw UPLOAD_GONE;
    throw error;
  }
  const byNumber = new Map(listed.map((p) => [p.partNumber, p]));
  const missing: number[] = [];
  for (let n = 1; n <= session.partCount; n++) {
    if (byNumber.get(n)?.size !== partLength({ ...session, byteSize: media.byteSize }, n)) missing.push(n);
  }
  if (missing.length) {
    throw new HttpError(409, `Upload incomplete: ${missing.length} part(s) still needed.`, { missingParts: missing.join(",") });
  }
  try {
    await store.completeMultipartUpload(media.storageKey, session.uploadId, listed.filter((p) => p.partNumber <= session.partCount));
  } catch (error) {
    const current = await findMediaById(mediaId);
    if (current && current.status !== "uploading") return current; // a concurrent completion won
    throw error;
  }
  const head = await store.head(media.storageKey);
  if (!head || head.size !== media.byteSize) {
    await store.deleteObjects([media.storageKey]).catch(() => undefined);
    await query(`DELETE FROM media WHERE id = :'id' AND status = 'uploading'`, { id: media.id });
    throw new HttpError(422, "The upload didn't arrive intact. Please upload it again.");
  }
  const row = await queryOne(
    `WITH m AS (UPDATE media SET status = 'processing' WHERE id = :'id' AND status = 'uploading' RETURNING ${MEDIA_COLUMNS}),
          s AS (UPDATE media_upload_sessions SET completed_at = now() WHERE media_id IN (SELECT id FROM m)),
          j AS (INSERT INTO media_jobs (media_id) SELECT id FROM m ON CONFLICT (media_id) WHERE status IN ('queued', 'running') DO NOTHING RETURNING media_id),
          n AS (SELECT pg_notify('media_jobs', media_id::text) FROM j)
     SELECT m.*, (SELECT count(*) FROM n) AS notified FROM m`,
    { id: media.id },
  );
  if (!row) return (await findMediaById(mediaId)) ?? media;
  await notifyJobQueued(media.id);
  return mapMediaRow(row);
}

export async function abortUpload(store: ObjectStore, ownerId: string, mediaId: string): Promise<void> {
  const session = await sessionByMedia(ownerId, mediaId);
  if (!session) throw new HttpError(404, "Upload not found.");
  if (session.media.status !== "uploading") throw new HttpError(409, "This upload has already finished.");
  await discard(store, session);
}

/** Development/test store only: receives one part sent to a signed local part URL. */
export async function receiveLocalPart(store: ObjectStore, mediaId: string, partNumberRaw: string, params: URLSearchParams, body: Readable, contentLength: string | undefined): Promise<string> {
  if (!(store instanceof LocalObjectStore)) throw new HttpError(404, "Not found.");
  const partNumber = Number(partNumberRaw), length = Number(params.get("length")), expires = Number(params.get("expires"));
  if (!/^[0-9a-f-]{36}$/i.test(mediaId) || !Number.isSafeInteger(partNumber) || partNumber < 1 || partNumber > 10000 || !Number.isSafeInteger(length) || length < 0) {
    throw new HttpError(400, "Malformed part URL.");
  }
  if (!verifyLocalPartSignature(mediaId, partNumber, length, expires, params.get("signature") ?? "")) throw new HttpError(403, "This upload link is invalid or has expired.");
  if (contentLength !== undefined && Number(contentLength) !== length) throw new HttpError(400, "Content-Length doesn't match this part.");
  const row = await queryOne(
    `SELECT s.multipart_upload_id, s.part_size, s.part_count, s.expires_at <= now() AS expired, m.byte_size, m.status
     FROM media_upload_sessions s JOIN media m ON m.id = s.media_id WHERE s.media_id = :'id'`,
    { id: mediaId },
  );
  if (!row || row.status !== "uploading" || row.expired === "t") throw new HttpError(409, "This upload is no longer accepting data.");
  const expected = partLength({ partSize: Number(row.part_size), partCount: Number(row.part_count), byteSize: Number(row.byte_size) }, partNumber);
  if (partNumber > Number(row.part_count) || expected !== length) throw new HttpError(400, "Unexpected part.");
  try {
    return await store.writePart(row.multipart_upload_id as string, partNumber, body, length);
  } catch (error) {
    if (error instanceof ObjectTooLargeError) throw new HttpError(400, "Part size doesn't match.");
    throw error;
  }
}

/** Requeues processing after a transient failure (the uploader pressed Retry). */
export async function retryProcessing(ownerId: string, mediaId: string): Promise<MediaRecord> {
  if (!/^[0-9a-f-]{36}$/i.test(mediaId)) throw new HttpError(404, "Media not found.");
  const row = await queryOne(
    `WITH m AS (UPDATE media SET status = 'processing', processing_error = NULL, processing_error_retryable = false
                WHERE id = :'id' AND owner_id = :'owner' AND status = 'failed' AND processing_error_retryable AND purged_at IS NULL
                RETURNING ${MEDIA_COLUMNS}),
          j AS (INSERT INTO media_jobs (media_id) SELECT id FROM m ON CONFLICT (media_id) WHERE status IN ('queued', 'running') DO NOTHING RETURNING media_id),
          n AS (SELECT pg_notify('media_jobs', media_id::text) FROM j)
     SELECT m.*, (SELECT count(*) FROM n) AS notified FROM m`,
    { id: mediaId, owner: ownerId },
  );
  if (!row) {
    const media = await findMediaById(mediaId);
    if (!media || media.ownerId !== ownerId) throw new HttpError(404, "Media not found.");
    throw new HttpError(409, media.status === "failed" ? "This file can't be processed. Choose a different one." : "This media isn't waiting for a retry.");
  }
  await notifyJobQueued(mediaId);
  return mapMediaRow(row);
}
