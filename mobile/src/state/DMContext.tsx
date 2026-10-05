import React, { createContext, useContext, useMemo } from "react";
import { getUnreadConversationCount } from "../api/conversations";
import type { RealtimeEvent } from "../realtime/realtimeClient";
import { useLiveCount } from "./useLiveCount";

interface DMContextValue {
  unreadCount: number;
  refreshUnreadCount: () => Promise<void>;
}

const DMContext = createContext<DMContextValue | null>(null);

/** A new message (either way) or this account reading a thread, maybe on another device. */
const changesUnread = (event: RealtimeEvent, me: string | undefined) =>
  event.type === "message" || (event.type === "receipt" && event.userId === me);

/**
 * The DM tab's own unread badge — a separate count from Activity's, the same
 * way a real app's message badge and notification badge are independent
 * numbers. Kept current over the realtime connection (see useLiveCount.ts).
 */
export function DMProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const { count, refresh } = useLiveCount(getUnreadConversationCount, changesUnread);
  const value = useMemo<DMContextValue>(() => ({ unreadCount: count, refreshUnreadCount: refresh }), [count, refresh]);
  return <DMContext.Provider value={value}>{children}</DMContext.Provider>;
}

export function useDM(): DMContextValue {
  const ctx = useContext(DMContext);
  if (!ctx) throw new Error("useDM must be used within a DMProvider");
  return ctx;
}
