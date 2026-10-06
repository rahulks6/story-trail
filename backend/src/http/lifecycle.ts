import type * as http from "node:http";

export interface ShutdownOptions {
  /** How long to keep serving while reporting not-ready, so load balancers move traffic away. */
  drainMs: number;
  /** How long to wait for in-flight requests after the listener closes; then they are cut. */
  timeoutMs: number;
  /** After the last request: stop background work and close the database. */
  cleanup?: () => Promise<unknown>;
  log?: (event: Record<string, unknown>) => void;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Readiness and graceful shutdown for one API server.
 *
 * GET /ready answers 503 while this instance drains, so it gets no new traffic; /health stays the
 * liveness check. On shutdown (SIGTERM) the instance:
 *  1. reports not-ready and answers every request with `Connection: close` for `drainMs`, so load
 *     balancers and keep-alive clients move to other instances (ECS has usually deregistered the
 *     task already; other platforms need the window);
 *  2. stops accepting connections, closes realtime sockets (clients reconnect elsewhere) and idle
 *     keep-alive connections, and waits for in-flight requests for up to `timeoutMs` (an upload
 *     cut here resumes from its last chunk);
 *  3. cuts whatever is left, runs `cleanup` (workers, database pool) and reports how it ended.
 */
export class Lifecycle {
  draining = false;
  private inFlight = 0;
  private idle: (() => void) | null = null;
  private stopping: Promise<"clean" | "forced"> | null = null;

  /** Counts a request until its response is finished or its connection closes. */
  track(res: http.ServerResponse): void {
    this.inFlight++;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      this.inFlight--;
      if (this.inFlight === 0) this.idle?.();
    };
    res.on("finish", finish);
    res.on("close", finish);
  }

  get requestsInFlight(): number {
    return this.inFlight;
  }

  /** Idempotent: a second signal waits for the first shutdown. */
  shutdown(server: http.Server, options: ShutdownOptions): Promise<"clean" | "forced"> {
    this.stopping ??= this.run(server, options);
    return this.stopping;
  }

  private async run(server: http.Server, { drainMs, timeoutMs, cleanup, log }: ShutdownOptions): Promise<"clean" | "forced"> {
    const startedAt = Date.now();
    this.draining = true;
    log?.({ event: "shutdown_started", drainMs, timeoutMs, inFlight: this.inFlight });
    if (drainMs > 0) await sleep(drainMs);

    const closed = new Promise<void>((resolve) => server.close(() => resolve()));
    server.closeIdleConnections();
    const finished = this.inFlight === 0 ? Promise.resolve() : new Promise<void>((resolve) => { this.idle = resolve; });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const outcome = await Promise.race([
      Promise.all([finished, closed]).then(() => "clean" as const),
      new Promise<"forced">((resolve) => { timer = setTimeout(() => resolve("forced"), timeoutMs); }),
    ]);
    clearTimeout(timer);
    const cut = this.inFlight;
    if (outcome === "forced") server.closeAllConnections();

    try {
      await cleanup?.();
    } finally {
      log?.({ event: "shutdown_finished", outcome, cutRequests: outcome === "forced" ? cut : 0, ms: Date.now() - startedAt });
    }
    return outcome;
  }
}
