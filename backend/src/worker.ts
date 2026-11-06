/**
 * Worker service: processes uploads, sends push notifications, judges how far public Stories
 * reach, publishes scheduled Stories when they are due, ends calls nobody answered, and runs
 * scheduled retention.
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
import { PushWorker } from "./modules/push/push-worker";
import { providersFromConfig } from "./modules/push/dispatcher";
import { ReachWorker } from "./modules/recommendations/reach-worker";
import { ReturnReasonsWorker } from "./modules/reminders/return-reasons";
import { reachSettings } from "./modules/recommendations/reach";
import { ScheduledStoriesWorker } from "./modules/stories/scheduled";
import { ClaudeStoryAi, StoryAiWorker, storyAiActive } from "./modules/stories/story-ai";
import { CallTimeoutWorker } from "./modules/calls/call-timeouts";

export function createReachWorker(): ReachWorker {
  return new ReachWorker({
    settings: reachSettings(config.reach.json),
    everyMs: config.reach.evaluateSeconds * 1000,
    batchSize: config.reach.batchSize,
    log: (event) => console.log(JSON.stringify({ ts: new Date().toISOString(), ...event })),
  });
}

export function createPushWorker(): PushWorker {
  return new PushWorker({
    providers: providersFromConfig(),
    pollMs: config.push.pollMs,
    maxAttempts: config.push.maxAttempts,
    log: (event) => console.log(JSON.stringify({ ts: new Date().toISOString(), ...event })),
  });
}

export function createScheduledStoriesWorker(): ScheduledStoriesWorker {
  return new ScheduledStoriesWorker({
    everyMs: config.scheduledStories.pollSeconds * 1000,
    batchSize: config.scheduledStories.batchSize,
    log: (event) => console.log(JSON.stringify({ ts: new Date().toISOString(), ...event })),
  });
}

/** Story understanding (stories/story-ai.ts); null while it's off or the key is still the placeholder. */
export function createStoryAiWorker(): StoryAiWorker | null {
  if (!storyAiActive()) return null;
  return new StoryAiWorker({
    ai: new ClaudeStoryAi(config.storyAi.apiKey, config.storyAi.model),
    store: mediaStorage,
    everyMs: config.storyAi.pollSeconds * 1000,
    batchSize: config.storyAi.batchSize,
    log: (event) => console.log(JSON.stringify({ ts: new Date().toISOString(), ...event })),
  });
}

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
  const push = createPushWorker();
  const reach = config.reach.enabled ? createReachWorker() : null;
  const reasons = config.returnReasons.enabled
    ? new ReturnReasonsWorker({ everyMs: config.returnReasons.everyMinutes * 60_000, log: (e) => console.info(JSON.stringify(e)) })
    : null;
  const calls = config.calls.enabled
    ? new CallTimeoutWorker({ everyMs: 5000, log: (event) => console.log(JSON.stringify({ ts: new Date().toISOString(), ...event })) })
    : null;
  const scheduled = config.scheduledStories.enabled ? createScheduledStoriesWorker() : null;
  const storyAi = createStoryAiWorker();
  Promise.all([worker.start(), push.start(), reach?.start(), reasons?.start(), calls?.start(), scheduled?.start(), storyAi?.start()])
    .then(() => console.log(JSON.stringify({
      ts: new Date().toISOString(), event: "worker_started", store: mediaStorage.kind, queue: config.media.queue.driver,
      pushProviders: [...providersFromConfig().keys()],
      storyAi: storyAi ? config.storyAi.model : config.storyAi.enabled ? "waiting for ANTHROPIC_API_KEY" : "off",
    })))
    .catch((error) => {
      console.error("Worker failed to start:", error);
      process.exit(1);
    });
  const shutdown = () => {
    // Finishes the job in hand; an interrupted job is retried after its lease expires.
    void Promise.all([worker.stop(), push.stop(), reach?.stop(), reasons?.stop(), calls?.stop(), scheduled?.stop(), storyAi?.stop()]).then(closeDatabase).finally(() => process.exit(0));
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}
