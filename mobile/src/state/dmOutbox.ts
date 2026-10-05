import AsyncStorage from "@react-native-async-storage/async-storage";
import { ApiError } from "../api/client";
import { MAX_MESSAGE_LENGTH, newClientMessageId, sendMessage, type Message } from "../api/conversations";

/**
 * The DM outbox. Every message is saved on the phone with its own id before it is
 * sent, so a message written offline, or while the app is killed mid-send, still goes
 * out exactly once: the server stores one message per id (conversations.service.ts).
 *
 * Messages leave in order within a conversation. A temporary failure (offline, timeout,
 * server error, rate limit) is retried with backoff and again as soon as the app comes
 * back or the realtime connection returns; a refusal (blocked, invalid) waits for the
 * person to retry or delete it. Cleared at sign-out, so unsent private messages don't
 * stay on a shared phone.
 */
export type OutboxStatus = "sending" | "waiting" | "failed";

export interface OutboxMessage {
  clientMessageId: string;
  conversationId: string;
  body: string | null;
  storyId: string | null;
  createdAt: string;
  status: OutboxStatus;
  attempts: number;
  /** Epoch ms; a waiting message is not retried before this unless forced. */
  nextAttemptAt: number;
  error?: string;
}

const PREFIX = "katkee.dmOutbox.v1.";
const MAX_UNSENT = 200;
const RETRY_DELAYS_MS = [2_000, 5_000, 15_000, 30_000, 60_000];
const MIN_RETRY_WAIT_MS = 500;

const entriesByUser = new Map<string, OutboxMessage[]>();
const loading = new Map<string, Promise<void>>();
const flushing = new Map<string, Promise<void>>();
const flushAgain = new Map<string, boolean>();
const retryTimers = new Map<string, ReturnType<typeof setTimeout>>();
const writes = new Map<string, Promise<void>>();
const listeners = new Set<() => void>();
const sentListeners = new Set<(userId: string, sent: OutboxMessage, message: Message) => void>();
/** Bumped by clearOutbox so work started for a signed-out user never writes back. */
const epochs = new Map<string, number>();

const now = () => Date.now();
const keyFor = (userId: string) => {
  if (!/^[0-9a-f-]{36}$/i.test(userId)) throw new Error("Invalid user.");
  return PREFIX + userId;
};
const epochOf = (userId: string) => epochs.get(userId) ?? 0;

function notify(): void {
  listeners.forEach((fn) => fn());
}

export function subscribeOutbox(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** Called with the stored message when an outbox message is delivered to the server. */
export function onOutboxSent(fn: (userId: string, sent: OutboxMessage, message: Message) => void): () => void {
  sentListeners.add(fn);
  return () => { sentListeners.delete(fn); };
}

/** Unsent messages for one conversation, oldest first (empty until loadOutbox finishes). */
export function pendingMessages(userId: string, conversationId: string): OutboxMessage[] {
  return (entriesByUser.get(userId) ?? []).filter((m) => m.conversationId === conversationId);
}

export function loadOutbox(userId: string): Promise<void> {
  keyFor(userId); // validates the id
  const existing = loading.get(userId);
  if (existing) return existing;
  const epoch = epochOf(userId);
  const work = (async () => {
    let saved: OutboxMessage[] = [];
    try {
      const raw = await AsyncStorage.getItem(keyFor(userId));
      const parsed = raw ? (JSON.parse(raw) as unknown) : [];
      if (Array.isArray(parsed)) saved = parsed.filter(isOutboxMessage);
    } catch {
      saved = [];
    }
    if (epoch !== epochOf(userId)) return;
    // A send interrupted by the app being killed may or may not have reached the
    // server; sending it again with the same id is safe either way.
    const restored = saved.map((m) => (m.status === "sending" ? { ...m, status: "waiting" as const, nextAttemptAt: 0 } : m));
    const inMemory = entriesByUser.get(userId) ?? [];
    const known = new Set(inMemory.map((m) => m.clientMessageId));
    entriesByUser.set(userId, [...restored.filter((m) => !known.has(m.clientMessageId)), ...inMemory]);
    notify();
  })();
  loading.set(userId, work);
  return work;
}

function isOutboxMessage(value: unknown): value is OutboxMessage {
  const m = value as Partial<OutboxMessage> | null;
  return !!m && typeof m.clientMessageId === "string" && /^[A-Za-z0-9_-]{16,64}$/.test(m.clientMessageId)
    && typeof m.conversationId === "string" && typeof m.createdAt === "string"
    && (m.body === null || typeof m.body === "string") && (m.storyId === null || typeof m.storyId === "string")
    && (m.status === "sending" || m.status === "waiting" || m.status === "failed")
    && typeof m.attempts === "number" && typeof m.nextAttemptAt === "number";
}

/** Persists the latest state; writes are chained so an older snapshot never lands last. */
function persist(userId: string): Promise<void> {
  const epoch = epochOf(userId);
  const previous = writes.get(userId) ?? Promise.resolve();
  const next = previous.then(async () => {
    if (epoch !== epochOf(userId)) return;
    const entries = entriesByUser.get(userId) ?? [];
    try {
      if (entries.length) await AsyncStorage.setItem(keyFor(userId), JSON.stringify(entries));
      else await AsyncStorage.removeItem(keyFor(userId));
    } catch {
      // Storage full or unavailable: the message stays in memory and is still sent.
    }
  });
  writes.set(userId, next);
  return next;
}

function mutate(userId: string, change: (entries: OutboxMessage[]) => OutboxMessage[]): Promise<void> {
  entriesByUser.set(userId, change(entriesByUser.get(userId) ?? []));
  notify();
  return persist(userId);
}

function patch(userId: string, clientMessageId: string, fields: Partial<OutboxMessage>): Promise<void> {
  return mutate(userId, (entries) => entries.map((m) => (m.clientMessageId === clientMessageId ? { ...m, ...fields } : m)));
}

/** Saves a message for sending. Throws for an empty or over-long message. */
export async function enqueueMessage(
  userId: string,
  conversationId: string,
  input: { body?: string; storyId?: string },
): Promise<OutboxMessage> {
  keyFor(userId);
  const body = input.body?.trim() || null;
  const storyId = input.storyId ?? null;
  if (!body && !storyId) throw new Error("Write a message first.");
  if (body && body.length > MAX_MESSAGE_LENGTH) throw new Error(`Messages can be up to ${MAX_MESSAGE_LENGTH} characters.`);
  await loadOutbox(userId);
  if ((entriesByUser.get(userId) ?? []).length >= MAX_UNSENT) {
    throw new Error("Too many messages are waiting to send. Check your connection, then try again.");
  }
  const message: OutboxMessage = {
    clientMessageId: newClientMessageId(),
    conversationId,
    body,
    storyId,
    createdAt: new Date(now()).toISOString(),
    status: "waiting",
    attempts: 0,
    nextAttemptAt: 0,
  };
  await mutate(userId, (entries) => [...entries, message]);
  return message;
}

function isPermanent(error: unknown): boolean {
  // 401 means the sign-in is ending (sign-out clears the outbox); 408/429 are temporary.
  return error instanceof ApiError && error.status >= 400 && error.status < 500 && ![401, 408, 429].includes(error.status);
}

function errorText(error: unknown): string {
  if (error instanceof ApiError && error.message) return error.message;
  return "Not sent yet. It will send when you're back online.";
}

/**
 * Sends whatever is due. `force` ignores backoff (the app just came back, or the
 * realtime connection returned, so the network is probably fine again).
 */
export function flushOutbox(userId: string, getAccessToken: () => string | null, options: { force?: boolean } = {}): Promise<void> {
  if (options.force) {
    for (const m of entriesByUser.get(userId) ?? []) if (m.status === "waiting") m.nextAttemptAt = 0;
  }
  const running = flushing.get(userId);
  if (running) {
    flushAgain.set(userId, true);
    return running;
  }
  const work = (async () => {
    do {
      flushAgain.set(userId, false);
      await drain(userId, getAccessToken);
    } while (flushAgain.get(userId));
  })().finally(() => {
    flushing.delete(userId);
    scheduleRetry(userId, getAccessToken);
  });
  flushing.set(userId, work);
  return work;
}

async function drain(userId: string, getAccessToken: () => string | null): Promise<void> {
  await loadOutbox(userId);
  const epoch = epochOf(userId);
  const heldConversations = new Set<string>();
  for (const entry of [...(entriesByUser.get(userId) ?? [])]) {
    if (epoch !== epochOf(userId)) return;
    // A refused message waits for the person and doesn't hold back later ones.
    if (entry.status === "failed") continue;
    // Keep order: nothing overtakes an earlier message still waiting in its conversation.
    if (heldConversations.has(entry.conversationId)) continue;
    if (entry.nextAttemptAt > now()) {
      heldConversations.add(entry.conversationId);
      continue;
    }
    const token = getAccessToken();
    if (!token) return;
    await patch(userId, entry.clientMessageId, { status: "sending" });
    try {
      const { message } = await sendMessage(
        entry.conversationId,
        { ...(entry.body ? { body: entry.body } : {}), ...(entry.storyId ? { storyId: entry.storyId } : {}), clientMessageId: entry.clientMessageId },
        token,
      );
      if (epoch !== epochOf(userId)) return;
      // Show the stored message before the pending copy disappears.
      sentListeners.forEach((fn) => fn(userId, entry, message));
      await mutate(userId, (entries) => entries.filter((m) => m.clientMessageId !== entry.clientMessageId));
    } catch (error) {
      if (epoch !== epochOf(userId)) return;
      const attempts = entry.attempts + 1;
      if (isPermanent(error)) {
        await patch(userId, entry.clientMessageId, { status: "failed", attempts, error: errorText(error) });
      } else {
        const delay = RETRY_DELAYS_MS[Math.min(attempts - 1, RETRY_DELAYS_MS.length - 1)]!;
        await patch(userId, entry.clientMessageId, { status: "waiting", attempts, nextAttemptAt: now() + delay, error: errorText(error) });
        heldConversations.add(entry.conversationId);
      }
    }
  }
}

function scheduleRetry(userId: string, getAccessToken: () => string | null): void {
  const timer = retryTimers.get(userId);
  if (timer) clearTimeout(timer);
  retryTimers.delete(userId);
  if (!getAccessToken()) return; // signed out: nothing can be sent
  // Only the first waiting message of each conversation decides when to try again:
  // the ones behind it are held until it goes.
  const heads = new Map<string, number>();
  for (const m of entriesByUser.get(userId) ?? []) {
    if (m.status === "waiting" && !heads.has(m.conversationId)) heads.set(m.conversationId, m.nextAttemptAt);
  }
  if (!heads.size) return;
  const wait = Math.max(MIN_RETRY_WAIT_MS, Math.min(...heads.values()) - now());
  retryTimers.set(userId, setTimeout(() => {
    retryTimers.delete(userId);
    void flushOutbox(userId, getAccessToken);
  }, wait));
}

/** "Tap to retry" on a failed or waiting message (also retries the ones ahead of it at once). */
export async function retryMessage(userId: string, clientMessageId: string, getAccessToken: () => string | null): Promise<void> {
  await patch(userId, clientMessageId, { status: "waiting", nextAttemptAt: 0 });
  await flushOutbox(userId, getAccessToken, { force: true });
}

/** Deletes an unsent message. A message already being sent can't be taken back. */
export async function discardMessage(userId: string, clientMessageId: string): Promise<void> {
  await mutate(userId, (entries) => entries.filter((m) => m.clientMessageId !== clientMessageId || m.status === "sending"));
}

/** Sign-out: forget this account's unsent messages, in memory and on disk. */
export async function clearOutbox(userId: string): Promise<void> {
  epochs.set(userId, epochOf(userId) + 1);
  const timer = retryTimers.get(userId);
  if (timer) clearTimeout(timer);
  retryTimers.delete(userId);
  entriesByUser.delete(userId);
  loading.delete(userId);
  notify();
  await (writes.get(userId) ?? Promise.resolve()).catch(() => undefined);
  writes.delete(userId);
  try {
    await AsyncStorage.removeItem(keyFor(userId));
  } catch {
    // Nothing else to do; the next sign-in of this account would send them.
  }
}
