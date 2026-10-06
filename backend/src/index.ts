import { config } from "./config/env";
import { buildApp } from "./app";
import { closeDatabase } from "./db/psql";
import { createMediaWorker, createPushWorker } from "./worker";

const server = buildApp();
// Development convenience only (config refuses it in production): process uploads in this process.
const worker = config.media.worker.inProcess ? createMediaWorker() : null;
const push = config.media.worker.inProcess ? createPushWorker() : null;
void worker?.start();
void push?.start();

server.listen(config.port, () => {
  console.log(`KATKEE backend listening on http://localhost:${config.port} (${config.nodeEnv})`);
});

// Graceful shutdown (http/lifecycle.ts): drain, finish in-flight requests, then close the pool.
const shutdown = (signal: string) => {
  void server.lifecycle
    .shutdown(server, {
      drainMs: config.shutdown.drainMs,
      timeoutMs: config.shutdown.timeoutMs,
      cleanup: async () => {
        await Promise.all([worker?.stop(), push?.stop()]);
        await closeDatabase();
      },
      log: (event) => console.log(JSON.stringify({ ts: new Date().toISOString(), signal, ...event })),
    })
    .then((outcome) => process.exit(outcome === "clean" ? 0 : 1), () => process.exit(1));
};
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
