import { config } from "./config/env";
import { buildApp } from "./app";
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

const shutdown = () => server.close(() => void Promise.all([worker?.stop(), push?.stop()]).finally(() => process.exit(0)));
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
