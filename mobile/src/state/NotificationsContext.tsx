import React, { createContext, useContext, useMemo } from "react";
import { getUnreadNotificationCount } from "../api/notifications";
import type { RealtimeEvent } from "../realtime/realtimeClient";
import { useLiveCount } from "./useLiveCount";

interface NotificationsContextValue {
  unreadCount: number;
  refreshUnreadCount: () => Promise<void>;
}

const NotificationsContext = createContext<NotificationsContextValue | null>(null);

const isNewActivity = (event: RealtimeEvent) => event.type === "notification";

/**
 * Shares the unread-notification badge count between the Activity tab icon
 * (BottomTabBar) and the ActivityScreen list itself, so marking something
 * read in one place updates the other without a prop-drilled refetch. New
 * Activity arrives over the realtime connection (see useLiveCount.ts); polling
 * is only the fallback while that connection is down.
 */
export function NotificationsProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const { count, refresh } = useLiveCount(getUnreadNotificationCount, isNewActivity);
  const value = useMemo<NotificationsContextValue>(() => ({ unreadCount: count, refreshUnreadCount: refresh }), [count, refresh]);
  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
}

export function useNotifications(): NotificationsContextValue {
  const ctx = useContext(NotificationsContext);
  if (!ctx) throw new Error("useNotifications must be used within a NotificationsProvider");
  return ctx;
}
