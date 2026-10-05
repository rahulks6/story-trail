import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { hostname } from "node:os";
import { randomBytes } from "node:crypto";
import type { Client } from "pg";
import { config } from "../../config/env";
import { openDedicatedConnection } from "../../db/psql";
import type { ObjectStore } from "./storage";
import { findMediaById } from "./media.repository";
import { MAX_PHOTO_BYTES, MAX_VIDEO_BYTES } from "./validation";
import { MediaRejectedError, processPhoto, processVideo } from "./processing";
import { claimMediaJob, closeMediaJob, extendLease, failMediaJob, finishMediaJob, SqsJobSignal, jobSignal, type MediaJob } from "./jobs";

/** Variants never change once written under a key, so caches may keep them. */
export const VARIANT_CACHE_CONTROL = "public, max-age=31536000, immutable";
export const WORK_DIR_PREFIX = "katkee-media-";
const GENERIC_FAILURE = "We couldn't process this media. Try again.";

export interface ProcessOptions {
  workerId: string;
  leaseSeconds: number;
  jobTimeoutSeconds: number;
  log?: (event: Record<string, unknown>) => void;
}

const defaultLog = (event: Record<string, unknown>) => console.log(JSON.stringify({ ts: new Date().toISOString(), ...event }));

/** Retries back off 30 s, 2 min, 8 min. */
export const retryDelaySeconds = (attempt: number) => 30 * 4 ** Math.max(0, attempt - 1);

/** Processes one claimed job end to end. Never throws for media problems; records them on the job. */
export async function processClaimedJob(job: MediaJob, store: ObjectStore, options: ProcessOptions): Promise<"done" | "retrying" | "failed"> {
  const log = options.log ?? defaultLog;
  const media = await findMediaById(job.mediaId);
  if (!media || media.purgedAt || media.status === "uploading") {
    await closeMediaJob(job);
    return "done";
  }
  if (job.attempts > job.maxAttempts) {
    // A lease expired on the final attempt (the worker died): stop, keep it retryable by the uploader.
    return failMediaJob(job, GENERIC_FAILURE, "attempts exhausted after lease expiry", true, 0);
  }
  const started = Date.now();
  const workDir = await fsp.mkdtemp(path.join(os.tmpdir(), WORK_DIR_PREFIX));
  const heartbeat = setInterval(() => {
    extendLease(job, options.workerId, options.leaseSeconds).catch(() => undefined);
  }, Math.max(5, options.leaseSeconds / 3) * 1000);
  try {
    const original = path.join(workDir, "original");
    await store.downloadToFile(media.storageKey, original, media.kind === "photo" ? MAX_PHOTO_BYTES : MAX_VIDEO_BYTES);
    const result = media.kind === "photo"
      ? await processPhoto(original, workDir, media.mimeType)
      : await processVideo(original, workDir, media.mimeType, {
        ffmpeg: config.media.ffmpegPath,
        ffprobe: config.media.ffprobePath,
        maxSeconds: config.media.maxVideoSeconds,
        deadline: started + options.jobTimeoutSeconds * 1000,
      });
    const variants: Record<string, unknown> = {};
    for (const variant of result.variants) {
      const key = `m/${media.id}/${variant.fileName}`;
      await store.putFile(key, variant.file, variant.mimeType, VARIANT_CACHE_CONTROL);
      variants[variant.name] = {
        key, mimeType: variant.mimeType, width: variant.width, height: variant.height, byteSize: variant.byteSize,
        ...(variant.bitrate ? { bitrate: variant.bitrate } : {}),
      };
    }
    // A re-run that produced fewer renditions must not leave stale objects behind.
    const stale = Object.values(media.variants).map((v) => v?.key).filter((key): key is string => !!key && !Object.values(variants).some((v) => (v as { key: string }).key === key));
    if (stale.length) await store.deleteObjects(stale);
    const published = await finishMediaJob(job, {
      width: result.width, height: result.height, durationMs: result.durationMs, checksumSha256: result.checksumSha256, variants,
    });
    log({ event: "media_processed", mediaId: media.id, kind: media.kind, jobId: job.id, attempt: job.attempts, ms: Date.now() - started, variants: Object.keys(variants), storiesPublished: published });
    return "done";
  } catch (error) {
    if (error instanceof MediaRejectedError) {
      log({ event: "media_rejected", mediaId: media.id, jobId: job.id, reason: error.message.slice(0, 300) });
      return failMediaJob(job, error.userMessage, error.message, false, 0);
    }
    const detail = error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error);
    const outcome = await failMediaJob(job, GENERIC_FAILURE, detail, true, retryDelaySeconds(job.attempts));
    log({ event: "media_processing_error", mediaId: media.id, jobId: job.id, attempt: job.attempts, outcome, error: (error as Error)?.message?.slice(0, 300) });
    return outcome;
  } finally {
    clearInterval(heartbeat);
    await fsp.rm(workDir, { recursive: true, force: true });
  }
}

export interface WorkerOptions extends ProcessOptions {
  store: ObjectStore;
  concurrency: number;
  pollMs: number;
  /** Runs between jobs on one worker at a time (retention); optional. */
  periodic?: { everyMs: number; task: (connection: Client) => Promise<void> };
  heartbeatFile?: string;
}

export class MediaWorker {
  private running = false;
  private wakers = new Set<() => void>();
  private loops: Promise<void>[] = [];
  private listener: Client | null = null;
  private periodicTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;

  constructor(private readonly options: WorkerOptions) {}

  /** Claims and processes one due job (optionally a specific media's). False when nothing was due. */
  async runOnce(mediaId?: string): Promise<boolean> {
    const job = await claimMediaJob(this.options.workerId, this.options.leaseSeconds, mediaId);
    if (!job) return false;
    await processClaimedJob(job, this.options.store, this.options);
    return true;
  }

  /** Processes due jobs until none are left (tests, one-off backfills). */
  async drain(): Promise<number> {
    let count = 0;
    while (await this.runOnce()) count++;
    return count;
  }

  private poke(): void {
    for (const wake of this.wakers) wake();
  }

  private idle(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const done = () => { clearTimeout(timer); this.wakers.delete(done); resolve(); };
      const timer = setTimeout(done, ms);
      this.wakers.add(done);
    });
  }

  private async beat(): Promise<void> {
    if (this.options.heartbeatFile) await fsp.writeFile(this.options.heartbeatFile, String(Date.now())).catch(() => undefined);
  }

  private async loop(): Promise<void> {
    while (this.running) {
      let worked = false;
      try {
        worked = await this.runOnce();
      } catch (error) {
        (this.options.log ?? defaultLog)({ event: "media_worker_error", error: (error as Error).message });
        await this.idle(2000);
      }
      if (!worked && this.running) await this.idle(this.options.pollMs);
    }
  }

  private async sqsLoop(sqs: SqsJobSignal): Promise<void> {
    while (this.running) {
      try {
        const messages = await sqs.receive(20, this.options.leaseSeconds);
        for (const message of messages) {
          // The job row decides; a message for a job that is running elsewhere or done is simply dropped.
          if (message.mediaId) await this.runOnce(message.mediaId);
          await message.ack();
        }
      } catch (error) {
        (this.options.log ?? defaultLog)({ event: "media_sqs_error", error: (error as Error).message });
        await this.idle(5000);
      }
    }
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.listener = await openDedicatedConnection();
    this.listener.on("notification", () => this.poke());
    await this.listener.query("LISTEN media_jobs");
    for (let i = 0; i < Math.max(1, this.options.concurrency); i++) this.loops.push(this.loop());
    if (this.options.heartbeatFile) {
      await this.beat();
      this.heartbeatTimer = setInterval(() => void this.beat(), 15_000);
    }
    const sqs = jobSignal();
    if (sqs instanceof SqsJobSignal) this.loops.push(this.sqsLoop(sqs));
    const periodic = this.options.periodic;
    if (periodic) {
      const tick = async () => {
        if (!this.running || !this.listener) return;
        try {
          await periodic.task(this.listener);
        } catch (error) {
          (this.options.log ?? defaultLog)({ event: "periodic_task_error", error: (error as Error).message });
        }
        if (this.running) this.periodicTimer = setTimeout(() => void tick(), periodic.everyMs);
      };
      this.periodicTimer = setTimeout(() => void tick(), 1000);
    }
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.periodicTimer) clearTimeout(this.periodicTimer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.poke();
    await Promise.allSettled(this.loops);
    this.loops = [];
    await this.listener?.end().catch(() => undefined);
    this.listener = null;
  }
}

export function defaultWorkerId(): string {
  return `${hostname()}:${process.pid}:${randomBytes(3).toString("hex")}`;
}
