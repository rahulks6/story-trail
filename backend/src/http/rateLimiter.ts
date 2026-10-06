import type { IncomingMessage } from "node:http";
import { BlockList, isIP } from 'node:net';
import { HttpError } from "./errors";

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * A minimal in-memory, fixed-window rate limiter — see config/env.ts's
 * `rateLimit` section for why in-memory is the right tradeoff in this
 * sandbox (no Redis/shared store available, single process). Each
 * instance owns its own bucket map, so a strict per-route limiter and a
 * generous global one never share counters.
 */
export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private readonly sweepTimer: NodeJS.Timeout;

  constructor(
    private readonly windowMs: number,
    private readonly max: number,
  ) {
    // Bounds memory over a long-running process — without this, every
    // distinct key (IP) this limiter has ever seen would stay in the map
    // forever. unref() so this timer never keeps the process — or a test
    // run — alive on its own.
    this.sweepTimer = setInterval(() => this.sweep(), windowMs).unref();
  }

  private sweep(): void {
    const now = Date.now();
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
  }

  /** Throws HttpError(429) once `key` has exceeded this limiter's max requests within the current window. */
  check(key: string): void {
    const now = Date.now();
    const existing = this.buckets.get(key);
    if (!existing || existing.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + this.windowMs });
      return;
    }
    existing.count += 1;
    if (existing.count > this.max) {
      const retryAfterSeconds = Math.ceil((existing.resetAt - now) / 1000);
      throw new HttpError(429, `Too many requests — try again in ${retryAfterSeconds}s.`);
    }
  }

  /** Test-only escape hatch so a test can start from a clean window instead of waiting one out for real. */
  reset(): void {
    this.buckets.clear();
  }
}

const normalize = (ip: string) => (ip.startsWith("::ffff:") ? ip.slice(7) : ip);
const proxyLists = new Map<string, BlockList>();

/**
 * TRUSTED_PROXY_IPS, comma-separated: proxy addresses ("172.30.50.3") or ranges ("10.0.0.0/24",
 * "fd00::/8"). Behind an AWS load balancer, list the subnets it runs in: its addresses change.
 */
function trustedProxies(spec: string): BlockList {
  let list = proxyLists.get(spec);
  if (list) return list;
  list = new BlockList();
  for (const entry of spec.split(",").map((s) => s.trim()).filter(Boolean)) {
    const [rawAddress = "", prefix] = entry.split("/");
    const address = normalize(rawAddress);
    const family = isIP(address);
    if (!family) continue;
    const type = family === 6 ? "ipv6" : "ipv4";
    if (prefix === undefined) {
      list.addAddress(address, type);
    } else {
      const bits = Number(prefix);
      if (Number.isInteger(bits) && bits >= 0 && bits <= (family === 6 ? 128 : 32)) list.addSubnet(address, bits, type);
    }
  }
  proxyLists.set(spec, list);
  return list;
}

/**
 * The client's address for rate limits. The socket address, unless it is a trusted proxy
 * (TRUSTED_PROXY_IPS): then the last X-Forwarded-For hop, the one that proxy appended. Never the
 * leftmost value, which a client can set itself to evade the limiter.
 */
export function clientIp(req: IncomingMessage): string {
  const remote = normalize(req.socket.remoteAddress ?? "unknown");
  const family = isIP(remote);
  if (family && trustedProxies(process.env.TRUSTED_PROXY_IPS ?? "").check(remote, family === 6 ? "ipv6" : "ipv4")) {
    const header = req.headers["x-forwarded-for"];
    const last = typeof header === "string" ? header.split(",").at(-1)?.trim() : undefined;
    if (last && isIP(last)) return normalize(last);
  }
  return remote;
}
