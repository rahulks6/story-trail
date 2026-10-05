/**
 * Media processing queue.
 *
 * PostgreSQL holds the job state (media_jobs): enqueueing happens in the same
 * statement that moves media to 'processing', claims use FOR UPDATE SKIP LOCKED
 * with a lease, and an expired lease (crashed worker) makes a job claimable again.
 * NOTIFY wakes idle workers immediately. With MEDIA_QUEUE=sqs every enqueue also
 * sends an SQS message: workers long-poll it, and its depth is the autoscaling
 * signal for the worker service. SQS is only a wake-up signal, so a lost or
 * duplicated message can never lose or double-process a job.
 */
import { DeleteMessageCommand, ReceiveMessageCommand, SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import { config } from "../../config/env";
import { query, queryOne } from "../../db/psql";

export interface MediaJob {
  id: string;
  mediaId: string;
  attempts: number;
  maxAttempts: number;
}

export interface ProcessingResult {
  width: number;
  height: number;
  durationMs: number | null;
  checksumSha256: string;
  variants: Record<string, unknown>;
}

function mapJob(row: Record<string, string | null>): MediaJob {
  return { id: row.id as string, mediaId: row.media_id as string, attempts: Number(row.attempts), maxAttempts: Number(row.max_attempts) };
}

export interface JobSignal {
  /** Best effort: called after a job is committed. */
  send(mediaId: string): Promise<void>;
}

export interface ReceivedSignal { mediaId: string; ack(): Promise<void> }

export class SqsJobSignal implements JobSignal {
  readonly client: SQSClient;
  constructor(private readonly queueUrl: string, region: string, endpoint?: string) {
    this.client = new SQSClient({ region, ...(endpoint ? { endpoint } : {}) });
  }
  async send(mediaId: string): Promise<void> {
    await this.client.send(new SendMessageCommand({ QueueUrl: this.queueUrl, MessageBody: JSON.stringify({ mediaId }) }));
  }
  /** Long-polls for up to `waitSeconds`. Messages stay invisible for `visibilitySeconds` until acked. */
  async receive(waitSeconds: number, visibilitySeconds: number): Promise<ReceivedSignal[]> {
    const out = await this.client.send(new ReceiveMessageCommand({
      QueueUrl: this.queueUrl, MaxNumberOfMessages: 1, WaitTimeSeconds: waitSeconds, VisibilityTimeout: visibilitySeconds,
    }));
    return (out.Messages ?? []).map((message) => {
      let mediaId = "";
      try {
        const body = JSON.parse(message.Body ?? "{}") as { mediaId?: unknown };
        if (typeof body.mediaId === "string" && /^[0-9a-f-]{36}$/i.test(body.mediaId)) mediaId = body.mediaId;
      } catch {
        mediaId = "";
      }
      return {
        mediaId,
        ack: async () => {
          if (message.ReceiptHandle) await this.client.send(new DeleteMessageCommand({ QueueUrl: this.queueUrl, ReceiptHandle: message.ReceiptHandle }));
        },
      };
    });
  }
}

let signal: JobSignal | null | undefined;
export function jobSignal(): JobSignal | null {
  if (signal === undefined) {
    signal = config.media.queue.driver === "sqs"
      ? new SqsJobSignal(config.media.queue.sqsQueueUrl, config.media.s3.region, config.media.queue.sqsEndpoint || undefined)
      : null;
  }
  return signal;
}
/** Tests swap the signal (e.g. to point at a local SQS server). */
export function setJobSignal(next: JobSignal | null): void {
  signal = next;
}

export async function notifyJobQueued(mediaId: string): Promise<void> {
  const target = jobSignal();
  if (!target) return;
  try {
    await target.send(mediaId);
  } catch (error) {
    // Not fatal: workers also sweep PostgreSQL for due jobs.
    console.warn(JSON.stringify({ event: "media_job_signal_failed", mediaId, error: (error as Error).message }));
  }
}

/** Queues processing for media that is already stored (no-op if a job is already open). */
export async function enqueueMediaJob(mediaId: string): Promise<void> {
  await query(
    `WITH job AS (
       INSERT INTO media_jobs (media_id) VALUES (:'id')
       ON CONFLICT (media_id) WHERE status IN ('queued', 'running') DO NOTHING RETURNING id)
     SELECT pg_notify('media_jobs', :'id') FROM job`,
    { id: mediaId },
  );
  await notifyJobQueued(mediaId);
}

export async function claimMediaJob(workerId: string, leaseSeconds: number, mediaId?: string): Promise<MediaJob | null> {
  const row = await queryOne(
    `SELECT id, media_id, attempts, max_attempts FROM claim_media_job(:'worker', :'lease'::integer, ${mediaId ? ":'media'::uuid" : "NULL"})`,
    { worker: workerId, lease: leaseSeconds, ...(mediaId ? { media: mediaId } : {}) },
  );
  return row ? mapJob(row) : null;
}

/** Creates and claims a job in one step, for processing inside the request that stored the media. */
export async function claimInlineJob(mediaId: string, workerId: string, leaseSeconds: number): Promise<MediaJob | null> {
  const row = await queryOne(
    `INSERT INTO media_jobs (media_id, status, attempts, locked_by, locked_until)
     VALUES (:'id', 'running', 1, :'worker', now() + make_interval(secs => :'lease'::integer))
     ON CONFLICT (media_id) WHERE status IN ('queued', 'running') DO NOTHING
     RETURNING id, media_id, attempts, max_attempts`,
    { id: mediaId, worker: workerId, lease: leaseSeconds },
  );
  return row ? mapJob(row) : null;
}

export async function extendLease(job: MediaJob, workerId: string, leaseSeconds: number): Promise<void> {
  await query(
    `UPDATE media_jobs SET locked_until = now() + make_interval(secs => :'lease'::integer)
     WHERE id = :'id' AND status = 'running' AND locked_by = :'worker'`,
    { id: job.id, worker: workerId, lease: leaseSeconds },
  );
}

/** Closes a job whose media no longer needs processing (deleted, purged, or not yet uploaded). */
export async function closeMediaJob(job: MediaJob): Promise<void> {
  await query(`UPDATE media_jobs SET status = 'done', finished_at = now(), locked_until = NULL WHERE id = :'id'`, { id: job.id });
}

/** Marks the media ready with its variants and publishes any Story waiting on it. Returns Stories published. */
export async function finishMediaJob(job: MediaJob, result: ProcessingResult): Promise<number> {
  const row = await queryOne(`SELECT finish_media_processing(:'job'::bigint, :'media'::uuid, :'result'::jsonb) AS published`, {
    job: job.id,
    media: job.mediaId,
    result: JSON.stringify(result),
  });
  return Number(row?.published ?? 0);
}

export async function failMediaJob(job: MediaJob, userMessage: string, detail: string, retryable: boolean, retryAfterSeconds: number): Promise<"retrying" | "failed"> {
  const row = await queryOne(
    `SELECT fail_media_processing(:'job'::bigint, :'media'::uuid, :'message', :'detail', :'retryable'::boolean, :'delay'::integer) AS outcome`,
    { job: job.id, media: job.mediaId, message: userMessage, detail, retryable, delay: retryAfterSeconds },
  );
  return row?.outcome === "retrying" ? "retrying" : "failed";
}
