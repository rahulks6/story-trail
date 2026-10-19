import { useEffect, useState } from "react";
import { AppState } from "react-native";

/** True while the app is in the foreground ("active"): media pauses, and timers stop, otherwise. */
export function useAppForeground(): boolean {
  const [foreground, setForeground] = useState(AppState.currentState === "active");
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (next) => setForeground(next === "active"));
    return () => subscription.remove();
  }, []);
  return foreground;
}
