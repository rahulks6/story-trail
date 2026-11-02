import { endAbandonedCalls } from "./calls.service";

export interface CallTimeoutWorkerOptions {
  everyMs: number;
  log?: (event: Record<string, unknown>) => void;
}

/**
 * Ends calls the phones won't end themselves, every few seconds: rung out with nobody answering
 * (the callee's "Missed call"), or both phones gone quiet mid-call (a crash, no network). Several
 * workers may run it at once: a call is ended only once (calls.repository.ts endCall).
 */
export class CallTimeoutWorker {
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<void> | null = null;

  constructor(private readonly options: CallTimeoutWorkerOptions) {}

  async runOnce(): Promise<number> {
    return endAbandonedCalls();
  }

  async start(): Promise<void> {
    if (this.timer) return;
    this.timer = setInterval(() => {
      if (this.running) return;
      this.running = this.runOnce()
        .then((ended) => { if (ended) this.options.log?.({ event: "calls_timed_out", ended }); })
        .catch((error: unknown) => this.options.log?.({ event: "call_timeout_error", error: (error as Error).message }))
        .finally(() => { this.running = null; });
    }, this.options.everyMs);
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.running;
  }
}
