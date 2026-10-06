import { useEffect, useRef } from "react";
import { useAuth } from "../state/AuthContext";
import { startAnalytics } from "./analytics";

/** While signed in: app sessions and the background analytics queue (see analytics.ts). */
export function useAnalytics(): void {
  const { status, user, accessToken } = useAuth();
  const tokenRef = useRef(accessToken);
  tokenRef.current = accessToken;
  const userId = status === "signedIn" ? user?.id ?? null : null;

  useEffect(() => {
    if (!userId) return;
    return startAnalytics(userId, () => tokenRef.current);
  }, [userId]);
}
