/**
 * The app's one WebSocket to `/api/v1/realtime` (see backend/src/realtime/hub.ts).
 *
 * Events carry ids only, never message text: screens refetch through the REST API.
 * Every (re)connect emits a local `resync` so screens catch up on anything missed while
 * disconnected, which also makes a dropped event harmless. Connections authenticate with
 * a single-use ticket (`POST /api/v1/realtime/ticket`, which refreshes an expired access
 * token through the normal API client).
 *
 * Close codes from the server: 4401 sign-in ended (stop; the API client signs out),
 * 4409 replaced by a newer connection (stop until the next start); anything else,
 * including 4001 token expired, reconnects with backoff (about a second after a
 * connection that worked), and the next ticket request refreshes the access token.
 * Phones can't observe WebSocket ping frames, so the client sends `{"type":"ping"}`
 * every 25 s and treats a missing pong as a dead connection (NAT timeouts, network
 * switches).
 */

export type RealtimeEvent =
  | { type: "message"; conversationId: string; messageId: string; senderId: string; createdAt: string }
  | { type: "receipt"; conversationId: string; userId: string; lastReadAt: string; lastDeliveredAt: string }
  | { type: "notification"; id: string; kind: string }
  /** Local: emitted on every (re)connect, and when the server says events may have been missed. */
  | { type: "resync" };

export type RealtimeStatus = "idle" | "connecting" | "open" | "waiting" | "stopped";

interface SocketLike {
  readyState: number;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: { code: number; reason?: string }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}
type SocketFactory = (url: string) => SocketLike;

interface Timers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface RealtimeClientOptions {
  /** The API base URL (http/https); the socket uses ws/wss on the same host. */
  baseUrl: string;
  /** Returns a fresh single-use ticket; throws (e.g. ApiError 401) when signed out. */
  createTicket: () => Promise<string>;
  onEvent: (event: RealtimeEvent) => void;
  onStatus?: (status: RealtimeStatus) => void;
  /** The server ended this sign-in (4401) or the ticket was refused with 401. */
  onSignedOut?: () => void;
  connect?: SocketFactory;
  timers?: Timers;
  random?: () => number;
  pingIntervalMs?: number;
  pongTimeoutMs?: number;
  connectTimeoutMs?: number;
}

const OPEN = 1;
const MAX_BACKOFF_MS = 30_000;
const CLOSE_STALE = 4000;

export function realtimeUrl(baseUrl: string, ticket: string): string {
  const base = baseUrl.replace(/\/+$/, "").replace(/^http(s?):\/\//i, (_m, s: string) => `ws${s}://`);
  return `${base}/api/v1/realtime?ticket=${encodeURIComponent(ticket)}`;
}

/** 1 s, 2 s, 4 s … capped at 30 s, with jitter so a server restart doesn't get a thundering herd. */
export function backoffMs(attempt: number, random: () => number = Math.random): number {
  const ceiling = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** Math.min(attempt, 10));
  return Math.round(ceiling / 2 + random() * (ceiling / 2));
}

function isAuthFailure(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { status?: unknown }).status === 401;
}

export class RealtimeClient {
  private socket: SocketLike | null = null;
  private wanted = false;
  private attempt = 0;
  private generation = 0;
  private retryTimer: unknown = null;
  private pingTimer: unknown = null;
  private pongTimer: unknown = null;
  private connectTimer: unknown = null;
  private currentStatus: RealtimeStatus = "idle";
  private readonly timers: Timers;
  private readonly connectSocket: SocketFactory;

  constructor(private readonly options: RealtimeClientOptions) {
    this.timers = options.timers ?? { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) };
    this.connectSocket = options.connect ?? ((url) => new WebSocket(url) as unknown as SocketLike);
  }

  get status(): RealtimeStatus {
    return this.currentStatus;
  }

  /** Connects (or keeps the connection); safe to call repeatedly. */
  start(): void {
    this.wanted = true;
    if (this.socket || this.currentStatus === "connecting") return;
    if (this.retryTimer !== null) {
      // Coming back to the foreground: don't sit out the rest of a backoff.
      this.timers.clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    void this.open();
  }

  /** Disconnects and stops reconnecting until start() is called again. */
  stop(): void {
    this.wanted = false;
    this.generation++;
    this.clearTimers();
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      this.detach(socket);
      try { socket.close(1000, "client_stop"); } catch { /* already closed */ }
    }
    this.setStatus("stopped");
  }

  private setStatus(status: RealtimeStatus): void {
    if (status === this.currentStatus) return;
    this.currentStatus = status;
    this.options.onStatus?.(status);
  }

  private clearTimers(): void {
    for (const key of ["retryTimer", "pingTimer", "pongTimer", "connectTimer"] as const) {
      if (this[key] !== null) this.timers.clearTimeout(this[key]);
      this[key] = null;
    }
  }

  private async open(): Promise<void> {
    const generation = ++this.generation;
    this.setStatus("connecting");
    let ticket: string;
    try {
      ticket = await this.options.createTicket();
    } catch (error) {
      if (generation !== this.generation) return;
      if (isAuthFailure(error)) {
        this.wanted = false;
        this.setStatus("stopped");
        this.options.onSignedOut?.();
        return;
      }
      this.scheduleReconnect();
      return;
    }
    if (generation !== this.generation || !this.wanted) return;

    let socket: SocketLike;
    try {
      socket = this.connectSocket(realtimeUrl(this.options.baseUrl, ticket));
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;
    socket.onopen = () => this.armPing(socket);
    socket.onmessage = (event) => this.handleMessage(socket, event.data);
    socket.onerror = () => { /* onclose follows */ };
    socket.onclose = (event) => this.handleClose(socket, event.code);
    // A handshake that never completes (captive portal, dead network) counts as a failure.
    this.connectTimer = this.timers.setTimeout(() => {
      this.connectTimer = null;
      if (socket === this.socket && this.currentStatus !== "open") this.abandon(socket);
    }, this.options.connectTimeoutMs ?? 15_000);
  }

  /** Drops a connection that stopped working and reconnects with backoff. */
  private abandon(socket: SocketLike): void {
    this.detach(socket);
    try { socket.close(CLOSE_STALE, "stale"); } catch { /* ignore */ }
    this.scheduleReconnect();
  }

  private handleMessage(socket: SocketLike, data: unknown): void {
    if (socket !== this.socket) return;
    this.armPing(socket); // any traffic proves the connection is alive
    let event: { type?: unknown };
    try {
      event = JSON.parse(String(data)) as { type?: unknown };
    } catch {
      return;
    }
    switch (event.type) {
      case "hello":
        this.attempt = 0;
        if (this.connectTimer !== null) this.timers.clearTimeout(this.connectTimer);
        this.connectTimer = null;
        this.setStatus("open");
        this.options.onEvent({ type: "resync" });
        return;
      case "pong":
        return;
      case "resync":
      case "message":
      case "receipt":
      case "notification":
        this.options.onEvent(event as RealtimeEvent);
        return;
      default:
        return; // unknown event types from a newer server are ignored
    }
  }

  private armPing(socket: SocketLike): void {
    if (this.pongTimer !== null) this.timers.clearTimeout(this.pongTimer);
    this.pongTimer = null;
    if (this.pingTimer !== null) this.timers.clearTimeout(this.pingTimer);
    this.pingTimer = this.timers.setTimeout(() => {
      this.pingTimer = null;
      if (socket !== this.socket || socket.readyState !== OPEN) return;
      try { socket.send('{"type":"ping"}'); } catch { /* close follows */ }
      this.pongTimer = this.timers.setTimeout(() => {
        this.pongTimer = null;
        // No answer: the connection is dead even if the OS hasn't noticed yet.
        if (socket === this.socket) this.abandon(socket);
      }, this.options.pongTimeoutMs ?? 10_000);
    }, this.options.pingIntervalMs ?? 25_000);
  }

  private detach(socket: SocketLike): void {
    socket.onopen = null;
    socket.onclose = null;
    socket.onmessage = null;
    socket.onerror = null;
    if (this.socket === socket) this.socket = null;
    this.clearTimers();
  }

  private handleClose(socket: SocketLike, code: number): void {
    if (socket !== this.socket) return;
    this.detach(socket);
    if (!this.wanted) {
      this.setStatus("stopped");
      return;
    }
    if (code === 4401) {
      this.wanted = false;
      this.setStatus("stopped");
      this.options.onSignedOut?.();
    } else if (code === 4409) {
      // Another connection replaced this one; reconnecting would just evict it in turn.
      this.wanted = false;
      this.setStatus("stopped");
    } else {
      // 4001 (token expired) lands here too: the next ticket request refreshes the token.
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (!this.wanted) {
      this.setStatus("stopped");
      return;
    }
    this.setStatus("waiting");
    const delay = backoffMs(this.attempt++, this.options.random);
    const generation = this.generation;
    this.retryTimer = this.timers.setTimeout(() => {
      this.retryTimer = null;
      if (generation === this.generation && this.wanted && !this.socket) void this.open();
    }, delay);
  }
}
