import { useEffect, useRef } from "react";
import { useAuth } from "../state/AuthContext";
import {
  hasAskedForPush,
  pushPermission,
  registerForPush,
  requestPushPermission,
  watchPushToken,
} from "./pushNotifications";

/**
 * While signed in: registers this device for pushes if notifications are already
 * allowed (never prompts), and keeps the server's copy of the token current.
 */
export function usePushRegistration(): void {
  const { status, user, accessToken } = useAuth();
  const tokenRef = useRef(accessToken);
  tokenRef.current = accessToken;
  const userId = status === "signedIn" ? user?.id ?? null : null;

  useEffect(() => {
    if (!userId) return;
    const token = tokenRef.current;
    if (token) void registerForPush(userId, token);
    return watchPushToken(() => (tokenRef.current ? { userId, accessToken: tokenRef.current } : null));
  }, [userId]);
}

/**
 * Asks for notification permission once, in context (the first visit to Messages or
 * Activity), rather than at launch; then registers the device. Later visits do
 * nothing; Settings → Notifications can still turn pushes on.
 */
export async function askForPushOnce(userId: string, accessToken: string): Promise<void> {
  const permission = await pushPermission();
  if (permission === "unavailable") return;
  if (permission === "granted") {
    await registerForPush(userId, accessToken);
    return;
  }
  if (permission !== "undetermined" || (await hasAskedForPush())) return;
  if (await requestPushPermission()) await registerForPush(userId, accessToken);
}
