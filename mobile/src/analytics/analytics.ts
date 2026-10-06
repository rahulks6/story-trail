import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppState, Platform, type AppStateStatus } from "react-native";
import { ApiError, apiPost } from "../api/client";
import { appEnv } from "../config/env";

/**
 * Product analytics (spec section 15): the few things only the app can see. These are
 * app sessions, JavaScript crashes, upload outcomes, Highlight and profile views, searches
 * and Stories started in the editor. Everything else (Stories, views, likes, comments,
 * follows, DMs, reports, ads) is counted on the server from what those features already
 * store, and daily active users come from the server too.
 *
 * Never on the critical path: track() only appends to a small queue saved on the phone.
 * Batches go out in the background, and a failed batch is retried later or dropped.
 * Every event carries its own id, so a batch resent after a lost response is not counted
 * twice. Only event names, a session id and a few fixed-choice properties leave the
 * phone: no text, and no ids of other people or content.
 */
export type AnalyticsEventName =
  | "app_session_started" | "app_crash" | "story_created" | "highlight_viewed"
  | "profile_viewed" | "search_performed" | "upload_succeeded" | "upload_failed";
export type AnalyticsProperties = Record<string, string | number | boolean>;

interface QueuedEvent {
  id: string;
  name: AnalyticsEventName;
  occurredAt: string;
  sessionId: string | null;
  properties: AnalyticsProperties;
}
interface CrashRecord {
  id: string;
  userId: string;
  sessionId: string | null;
  occurredAt: string;
}

const PREFIX = "katkee.analytics.v1.";
const CRASH_KEY = "katkee.analytics.crash.v1";
const MAX_QUEUED = 300;
const BATCH_SIZE = 50;
const FLUSH_DELAY_MS = 10_000;
const FLUSH_SOON_MS = 1_000;
const FLUSH_AT = 20;
/** Back in the app after this long away starts a new session. */
export const SESSION_GAP_MS = 30 * 60_000;
/** The server refuses events older than 7 days; an hour of margin. */
const MAX_AGE_MS = 7 * 24 * 3_600_000 - 3_600_000;
const RETRY_DELAYS_MS = [10_000, 30_000, 120_000, 600_000];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VERSION_RE = /^[0-9A-Za-z.+-]{1,32}$/;

let active: { userId: string; token: () => string | null } | null = null;
let queue: QueuedEvent[] = [];
let sessionId: string | null = null;
let launched = false;
let backgroundSince: number | null = null;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let flushDue = 0;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let flushing = false;
let failures = 0;
/** True until the stored queue is loaded: saving earlier would overwrite it. */
let restoring = false;
let appState: { remove(): void } | null = null;
/** Bumped by start/stop so work begun for one person never touches another's queue. */
let generation = 0;

/** A random (v4) UUID: the event's stable id. */
export function newEventId(): string {
  const hex = (n: number) => Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join("");
  return `${hex(8)}-${hex(4)}-4${hex(3)}-${"89ab"[Math.floor(Math.random() * 4)]}${hex(3)}-${hex(12)}`;
}

export function analyticsPlatform(): "android" | "ios" | "web" {
  return Platform.OS === "ios" ? "ios" : Platform.OS === "android" ? "android" : "web";
}

function isEvent(value: unknown): value is QueuedEvent {
  const e = value as QueuedEvent;
  return !!e && typeof e === "object" && typeof e.id === "string" && UUID_RE.test(e.id) && typeof e.name === "string" &&
    typeof e.occurredAt === "string" && Number.isFinite(Date.parse(e.occurredAt)) && !!e.properties && typeof e.properties === "object";
}

function parseQueue(raw: string | null): QueuedEvent[] {
  try {
    const value: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(value) ? value.filter(isEvent) : [];
  } catch {
    return [];
  }
}

function writeQueue(userId: string, events: QueuedEvent[]): Promise<void> {
  return AsyncStorage.setItem(PREFIX + userId, JSON.stringify(events)).catch(() => undefined);
}

function saveSoon(): void {
  if (saveTimer || !active || restoring) return;
  const { userId } = active, gen = generation;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    if (gen === generation) void writeQueue(userId, queue);
  }, 500);
}

function schedule(delayMs: number): void {
  if (!active) return;
  const due = Date.now() + delayMs;
  if (flushTimer && flushDue <= due) return;
  if (flushTimer) clearTimeout(flushTimer);
  flushDue = due;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushAnalytics();
  }, delayMs);
}

function enqueue(event: QueuedEvent): void {
  queue.push(event);
  if (queue.length > MAX_QUEUED) queue.splice(0, queue.length - MAX_QUEUED);
  saveSoon();
  schedule(queue.length >= FLUSH_AT ? FLUSH_SOON_MS : FLUSH_DELAY_MS);
}

/** Records one event for the signed-in person. Never throws, never waits. */
export function track(name: AnalyticsEventName, properties: AnalyticsProperties = {}): void {
  if (!active) return; // nothing is collected while signed out
  enqueue({ id: newEventId(), name, occurredAt: new Date().toISOString(), sessionId, properties });
}

function startSession(coldStart: boolean): void {
  sessionId = newEventId();
  track("app_session_started", { coldStart });
}

/** Sends one batch now (in the background). Exposed for tests and for going to the background. */
export async function flushAnalytics(): Promise<void> {
  if (flushing || !active) return;
  const token = active.token();
  if (!token) return;
  const cutoff = Date.now() - MAX_AGE_MS;
  queue = queue.filter((e) => Date.parse(e.occurredAt) >= cutoff);
  const batch = queue.slice(0, BATCH_SIZE);
  if (!batch.length) return;
  const gen = generation;
  flushing = true;
  let settled = false;
  try {
    await apiPost("/api/v1/analytics/events", { platform: analyticsPlatform(), ...(VERSION_RE.test(appEnv.appVersion) ? { appVersion: appEnv.appVersion } : {}), events: batch }, token);
    settled = true;
  } catch (error) {
    // Refused as invalid: resending would be refused again, so it is dropped. Offline, timed
    // out, rate limited, signed out or a server error: kept and retried later.
    settled = error instanceof ApiError && error.status >= 400 && error.status < 500 && ![401, 408, 429].includes(error.status);
  } finally {
    flushing = false;
  }
  if (gen !== generation) return; // signed out meanwhile; the stored copy is resent (ids dedupe)
  if (settled) {
    const sent = new Set(batch.map((e) => e.id));
    queue = queue.filter((e) => !sent.has(e.id));
    failures = 0;
    saveSoon();
    if (queue.length) schedule(0);
  } else {
    failures++;
    schedule(RETRY_DELAYS_MS[Math.min(failures, RETRY_DELAYS_MS.length) - 1]!);
  }
}

function onAppState(state: AppStateStatus): void {
  if (!active) return;
  if (state === "active") {
    if (backgroundSince !== null && Date.now() - backgroundSince >= SESSION_GAP_MS) startSession(false);
    backgroundSince = null;
    schedule(FLUSH_SOON_MS);
  } else if (backgroundSince === null) {
    backgroundSince = Date.now();
    if (!restoring) void writeQueue(active.userId, queue);
    void flushAnalytics();
  }
}

async function restore(userId: string, gen: number): Promise<void> {
  const [stored, crash] = await Promise.all([
    AsyncStorage.getItem(PREFIX + userId).catch(() => null),
    AsyncStorage.getItem(CRASH_KEY).catch(() => null),
  ]);
  if (gen !== generation) return;
  restoring = false;
  const known = new Set(queue.map((e) => e.id));
  queue = [...parseQueue(stored).filter((e) => !known.has(e.id)), ...queue].slice(-MAX_QUEUED);
  let record: CrashRecord | null = null;
  try {
    record = crash ? (JSON.parse(crash) as CrashRecord) : null;
  } catch {
    record = null;
  }
  const valid = !!record && UUID_RE.test(record.id) && Number.isFinite(Date.parse(record.occurredAt));
  if (record && valid && record.userId === userId) {
    enqueue({ id: record.id, name: "app_crash", occurredAt: record.occurredAt, sessionId: record.sessionId ?? null, properties: { fatal: true } });
    await writeQueue(userId, queue); // saved with the queue before the record is cleared
    await AsyncStorage.removeItem(CRASH_KEY).catch(() => undefined);
  } else if (crash && (!valid || Date.parse(record!.occurredAt) < Date.now() - MAX_AGE_MS)) {
    await AsyncStorage.removeItem(CRASH_KEY).catch(() => undefined);
  }
  if (gen === generation) {
    restoring = false;
    saveSoon();
    schedule(FLUSH_SOON_MS);
  }
}

/**
 * Starts collecting for the signed-in person: a new app session, their unsent events from
 * earlier, and a crash saved by the previous launch. Returns a stop function.
 */
export function startAnalytics(userId: string, token: () => string | null): () => void {
  if (!UUID_RE.test(userId)) return () => undefined;
  stopAnalytics();
  const gen = ++generation;
  active = { userId, token };
  queue = [];
  failures = 0;
  backgroundSince = null;
  restoring = true;
  startSession(!launched);
  launched = true;
  appState = AppState.addEventListener("change", onAppState);
  void restore(userId, gen);
  return () => {
    if (generation === gen) stopAnalytics();
  };
}

/** Stops on sign-out. Unsent events stay on the phone for that person's next sign-in. */
export function stopAnalytics(): void {
  if (!active) return;
  // Before the stored queue is loaded, writing would replace it with just this session's events.
  if (!restoring) void writeQueue(active.userId, queue.slice());
  restoring = false;
  generation++;
  active = null;
  sessionId = null;
  queue = [];
  appState?.remove();
  appState = null;
  for (const timer of [flushTimer, saveTimer]) if (timer) clearTimeout(timer);
  flushTimer = null;
  saveTimer = null;
}

type GlobalHandler = (error: unknown, isFatal?: boolean) => void;
interface ErrorUtilsLike {
  getGlobalHandler(): GlobalHandler;
  setGlobalHandler(handler: GlobalHandler): void;
}
let crashReportingInstalled = false;

/**
 * Saves a note that a fatal JavaScript error closed the app, so the next launch can report
 * it (crash-free sessions). Only that it happened and in which session: no message, stack or
 * screen content. Native crashes need a native crash reporter and are not counted here.
 */
export function recordFatalErrors(errorUtils: ErrorUtilsLike | undefined = (globalThis as { ErrorUtils?: ErrorUtilsLike }).ErrorUtils): void {
  if (crashReportingInstalled || !errorUtils) return;
  crashReportingInstalled = true;
  const previous = errorUtils.getGlobalHandler();
  errorUtils.setGlobalHandler((error, isFatal) => {
    if (!isFatal || !active) {
      previous(error, isFatal);
      return;
    }
    let handedOver = false;
    const handOver = () => {
      if (handedOver) return;
      handedOver = true;
      previous(error, isFatal);
    };
    const record: CrashRecord = { id: newEventId(), userId: active.userId, sessionId, occurredAt: new Date().toISOString() };
    AsyncStorage.setItem(CRASH_KEY, JSON.stringify(record)).then(handOver, handOver);
    setTimeout(handOver, 1000); // never hold the crash screen back for long
  });
}
