import type { Client } from "pg";
import { openDedicatedConnection } from "../../db/psql";
import { evaluateReachBatch } from "./reach.repository";
import type { ReachSettings } from "./reach";

/** One worker at a time judges reach; others skip the round. */
const REACH_LOCK = 7315220002;

export interface ReachWorkerOptions {
  settings: ReachSettings;
  everyMs: number;
  batchSize: number;
  log?: (event: Record<string, unknown>) => void;
}

/**
 * Moves public Stories through their reach stages (reach.ts) in the background, so judging
 * them never slows Home, publishing or playback. Runs inside the worker service.
 */
export class ReachWorker {
  private running = false;
  private connection: Client | null = null;
  private loop: Promise<void> | null = null;
  private wake: (() => void) | null = null;

  constructor(private readonly options: ReachWorkerOptions) {}

  /** One round if this worker holds the lock; null when another worker is judging. */
  async runOnce(now = new Date()): Promise<{ evaluated: number; changed: number } | null> {
    const connection = this.connection ?? (this.connection = await openDedicatedConnection());
    const lock = await connection.query<{ ok: boolean }>("SELECT pg_try_advisory_lock($1) AS ok", [REACH_LOCK]);
    if (!lock.rows[0]?.ok) return null;
    try {
      return await evaluateReachBatch(this.options.settings, this.options.batchSize, now);
    } finally {
      await connection.query("SELECT pg_advisory_unlock($1)", [REACH_LOCK]);
    }
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.loop = (async () => {
      while (this.running) {
        try {
          const result = await this.runOnce();
          if (result?.changed) this.options.log?.({ event: "reach_evaluated", ...result });
        } catch (error) {
          this.options.log?.({ event: "reach_worker_error", error: (error as Error).message });
        }
        if (this.running) {
          await new Promise<void>((resolve) => {
            const timer = setTimeout(() => { this.wake = null; resolve(); }, this.options.everyMs);
            this.wake = () => { clearTimeout(timer); this.wake = null; resolve(); };
          });
        }
      }
    })();
  }

  async stop(): Promise<void> {
    this.running = false;
    this.wake?.();
    await this.loop;
    await this.connection?.end().catch(() => undefined);
    this.connection = null;
  }
}
