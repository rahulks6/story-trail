import { useEffect, useRef } from "react";
import { useAuth } from "../state/AuthContext";
import { startAnalytics } from "./analytics";
import { startCrashReports } from "../crashReporting";
import { reportInstallSource } from "../state/installReferrer";

/** While signed in: app sessions, the background analytics queue (see analytics.ts) and crash reports. */
export function useAnalytics(): void {
  const { status, user, accessToken } = useAuth();
  const tokenRef = useRef(accessToken);
  tokenRef.current = accessToken;
  const userId = status === "signedIn" ? user?.id ?? null : null;

  useEffect(() => {
    if (!userId) return;
    const stopAnalytics = startAnalytics(userId, () => tokenRef.current);
    const stopCrashReports = startCrashReports(userId, () => tokenRef.current);
    // Where this install came from (Google ads, an invite, the Play Store), counted once.
    void reportInstallSource();
    return () => {
      stopAnalytics();
      stopCrashReports();
    };
  }, [userId]);
}
