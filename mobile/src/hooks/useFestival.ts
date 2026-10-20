import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../state/AuthContext";
import { getCurrentFestival, type CurrentFestival } from "../api/festivals";

// One answer shared by Home and the editor; refreshed after a few minutes.
const FRESH_MS = 5 * 60_000;
let cached: { at: number; value: CurrentFestival } | null = null;

/** Today's festival and its Stories (null until loaded, or when offline). */
export function useFestival(): { current: CurrentFestival | null; reload: () => void } {
  const { accessToken } = useAuth();
  const [current, setCurrent] = useState<CurrentFestival | null>(cached?.value ?? null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!accessToken) return;
    if (version === 0 && cached && Date.now() - cached.at < FRESH_MS) {
      setCurrent(cached.value);
      return;
    }
    const controller = new AbortController();
    getCurrentFestival(accessToken, controller.signal)
      .then((value) => {
        cached = { at: Date.now(), value };
        setCurrent(value);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [accessToken, version]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  return { current, reload };
}

/** For tests. */
export function resetFestivalCache(): void {
  cached = null;
}
