/**
 * Media worker service: processes uploads and runs scheduled retention.
 *
 *   node dist/src/worker.js
 *
 * Runs as its own service (scaled independently of the API; with MEDIA_QUEUE=sqs,
 * autoscale on queue depth). Several workers may run at once: jobs are claimed with
 * SKIP LOCKED and retention takes a leader lock. The heartbeat file feeds the
 * container health check.
 */
import * as os from "node:os";
import * as path from "node:path";
import { config } from "./config/env";
import { closeDatabase } from "./db/psql";
import { mediaStorage } from "./modules/media/instance";
import { MediaWorker, defaultWorkerId } from "./modules/media/worker";
import { runRetentionIfDue } from "./modules/media/retention";

export const HEARTBEAT_FILE = process.env.WORKER_HEARTBEAT_FILE ?? path.join(os.tmpdir(), "katkee-worker-heartbeat");

export function createMediaWorker(): MediaWorker {
  return new MediaWorker({
    store: mediaStorage,
    workerId: defaultWorkerId(),
    concurrency: config.media.worker.concurrency,
    leaseSeconds: config.media.worker.leaseSeconds,
    pollMs: config.media.worker.pollMs,
    jobTimeoutSeconds: config.media.worker.jobTimeoutSeconds,
    heartbeatFile: HEARTBEAT_FILE,
    ...(config.retention.enabled
      ? {
        periodic: {
          everyMs: config.retention.intervalMinutes * 60_000,
          task: async (connection) => {
            const reports = await runRetentionIfDue(connection, mediaStorage, config.retention.intervalMinutes);
            if (reports) console.log(JSON.stringify({ ts: new Date().toISOString(), event: "retention_run", reports }));
          },
        },
      }
      : {}),
  });
}

if (require.main === module) {
  const worker = createMediaWorker();
  worker
    .start()
    .then(() => console.log(JSON.stringify({ ts: new Date().toISOString(), event: "media_worker_started", store: mediaStorage.kind, queue: config.media.queue.driver })))
    .catch((error) => {
      console.error("Media worker failed to start:", error);
      process.exit(1);
    });
  const shutdown = () => {
    // Finishes the job in hand; an interrupted job is retried after its lease expires.
    void worker.stop().then(closeDatabase).finally(() => process.exit(0));
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}
