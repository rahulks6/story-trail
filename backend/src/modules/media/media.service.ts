/**
 * The original single-request upload (raw body -> API -> storage), kept for the
 * Admin console and older app builds. Current apps upload straight to storage
 * (uploads.ts). Either way the bytes end up in the object store and go through
 * the same processing: photos are processed before this request returns, so
 * "ready" still means publishable; videos are queued and report "processing".
 */
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import type { IncomingMessage } from "node:http";
import { hostname } from "node:os";
import { config } from "../../config/env";
import { query } from "../../db/psql";
import { HttpError } from "../../http/errors";
import type { ObjectStore } from "./storage";
import { MAX_PHOTO_BYTES, MAX_VIDEO_BYTES, validateMedia, type MediaKind } from "./validation";
import * as mediaRepo from "./media.repository";
import type { MediaRecord } from "./media.repository";
import { claimInlineJob, enqueueMediaJob } from "./jobs";
import { processClaimedJob } from "./worker";

// Enough to reach past a camera JPEG's EXIF/thumbnail segments to its
// Start-Of-Frame marker in the overwhelming majority of real files, while
// staying far below the 25/200 MiB upload caps.
const VALIDATION_PREFIX_BYTES = 2 * 1024 * 1024;

class TooLargeError extends Error {}

/** Hashes and counts bytes as they stream through, aborting early past `maxBytes` instead of buffering the whole upload to find out. */
class SizeLimitingHasher extends Transform {
  private byteCount = 0;
  private readonly hash = createHash("sha256");

  constructor(private readonly maxBytes: number) {
    super();
  }

  override _transform(chunk: Buffer, _encoding: string, callback: (error?: Error | null, data?: Buffer) => void): void {
    this.byteCount += chunk.length;
    if (this.byteCount > this.maxBytes) {
      callback(new TooLargeError());
      return;
    }
    this.hash.update(chunk);
    callback(null, chunk);
  }

  get size(): number {
    return this.byteCount;
  }

  digestHex(): string {
    return this.hash.digest("hex");
  }
}

async function readPrefix(filePath: string, maxBytes: number): Promise<Buffer> {
  const handle = await fsp.open(filePath, "r");
  try {
    const stat = await handle.stat();
    const length = Math.min(stat.size, maxBytes);
    const buf = Buffer.alloc(length);
    await handle.read(buf, 0, length, 0);
    return buf;
  } finally {
    await handle.close();
  }
}

/** At most two photos are decoded inside API processes at once; the rest wait their turn. */
let inlineRunning = 0;
const inlineWaiting: (() => void)[] = [];
async function withInlineSlot<T>(work: () => Promise<T>): Promise<T> {
  if (inlineRunning >= 2) await new Promise<void>((resolve) => inlineWaiting.push(resolve));
  inlineRunning++;
  try {
    return await work();
  } finally {
    inlineRunning--;
    inlineWaiting.shift()?.();
  }
}

const inlineWorkerId = `api-inline:${hostname()}:${process.pid}`;

export async function receiveUpload(
  req: IncomingMessage,
  ownerId: string,
  kind: MediaKind,
  storage: ObjectStore,
): Promise<MediaRecord> {
  const contentType = req.headers["content-type"];
  if (!contentType) throw new HttpError(400, "Content-Type header is required.");

  const maxBytes = kind === "photo" ? MAX_PHOTO_BYTES : MAX_VIDEO_BYTES;
  const workDir = await fsp.mkdtemp(path.join(os.tmpdir(), "katkee-upload-"));
  const tempPath = path.join(workDir, "upload");
  const limiter = new SizeLimitingHasher(maxBytes);

  try {
    try {
      await pipeline(req, limiter, fs.createWriteStream(tempPath));
    } catch (err) {
      if (err instanceof TooLargeError) {
        throw new HttpError(413, `Upload exceeds the ${Math.floor(maxBytes / (1024 * 1024))} MiB limit.`);
      }
      throw new HttpError(400, "Upload failed or was interrupted.");
    }
    if (limiter.size === 0) throw new HttpError(400, "Empty upload.");

    const validated = validateMedia(kind, await readPrefix(tempPath, VALIDATION_PREFIX_BYTES), contentType);
    const id = randomUUID();
    const storageKey = `m/${id}/original`;
    await storage.putFile(storageKey, tempPath, validated.mimeType);
    const media = await mediaRepo.insertStoredMedia({
      id,
      ownerId,
      kind,
      mimeType: validated.mimeType,
      byteSize: limiter.size,
      width: validated.width,
      height: validated.height,
      durationMs: validated.durationMs,
      checksumSha256: limiter.digestHex(),
      storageKey,
    });

    if (kind === "video") {
      await enqueueMediaJob(media.id);
      return media;
    }

    const job = await claimInlineJob(media.id, inlineWorkerId, config.media.worker.leaseSeconds);
    if (job) {
      await withInlineSlot(() => processClaimedJob(job, storage, {
        workerId: inlineWorkerId,
        leaseSeconds: config.media.worker.leaseSeconds,
        jobTimeoutSeconds: config.media.worker.jobTimeoutSeconds,
      }));
    }
    const processed = await mediaRepo.findMediaById(media.id);
    if (!processed) throw new HttpError(500, "Upload could not be saved.");
    if (processed.status === "failed") {
      // Nothing references a rejected upload yet; remove it now rather than at retention time.
      await query(`DELETE FROM media WHERE id = :'id' AND status = 'failed'`, { id: processed.id });
      await storage.deleteObjects([processed.storageKey]).catch(() => undefined);
      throw new HttpError(422, processed.processingError ?? "We couldn't process this photo.");
    }
    return processed;
  } finally {
    await fsp.rm(workDir, { recursive: true, force: true });
  }
}
