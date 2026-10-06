/**
 * A single real integration point for crash/error reporting — inert (just
 * `console.error`s, same as this app already does in dozens of `catch`
 * blocks) until a real service is wired in. Sentry is the standard choice
 * for React Native and is what the commented-out code below assumes;
 * swap for Bugsnag/Crashlytics if you'd rather.
 *
 * To turn this on for real, once you have npm access on your own machine:
 *   npm install @sentry/react-native
 *   npx @sentry/wizard@latest -i reactNative   # wires native iOS/Android config too
 * then uncomment the Sentry.init() call this file's own comment shows,
 * call it once near the top of App.tsx, add a `sentryDsn` field to
 * src/config/env.ts's AppEnv, and uncomment the two Sentry calls below.
 *
 * import * as Sentry from "@sentry/react-native";
 * Sentry.init({ dsn: appEnv.sentryDsn, tracesSampleRate: 0.2 });
 */

import { recordFatalErrors, track } from "./analytics/analytics";

/**
 * Call once at startup (index.js). A fatal JavaScript error is noted on the phone before the
 * app closes and counted on the next launch (Admin analytics: crash-free sessions).
 */
export function installCrashReporting(): void {
  recordFatalErrors();
}

/** A render crash the ErrorBoundary caught: the app stays open but the session was hurt. */
export function reportCrash(error: Error, context?: Record<string, unknown>): void {
  // Sentry.captureException(error, { extra: context });
  console.error("[crash]", error, context);
  track("app_crash", { fatal: false });
}

/** For a caught-and-handled error worth knowing about in aggregate, not just a routine ApiError shown to the user. */
export function reportHandledError(error: unknown, context?: Record<string, unknown>): void {
  // Sentry.captureException(error, { extra: context });
  console.error("[handled error]", error, context);
}
