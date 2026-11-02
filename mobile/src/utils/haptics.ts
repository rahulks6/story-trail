import { trigger } from "react-native-haptic-feedback";

/**
 * Light haptic feedback for key moments, like Instagram and Snapchat: a tap when you like or
 * capture, a tick when a filter changes, a success pulse when something is sent, and a short
 * buzz for a wrong quiz answer. Follows the phone's own haptics setting and never vibrates as a
 * fallback.
 */
export type Feedback = "tap" | "select" | "success" | "error";

const TYPES = { tap: "impactLight", select: "selection", success: "notificationSuccess", error: "notificationError" } as const;

export function tapFeedback(kind: Feedback = "tap"): void {
  try {
    trigger(TYPES[kind], { enableVibrateFallback: false, ignoreAndroidSystemSettings: false });
  } catch {
    // Haptics are a nicety: a phone without them just stays still.
  }
}
