import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { API_BASE_URL } from "../api/client";
import { createRealtimeTicket } from "../api/realtime";
import { RealtimeClient, type RealtimeEvent } from "../realtime/realtimeClient";
import { flushOutbox, loadOutbox } from "./dmOutbox";
import { useAuth } from "./AuthContext";

interface RealtimeContextValue {
  /** True while the live connection is open; screens poll less while it is. */
  connected: boolean;
  subscribe: (listener: (event: RealtimeEvent) => void) => () => void;
}

const RealtimeContext = createContext<RealtimeContextValue | null>(null);

/** How long the connection survives in the background before closing (pushes take over). */
const BACKGROUND_GRACE_MS = 15_000;

/**
 * Keeps one realtime connection while signed in and in the foreground (see
 * realtime/realtimeClient.ts), fans its events out to screens, and sends the DM
 * outbox whenever the app comes back or the connection returns.
 */
export function RealtimeProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const { status, user, accessToken, refreshUser } = useAuth();
  const refreshUserRef = useRef(refreshUser);
  refreshUserRef.current = refreshUser;
  const [connected, setConnected] = useState(false);
  const listeners = useRef(new Set<(event: RealtimeEvent) => void>());
  const tokenRef = useRef(accessToken);
  tokenRef.current = accessToken;
  const userId = status === "signedIn" ? user?.id ?? null : null;

  const subscribe = useCallback((listener: (event: RealtimeEvent) => void) => {
    listeners.current.add(listener);
    return () => { listeners.current.delete(listener); };
  }, []);

  useEffect(() => {
    if (!userId) return;
    const getToken = () => tokenRef.current;
    const sendOutbox = (force: boolean) => void flushOutbox(userId, getToken, { force });
    void loadOutbox(userId).then(() => sendOutbox(true));

    const client = new RealtimeClient({
      baseUrl: API_BASE_URL,
      createTicket: async () => {
        const token = tokenRef.current;
        if (!token) throw Object.assign(new Error("Signed out."), { status: 401 });
        return (await createRealtimeTicket(token)).ticket;
      },
      onEvent: (event) => {
        if (event.type === "resync") sendOutbox(true); // connected again: the network works
        for (const listener of [...listeners.current]) {
          try { listener(event); } catch { /* one screen's bug must not break the others */ }
        }
      },
      onStatus: (next) => setConnected(next === "open"),
      // The server ended this sign-in (signed out elsewhere, password changed): any API
      // call now gets 401, the refresh fails, and the app signs out.
      onSignedOut: () => void refreshUserRef.current(),
    });

    let backgroundTimer: ReturnType<typeof setTimeout> | null = null;
    const onAppState = (state: AppStateStatus) => {
      if (state === "active") {
        if (backgroundTimer) clearTimeout(backgroundTimer);
        backgroundTimer = null;
        client.start();
        sendOutbox(true);
      } else if (state === "background" && !backgroundTimer) {
        backgroundTimer = setTimeout(() => {
          backgroundTimer = null;
          client.stop();
        }, BACKGROUND_GRACE_MS);
      }
    };
    onAppState(AppState.currentState === "background" ? "background" : "active");
    const subscription = AppState.addEventListener("change", onAppState);
    return () => {
      subscription.remove();
      if (backgroundTimer) clearTimeout(backgroundTimer);
      client.stop();
      setConnected(false);
    };
  }, [userId]);

  const value = useMemo<RealtimeContextValue>(() => ({ connected, subscribe }), [connected, subscribe]);
  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}

export function useRealtime(): RealtimeContextValue {
  const ctx = useContext(RealtimeContext);
  if (!ctx) throw new Error("useRealtime must be used within a RealtimeProvider");
  return ctx;
}

/** Runs `handler` for every realtime event while the calling component is mounted. */
export function useRealtimeEvents(handler: (event: RealtimeEvent) => void): void {
  const { subscribe } = useRealtime();
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => subscribe((event) => latest.current(event)), [subscribe]);
}
