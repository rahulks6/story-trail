/**
 * Crash reports, to Katkee's own server (POST /api/v1/crash-reports; no third-party SDK: the
 * privacy policy promises none). A report is the JavaScript error, its stack, the screen it
 * happened on and the phone and app version: never message text, captions or media.
 *
 * A fatal error is saved on the phone before the app closes and sent on the next launch;
 * a screen that crashed (the ErrorBoundary caught it) is sent straight away. Reports wait on
 * the phone (at most 20, for a week) while offline. Native crashes are in Play Console's
 * Android vitals and App Store Connect, which collect them without an SDK.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import { newEventId, recordFatalErrors, track } from "./analytics/analytics";
import { ApiError, apiPost } from "./api/client";
import { appEnv } from "./config/env";

export type CrashKind = "fatal" | "render" | "handled";

export interface CrashReport {
  clientReportId: string;
  kind: CrashKind;
  name: string;
  message: string;
  stack: string;
  componentStack: string;
  screen: string;
  osVersion: string;
  appVersion: string;
  deviceModel: string;
  occurredAt: string;
  /** Whose app it was (null before sign-in): sent only from that account. Never sent itself. */
  userId: string | null;
}

const KEY = "katkee.crashReports.v1";
const MAX_PENDING = 20;
const MAX_AGE_MS = 7 * 86_400_000;

let pending: CrashReport[] = [];
let loaded: Promise<void> | null = null;
let currentScreen = "";
let currentUser: string | null = null;
let getToken: (() => string | null) | null = null;
let flushing: Promise<void> | null = null;

/** The screen on view (RootNavigator), so a report says where it happened. */
export function setCurrentScreen(name: string | undefined): void {
  currentScreen = (name ?? "").slice(0, 80);
}

/** What kind of phone, as far as React Native knows without a native module. */
export function deviceModel(): string {
  const c = (Platform.constants ?? {}) as Record<string, unknown>;
  if (Platform.OS === "android") return [c.Brand, c.Model].filter((v) => typeof v === "string" && v).join(" ").slice(0, 80);
  return typeof c.interfaceIdiom === "string" ? (c.interfaceIdiom === "pad" ? "iPad" : "iPhone") : "";
}

export function osVersion(): string {
  return String(Platform.Version ?? "").slice(0, 40);
}

export function describeError(error: unknown, kind: CrashKind, componentStack = ""): CrashReport {
  const e = error instanceof Error ? error : null;
  return {
    clientReportId: newEventId(),
    kind,
    name: (e?.name || "Error").slice(0, 120),
    message: (e ? e.message : typeof error === "string" ? error : "Unknown error").slice(0, 500),
    stack: (e?.stack ?? "").slice(0, 8000),
    componentStack: componentStack.slice(0, 4000),
    screen: currentScreen,
    osVersion: osVersion(),
    appVersion: appEnv.appVersion,
    deviceModel: deviceModel(),
    occurredAt: new Date().toISOString(),
    userId: currentUser,
  };
}

function load(): Promise<void> {
  loaded ??= AsyncStorage.getItem(KEY)
    .then((raw) => {
      const list = raw ? (JSON.parse(raw) as CrashReport[]) : [];
      const fresh = Array.isArray(list) ? list.filter((r) => r && typeof r.clientReportId === "string" && Date.parse(r.occurredAt) > Date.now() - MAX_AGE_MS) : [];
      const known = new Set(pending.map((r) => r.clientReportId));
      pending = [...fresh.filter((r) => !known.has(r.clientReportId)), ...pending].slice(-MAX_PENDING);
    })
    .catch(() => undefined);
  return loaded;
}

function save(): Promise<void> {
  return (pending.length ? AsyncStorage.setItem(KEY, JSON.stringify(pending)) : AsyncStorage.removeItem(KEY)).catch(() => undefined);
}

function add(report: CrashReport): Promise<void> {
  pending = [...pending, report].slice(-MAX_PENDING);
  return save();
}

function isPermanent(error: unknown): boolean {
  return error instanceof ApiError && error.status >= 400 && error.status < 500 && ![401, 408, 429].includes(error.status);
}

/** Sends what's waiting, oldest first; stops at the first failure that a later try could fix. */
export function flushCrashReports(): Promise<void> {
  flushing ??= (async () => {
    await load();
    const token = getToken?.();
    if (!token || !currentUser) return;
    for (const report of [...pending]) {
      if (report.userId && report.userId !== currentUser) continue; // someone else's: theirs to send
      const { userId: _owner, ...body } = report;
      try {
        await apiPost("/api/v1/crash-reports", body, token);
      } catch (error) {
        if (!isPermanent(error)) break;
      }
      pending = pending.filter((r) => r.clientReportId !== report.clientReportId);
      await save();
    }
  })().finally(() => {
    flushing = null;
  });
  return flushing;
}

/** While signed in: sends saved reports now and new ones as they happen. */
export function startCrashReports(userId: string, token: () => string | null): () => void {
  currentUser = userId;
  getToken = token;
  void flushCrashReports();
  return () => {
    if (currentUser === userId) {
      currentUser = null;
      getToken = null;
    }
  };
}

type GlobalHandler = (error: unknown, isFatal?: boolean) => void;
interface ErrorUtilsLike {
  getGlobalHandler(): GlobalHandler;
  setGlobalHandler(handler: GlobalHandler): void;
}
let installed = false;

/**
 * Call once at startup (index.js). A fatal JavaScript error is saved on the phone before the
 * app closes: its details for the crash report, and the crash count for Admin analytics.
 */
export function installCrashReporting(errorUtils: ErrorUtilsLike | undefined = (globalThis as { ErrorUtils?: ErrorUtilsLike }).ErrorUtils): void {
  recordFatalErrors(errorUtils);
  if (installed || !errorUtils) return;
  installed = true;
  void load();
  const next = errorUtils.getGlobalHandler();
  errorUtils.setGlobalHandler((error, isFatal) => {
    // The write starts before the crash count's (next), so it lands first; nothing here waits.
    if (isFatal) {
      try {
        void add(describeError(error, "fatal"));
      } catch {
        // Never stand between the app and its crash screen.
      }
    }
    next(error, isFatal);
  });
}

/** A render crash the ErrorBoundary caught: the app stays open but the screen was lost. */
export function reportCrash(error: Error, context?: { componentStack?: string }): void {
  console.error("[crash]", error, context);
  track("app_crash", { fatal: false });
  void add(describeError(error, "render", context?.componentStack ?? "")).then(() => flushCrashReports());
}

/** For a caught-and-handled error worth knowing about in aggregate, not a routine ApiError shown to the user. */
export function reportHandledError(error: unknown): void {
  console.error("[handled error]", error);
  void add(describeError(error, "handled")).then(() => flushCrashReports());
}

/** Tests only. */
export function resetCrashReportsForTests(): void {
  pending = [];
  loaded = null;
  currentUser = null;
  getToken = null;
  currentScreen = "";
  installed = false;
}
