import { useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";

/**
 * Whether VoiceOver or TalkBack is on, kept live. Button stand-ins for gestures (cropping,
 * moving text) are shown only then: a screen reader takes over the raw touches those gestures
 * need, and everyone else uses their fingers, as on Instagram.
 */
export function useScreenReader(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    let cancelled = false;
    AccessibilityInfo.isScreenReaderEnabled().then((enabled) => {
      if (!cancelled) setOn(enabled);
    }).catch(() => undefined);
    const subscription = AccessibilityInfo.addEventListener("screenReaderChanged", (enabled) => setOn(enabled));
    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, []);
  return on;
}
