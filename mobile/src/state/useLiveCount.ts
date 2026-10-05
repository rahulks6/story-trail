import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import type { RealtimeEvent } from "../realtime/realtimeClient";
import { useAuth } from "./AuthContext";
import { useRealtime } from "./RealtimeContext";

/** Polling is only the fallback: frequent while the live connection is down, a slow safety net while it's up. */
const POLL_OFFLINE_MS = 20_000;
const POLL_LIVE_MS = 120_000;

/**
 * A badge count kept current by realtime events (and a resync after every reconnect),
 * re-fetched when the app returns to the foreground, with polling as the fallback.
 * Overlapping refreshes collapse into one request plus at most one follow-up, so a
 * burst of events costs two requests, not one per event.
 */
export function useLiveCount(
  fetchCount: (accessToken: string) => Promise<{ count: number }>,
  isRelevant: (event: RealtimeEvent, myUserId: string | undefined) => boolean,
): { count: number; refresh: () => Promise<void> } {
  const { accessToken, user } = useAuth();
  const { connected, subscribe } = useRealtime();
  const [count, setCount] = useState(0);
  const tokenRef = useRef(accessToken);
  tokenRef.current = accessToken;
  const userIdRef = useRef(user?.id);
  userIdRef.current = user?.id;
  const relevantRef = useRef(isRelevant);
  relevantRef.current = isRelevant;
  const running = useRef<Promise<void> | null>(null);
  const again = useRef(false);

  const refresh = useCallback(async () => {
    if (running.current) {
      again.current = true;
      return running.current;
    }
    const work = (async () => {
      do {
        again.current = false;
        const token = tokenRef.current;
        if (!token) {
          setCount(0);
          return;
        }
        try {
          const result = await fetchCount(token);
          if (tokenRef.current === token) setCount(result.count);
        } catch {
          // Best-effort badge: a transient failure keeps the last known count.
        }
      } while (again.current);
    })();
    running.current = work;
    try {
      await work;
    } finally {
      running.current = null;
    }
  }, [fetchCount]);

  useEffect(() => {
    if (!accessToken) {
      setCount(0);
      return;
    }
    void refresh();
    const interval = setInterval(() => {
      if (AppState.currentState === "active") void refresh();
    }, connected ? POLL_LIVE_MS : POLL_OFFLINE_MS);
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void refresh();
    });
    return () => {
      clearInterval(interval);
      subscription.remove();
    };
  }, [accessToken, connected, refresh]);

  useEffect(
    () => subscribe((event) => {
      if (event.type === "resync" || relevantRef.current(event, userIdRef.current)) void refresh();
    }),
    [subscribe, refresh],
  );

  return { count, refresh };
}
