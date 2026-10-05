/**
 * Realtime delivery over WebSocket (`/api/v1/realtime`).
 *
 * Producers publish with pg_notify('realtime', {u: [userIds], e: event}) in the same
 * SQL statement that writes the data, so an event exists only if the write committed.
 * Every API instance LISTENs on one dedicated connection and forwards events to its own
 * sockets, so users connected to different instances still reach each other.
 *
 * Events carry ids, never message text: clients fetch content through the REST API,
 * where every authorization rule applies. Connections authenticate with the normal
 * access token (Authorization header) or a single-use ticket (browsers), are
 * re-validated every minute and immediately when the user's sessions change (database
 * triggers publish `_revalidate`, see migration 0031), and are
 * closed when the access token they opened with expires (the client reconnects with a
 * fresh token).
 */
import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import type { Client } from "pg";
import { WebSocketServer, type WebSocket } from "ws";
import { openDedicatedConnection, query, queryOne } from "../db/psql";
import { verifyAccessToken } from "../modules/auth/tokens";
import { checkAccessSession } from "../modules/auth/session-check";
import { clientIp } from "../http/rateLimiter";
import { globalRateLimiter } from "../http/rateLimiters";
import { sha256 } from "../shared/crypto";

export const REALTIME_PATH = "/api/v1/realtime";
export const REALTIME_CHANNEL = "realtime";
const MAX_SOCKETS_PER_USER = 10;
// Overridable for tests only; ping/expiry checks run on this cadence.
const HEARTBEAT_MS = Number(process.env.REALTIME_HEARTBEAT_MS) || 30_000;
const REVALIDATE_MS = 60_000;
const PONG_INTERVAL_MS = 5_000;

/** Close codes the app understands. */
export const CLOSE = { TOKEN_EXPIRED: 4001, SESSION_ENDED: 4401, REPLACED: 4409, SHUTDOWN: 1001 } as const;

export type RealtimeEvent = { type: string; [key: string]: unknown };

interface Connection {
  socket: WebSocket;
  userId: string;
  claims: { sub: string; sid?: string | undefined; iat: number };
  expiresAtMs: number;
  alive: boolean;
  lastValidatedMs: number;
  openedAtMs: number;
  lastPongMs: number;
}

interface Authenticated {
  userId: string;
  claims: Connection["claims"];
  expiresAtMs: number;
}

/** Publishes an event to users' connected devices (all API instances), after commit. */
export async function publishRealtime(userIds: string[], event: RealtimeEvent): Promise<void> {
  if (!userIds.length) return;
  await query(`SELECT pg_notify('${REALTIME_CHANNEL}', :'payload')`, { payload: JSON.stringify({ u: userIds, e: event }) });
}

export class RealtimeHub {
  private readonly wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });
  private readonly byUser = new Map<string, Set<Connection>>();
  private listener: Client | null = null;
  private listening: Promise<void> | null = null;
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;

  attach(server: Server): this {
    server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => void this.handleUpgrade(req, socket, head));
    server.on("close", () => void this.stop());
    return this;
  }

  /** Number of open connections (all users) on this instance. */
  get size(): number {
    let n = 0;
    for (const set of this.byUser.values()) n += set.size;
    return n;
  }

  private reject(socket: Duplex, status: number, reason: string): void {
    socket.write(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    socket.destroy();
  }

  private async authenticate(req: IncomingMessage): Promise<Authenticated | null> {
    const header = req.headers.authorization;
    if (header?.startsWith("Bearer ")) {
      const claims = verifyAccessToken(header.slice(7));
      if (!claims || (await checkAccessSession(claims)) !== "ok") return null;
      return { userId: claims.sub, claims: { sub: claims.sub, sid: claims.sid, iat: claims.iat }, expiresAtMs: claims.exp * 1000 };
    }
    const ticket = new URL(req.url ?? "/", "http://localhost").searchParams.get("ticket");
    if (!ticket || !/^[0-9a-f]{64}$/.test(ticket)) return null;
    const row = await queryOne(
      `DELETE FROM realtime_tickets WHERE token_hash = :'hash' AND expires_at > now()
       RETURNING user_id, session_id, floor(extract(epoch FROM access_issued_at))::bigint AS iat,
                 floor(extract(epoch FROM access_expires_at))::bigint AS exp`,
      { hash: sha256(ticket) },
    );
    if (!row) return null;
    const claims = { sub: row.user_id as string, sid: (row.session_id as string | null) ?? undefined, iat: Number(row.iat) };
    if ((await checkAccessSession(claims)) !== "ok") return null;
    return { userId: claims.sub, claims, expiresAtMs: Number(row.exp) * 1000 };
  }

  private async handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
    if ((req.url ?? "").split("?")[0] !== REALTIME_PATH || this.stopped) {
      this.reject(socket, 404, "Not Found");
      return;
    }
    try {
      globalRateLimiter.check(clientIp(req));
    } catch {
      this.reject(socket, 429, "Too Many Requests");
      return;
    }
    let auth: Authenticated | null;
    try {
      auth = await this.authenticate(req);
      if (auth) await this.ensureListening();
    } catch {
      this.reject(socket, 503, "Service Unavailable");
      return;
    }
    if (!auth || auth.expiresAtMs <= Date.now()) {
      this.reject(socket, 401, "Unauthorized");
      return;
    }
    const authenticated = auth;
    this.wss.handleUpgrade(req, socket, head, (ws) => this.register(ws, authenticated));
  }

  private register(socket: WebSocket, auth: Authenticated): void {
    const now = Date.now();
    const conn: Connection = { socket, userId: auth.userId, claims: auth.claims, expiresAtMs: auth.expiresAtMs, alive: true, lastValidatedMs: now, openedAtMs: now, lastPongMs: 0 };
    let set = this.byUser.get(auth.userId);
    if (!set) this.byUser.set(auth.userId, (set = new Set()));
    if (set.size >= MAX_SOCKETS_PER_USER) {
      // A phone that keeps reconnecting can leave dead sockets behind: drop the oldest.
      const oldest = [...set].sort((a, b) => a.openedAtMs - b.openedAtMs)[0];
      oldest?.socket.close(CLOSE.REPLACED, "replaced");
      if (oldest) set.delete(oldest);
    }
    set.add(conn);
    socket.on("pong", () => { conn.alive = true; });
    socket.on("message", (data) => {
      conn.alive = true;
      // App-level keep-alive: phones can't see WebSocket ping frames, so a client finds a
      // dead connection (NAT timeout, network switch) by sending {"type":"ping"} and
      // expecting a pong. At most one pong per PONG_INTERVAL_MS; nothing else is accepted.
      if (data.toString() === '{"type":"ping"}' && Date.now() - conn.lastPongMs >= PONG_INTERVAL_MS) {
        conn.lastPongMs = Date.now();
        this.send(conn, { type: "pong" });
      }
    });
    socket.on("close", () => this.remove(conn));
    socket.on("error", () => socket.terminate());
    this.send(conn, { type: "hello", userId: auth.userId, serverTime: new Date(now).toISOString(), expiresAt: new Date(auth.expiresAtMs).toISOString() });
    this.ensureTimer();
  }

  private remove(conn: Connection): void {
    const set = this.byUser.get(conn.userId);
    if (!set) return;
    set.delete(conn);
    if (!set.size) this.byUser.delete(conn.userId);
  }

  private send(conn: Connection, event: RealtimeEvent): void {
    if (conn.socket.readyState === conn.socket.OPEN) conn.socket.send(JSON.stringify(event));
  }

  private async revalidate(conn: Connection): Promise<void> {
    conn.lastValidatedMs = Date.now();
    try {
      if ((await checkAccessSession(conn.claims)) !== "ok") conn.socket.close(CLOSE.SESSION_ENDED, "session_ended");
    } catch {
      // Database unavailable: keep the connection; the next check decides.
    }
  }

  private ensureTimer(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      const now = Date.now();
      for (const set of this.byUser.values()) {
        for (const conn of set) {
          if (!conn.alive) {
            conn.socket.terminate();
            continue;
          }
          conn.alive = false;
          conn.socket.ping();
          if (now >= conn.expiresAtMs) conn.socket.close(CLOSE.TOKEN_EXPIRED, "token_expired");
          else if (now - conn.lastValidatedMs >= REVALIDATE_MS) void this.revalidate(conn);
        }
      }
    }, HEARTBEAT_MS);
    this.timer.unref();
  }

  private dispatch(payload: string): void {
    let message: { u?: unknown; e?: RealtimeEvent };
    try {
      message = JSON.parse(payload) as { u?: unknown; e?: RealtimeEvent };
    } catch {
      return;
    }
    if (!Array.isArray(message.u) || !message.e || typeof message.e.type !== "string") return;
    for (const userId of message.u) {
      const set = typeof userId === "string" ? this.byUser.get(userId) : undefined;
      if (!set) continue;
      for (const conn of set) {
        if (message.e.type === "_revalidate") void this.revalidate(conn);
        else this.send(conn, message.e);
      }
    }
  }

  private ensureListening(): Promise<void> {
    if (!this.listening) {
      this.listening = (async () => {
        const client = await openDedicatedConnection();
        client.on("notification", (msg) => {
          if (msg.channel === REALTIME_CHANNEL && msg.payload) this.dispatch(msg.payload);
        });
        const lost = () => {
          // Events may have been missed while disconnected: reconnect and tell clients to resync.
          if (this.listener !== client || this.stopped) return;
          this.listener = null;
          this.listening = null;
          setTimeout(() => {
            if (this.stopped || !this.size) return;
            this.ensureListening()
              .then(() => this.broadcast({ type: "resync" }))
              .catch(() => undefined);
          }, 1000).unref();
        };
        client.on("error", lost);
        client.on("end", lost);
        await client.query(`LISTEN ${REALTIME_CHANNEL}`);
        if (this.stopped) {
          await client.end().catch(() => undefined);
          return;
        }
        this.listener = client;
      })().catch((error) => {
        this.listening = null;
        throw error;
      });
    }
    return this.listening;
  }

  private broadcast(event: RealtimeEvent): void {
    for (const set of this.byUser.values()) for (const conn of set) this.send(conn, event);
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    for (const set of this.byUser.values()) for (const conn of set) conn.socket.close(CLOSE.SHUTDOWN, "server_shutdown");
    this.byUser.clear();
    const listener = this.listener;
    this.listener = null;
    await listener?.end().catch(() => undefined);
  }
}
