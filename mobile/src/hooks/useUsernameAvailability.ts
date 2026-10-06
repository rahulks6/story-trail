import { useEffect, useState } from "react";
import { checkUsername, type UsernameAvailability } from "../api/users";
import { useDebouncedValue } from "./useDebouncedValue";

export type UsernameCheck =
  | { state: "idle" }
  | { state: "checking"; username: string }
  | { state: "done"; username: string; result: UsernameAvailability }
  // Offline or the check failed: say nothing; saving checks again anyway.
  | { state: "error"; username: string };

/**
 * Whether a username can be taken, checked as someone types (spec section 23): debounced, and
 * a newer name cancels the request for an older one, so a slow answer never shows against the
 * wrong text. The server decides again when the name is saved; this only informs.
 * `current` is the person's own username (Edit Profile), which needs no check.
 */
export function useUsernameAvailability(username: string, accessToken: string | null, current?: string): UsernameCheck {
  const name = username.trim().toLowerCase();
  const settled = useDebouncedValue(name, 400);
  const [check, setCheck] = useState<UsernameCheck>({ state: "idle" });

  useEffect(() => {
    if (settled.length < 3 || settled.length > 30 || settled === current) {
      setCheck({ state: "idle" });
      return;
    }
    const controller = new AbortController();
    setCheck({ state: "checking", username: settled });
    checkUsername(settled, accessToken, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setCheck({ state: "done", username: settled, result });
      })
      .catch(() => {
        if (!controller.signal.aborted) setCheck({ state: "error", username: settled });
      });
    return () => controller.abort();
  }, [settled, accessToken, current]);

  // An answer is only about the name it was asked for: while the text has moved on, it's pending.
  if (check.state !== "idle" && check.username !== name) {
    return name.length >= 3 && name.length <= 30 && name !== current ? { state: "checking", username: name } : { state: "idle" };
  }
  return check;
}

/** The answer as one line under the field: the server's message when the name can't be used. */
export function usernameCheckText(check: UsernameCheck): { text: string; tone: "info" | "success" | "error" } | null {
  if (check.state === "checking") return { text: "Checking…", tone: "info" };
  if (check.state !== "done") return null;
  if (check.result.available) return { text: check.result.reason === "yours" ? check.result.message : "Available.", tone: "success" };
  return { text: check.result.message, tone: "error" };
}

/** True only when the latest answer for exactly this text says it can't be used. */
export function usernameRefused(check: UsernameCheck): boolean {
  return check.state === "done" && !check.result.available;
}
