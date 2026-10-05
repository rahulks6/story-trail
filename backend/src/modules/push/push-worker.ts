import type { Client } from "pg";
import { openDedicatedConnection } from "../../db/psql";
import { dispatchPushBatch, type ProviderMap } from "./dispatcher";

export interface PushWorkerOptions {
  providers: ProviderMap;
  pollMs: number;
  maxAttempts: number;
  log?: (event: Record<string, unknown>) => void;
}

/** Sends queued pushes; woken by NOTIFY push_outbox (trigger in migration 0031), with polling as a safety net. */
export class PushWorker {
  private running = false;
  private wake: (() => void) | null = null;
  private loop: Promise<void> | null = null;
  private listener: Client | null = null;

  constructor(private readonly options: PushWorkerOptions) {}

  runOnce(): Promise<number> {
    return dispatchPushBatch(this.options.providers, { maxAttempts: this.options.maxAttempts, ...(this.options.log ? { log: this.options.log } : {}) });
  }

  async drain(): Promise<number> {
    let total = 0;
    for (let n = await this.runOnce(); n > 0; n = await this.runOnce()) total += n;
    return total;
  }

  private idle(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => { this.wake = null; resolve(); }, ms);
      this.wake = () => { clearTimeout(timer); this.wake = null; resolve(); };
    });
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.listener = await openDedicatedConnection();
    this.listener.on("notification", () => this.wake?.());
    await this.listener.query("LISTEN push_outbox");
    this.loop = (async () => {
      while (this.running) {
        let handled = 0;
        try {
          handled = await this.runOnce();
        } catch (error) {
          this.options.log?.({ event: "push_worker_error", error: (error as Error).message });
        }
        if (!handled && this.running) await this.idle(this.options.pollMs);
      }
    })();
  }

  async stop(): Promise<void> {
    this.running = false;
    this.wake?.();
    await this.loop;
    await this.listener?.end().catch(() => undefined);
    this.listener = null;
    for (const provider of this.options.providers.values()) await provider.close?.();
  }
}
