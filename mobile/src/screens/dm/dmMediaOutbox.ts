import AsyncStorage from "@react-native-async-storage/async-storage";
import * as RNFS from "@dr.pogodin/react-native-fs";
import type { Message } from "../../api/conversations";
import { sendPendingMedia, type PendingMedia } from "./sendMedia";

/**
 * Photos, videos and voice notes on their way into a conversation, kept like the text
 * outbox (state/dmOutbox.ts): each is copied into app storage and saved with its
 * message id before it is sent, so leaving the chat, or the app closing, mid-upload
 * doesn't lose it. Sending runs here, not in the screen, and picks up again the next
 * time the conversation opens. A failure stays in the thread with Retry. Once the
 * server has the file its id is saved too, so Retry never uploads it a second time.
 */
export interface MediaOutboxEntry extends PendingMedia {
  conversationId: string;
  createdAt: string;
}

const PREFIX = "katkee.dmMediaOutbox.v1.";
const ROOT = `${RNFS.DocumentDirectoryPath}/katkee-dm-outbox`;

const entriesByUser = new Map<string, MediaOutboxEntry[]>();
const loading = new Map<string, Promise<void>>();
const running = new Set<string>();
const writes = new Map<string, Promise<void>>();
const listeners = new Set<() => void>();
const sentListeners = new Set<(userId: string, message: Message) => void>();
/** Bumped by clearMediaOutbox so work started for a signed-out user never writes back. */
const epochs = new Map<string, number>();

const epochOf = (userId: string) => epochs.get(userId) ?? 0;
const keyFor = (userId: string) => {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(userId)) throw new Error("Invalid user.");
  return PREFIX + userId;
};
const localPath = (uri: string) => (uri.startsWith("file://") ? decodeURI(uri.slice(7)) : uri);
const isOurCopy = (uri: string) => localPath(uri).startsWith(`${ROOT}/`);

function notify(): void {
  listeners.forEach((fn) => fn());
}

export function subscribeMediaOutbox(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** Called with the stored message when a photo, video or voice note has been sent. */
export function onMediaSent(fn: (userId: string, message: Message) => void): () => void {
  sentListeners.add(fn);
  return () => { sentListeners.delete(fn); };
}

/** Unsent media for one conversation, oldest first (empty until loadMediaOutbox finishes). */
export function pendingMedia(userId: string, conversationId: string): MediaOutboxEntry[] {
  return (entriesByUser.get(userId) ?? []).filter((m) => m.conversationId === conversationId);
}

function isEntry(value: unknown): value is MediaOutboxEntry {
  const m = value as Partial<MediaOutboxEntry> | null;
  return !!m && typeof m.clientMessageId === "string" && /^[A-Za-z0-9_-]{16,64}$/.test(m.clientMessageId)
    && typeof m.conversationId === "string" && typeof m.uri === "string" && typeof m.mimeType === "string"
    && (m.mediaKind === "photo" || m.mediaKind === "video" || m.mediaKind === "audio")
    && (m.status === "sending" || m.status === "failed") && typeof m.createdAt === "string";
}

export function loadMediaOutbox(userId: string): Promise<void> {
  keyFor(userId);
  const existing = loading.get(userId);
  if (existing) return existing;
  const epoch = epochOf(userId);
  const work = (async () => {
    let saved: MediaOutboxEntry[] = [];
    try {
      const raw = await AsyncStorage.getItem(keyFor(userId));
      const parsed = raw ? (JSON.parse(raw) as unknown) : [];
      if (Array.isArray(parsed)) saved = parsed.filter(isEntry);
    } catch {
      saved = [];
    }
    if (epoch !== epochOf(userId)) return;
    const inMemory = entriesByUser.get(userId) ?? [];
    const known = new Set(inMemory.map((m) => m.clientMessageId));
    entriesByUser.set(userId, [...saved.filter((m) => !known.has(m.clientMessageId)), ...inMemory]);
    notify();
  })();
  loading.set(userId, work);
  return work;
}

/** Persists the latest state; writes are chained so an older snapshot never lands last. */
function persist(userId: string): Promise<void> {
  const epoch = epochOf(userId);
  const next = (writes.get(userId) ?? Promise.resolve()).then(async () => {
    if (epoch !== epochOf(userId)) return;
    const entries = entriesByUser.get(userId) ?? [];
    try {
      if (entries.length) await AsyncStorage.setItem(keyFor(userId), JSON.stringify(entries));
      else await AsyncStorage.removeItem(keyFor(userId));
    } catch {
      // Storage full or unavailable: the item stays in memory and is still sent.
    }
  });
  writes.set(userId, next);
  return next;
}

function mutate(userId: string, change: (entries: MediaOutboxEntry[]) => MediaOutboxEntry[]): Promise<void> {
  entriesByUser.set(userId, change(entriesByUser.get(userId) ?? []));
  notify();
  return persist(userId);
}

function patch(userId: string, clientMessageId: string, fields: Partial<MediaOutboxEntry>): Promise<void> {
  return mutate(userId, (entries) => entries.map((m) => (m.clientMessageId === clientMessageId ? { ...m, ...fields } : m)));
}

/** Copies the picked or recorded file into app storage (the picker's cache can be cleared). */
async function keepCopy(item: PendingMedia): Promise<string> {
  const extension = /\.([A-Za-z0-9]{1,5})$/.exec(localPath(item.uri))?.[1] ?? (item.mediaKind === "photo" ? "jpg" : "mp4");
  const target = `${ROOT}/${item.clientMessageId}.${extension}`;
  try {
    await RNFS.mkdir(ROOT, { NSURLIsExcludedFromBackupKey: true });
    await RNFS.copyFile(localPath(item.uri), target);
    return `file://${target}`;
  } catch {
    return item.uri; // still sends from where it is, as long as the app stays open
  }
}

function forgetFile(uri: string): void {
  if (isOurCopy(uri)) void RNFS.unlink(localPath(uri)).catch(() => undefined);
}

/** Saves a photo, video or voice note for this conversation and starts sending it. */
export async function enqueueMedia(userId: string, conversationId: string, item: PendingMedia, getToken: () => string | null): Promise<void> {
  keyFor(userId);
  await loadMediaOutbox(userId);
  const uri = await keepCopy(item);
  const entry: MediaOutboxEntry = { ...item, uri, conversationId, status: "sending", error: undefined, createdAt: new Date().toISOString() };
  await mutate(userId, (entries) => [...entries.filter((m) => m.clientMessageId !== item.clientMessageId), entry]);
  void run(userId, item.clientMessageId, getToken);
}

async function run(userId: string, clientMessageId: string, getToken: () => string | null): Promise<void> {
  const runKey = `${userId}:${clientMessageId}`;
  if (running.has(runKey)) return;
  const entry = (entriesByUser.get(userId) ?? []).find((m) => m.clientMessageId === clientMessageId);
  if (!entry) return;
  running.add(runKey);
  const epoch = epochOf(userId);
  try {
    if (entry.status !== "sending") await patch(userId, clientMessageId, { status: "sending", error: undefined });
    const message = await sendPendingMedia(entry.conversationId, entry, getToken, (mediaId) => {
      if (epoch === epochOf(userId)) void patch(userId, clientMessageId, { mediaId });
    });
    if (epoch !== epochOf(userId)) return;
    // Show the stored message before the pending copy disappears.
    sentListeners.forEach((fn) => fn(userId, message));
    await mutate(userId, (entries) => entries.filter((m) => m.clientMessageId !== clientMessageId));
    forgetFile(entry.uri);
  } catch (error) {
    if (epoch !== epochOf(userId)) return;
    await patch(userId, clientMessageId, { status: "failed", error: error instanceof Error ? error.message : "Couldn't send." });
  } finally {
    running.delete(runKey);
  }
}

/**
 * Opening a conversation: anything of it still marked as sending (the app closed, or
 * the person left mid-upload and it stopped) carries on. Failed items wait for Retry.
 */
export async function resumeMedia(userId: string, conversationId: string, getToken: () => string | null): Promise<void> {
  await loadMediaOutbox(userId);
  for (const m of pendingMedia(userId, conversationId)) {
    if (m.status === "sending") void run(userId, m.clientMessageId, getToken);
  }
}

/** "Try again" on a failed item: keeps its uploaded file, if the server has it. */
export function retryMedia(userId: string, clientMessageId: string, getToken: () => string | null): Promise<void> {
  return run(userId, clientMessageId, getToken);
}

/** Deletes an unsent item. One being sent right now can't be taken back. */
export async function discardMedia(userId: string, clientMessageId: string): Promise<void> {
  const entry = (entriesByUser.get(userId) ?? []).find((m) => m.clientMessageId === clientMessageId);
  if (!entry || running.has(`${userId}:${clientMessageId}`)) return;
  await mutate(userId, (entries) => entries.filter((m) => m.clientMessageId !== clientMessageId));
  forgetFile(entry.uri);
}

/** Sign-out: forget this account's unsent media, in memory, in storage and on disk. */
export async function clearMediaOutbox(userId: string): Promise<void> {
  epochs.set(userId, epochOf(userId) + 1);
  const entries = entriesByUser.get(userId) ?? [];
  entriesByUser.delete(userId);
  loading.delete(userId);
  notify();
  await (writes.get(userId) ?? Promise.resolve()).catch(() => undefined);
  writes.delete(userId);
  entries.forEach((m) => forgetFile(m.uri));
  try {
    await AsyncStorage.removeItem(keyFor(userId));
  } catch {
    // Nothing else to do.
  }
}
