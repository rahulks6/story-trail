import { config } from "./config/env";
import { buildApp } from "./app";
import { createMediaWorker } from "./worker";

const server = buildApp();
// Development convenience only (config refuses it in production): process uploads in this process.
const worker = config.media.worker.inProcess ? createMediaWorker() : null;
void worker?.start();

server.listen(config.port, () => {
  console.log(`KATKEE backend listening on http://localhost:${config.port} (${config.nodeEnv})`);
});

const shutdown = () => server.close(() => void (worker ? worker.stop() : Promise.resolve()).finally(() => process.exit(0)));
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
