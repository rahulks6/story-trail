import React, { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, StyleSheet, Text } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { radii, spacing } from "../theme";

/**
 * A short confirmation that fades in above the tab bar and goes by itself ("Link copied",
 * "Muted @asha"), instead of a dialog someone has to dismiss. Errors that need a choice stay alerts.
 */
type Listener = (text: string) => void;
const listeners = new Set<Listener>();

export function showToast(text: string): void {
  listeners.forEach((fn) => fn(text));
  // Screen readers hear it even though nothing took focus.
  AccessibilityInfo.announceForAccessibility?.(text);
}

const VISIBLE_MS = 2200;

/** Mounted once, at the app's root. */
export function ToastHost(): React.JSX.Element | null {
  const { bottom } = useSafeAreaInsets();
  const [text, setText] = useState<string | null>(null);
  const opacity = useRef(new Animated.Value(0)).current;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const show: Listener = (next) => {
      setText(next);
      if (timer.current) clearTimeout(timer.current);
      Animated.timing(opacity, { toValue: 1, duration: 160, useNativeDriver: true }).start();
      timer.current = setTimeout(() => {
        Animated.timing(opacity, { toValue: 0, duration: 220, useNativeDriver: true }).start(({ finished }) => { if (finished) setText(null); });
      }, VISIBLE_MS);
    };
    listeners.add(show);
    return () => {
      listeners.delete(show);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [opacity]);

  if (!text) return null;
  return (
    <Animated.View pointerEvents="none" style={[styles.toast, { bottom: bottom + 96, opacity }]} accessibilityLiveRegion="polite">
      <Text style={styles.text} numberOfLines={2}>{text}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // The same dark pill in light and dark mode, like the system's own.
  toast: { position: "absolute", alignSelf: "center", maxWidth: "86%", paddingHorizontal: spacing.lg, paddingVertical: spacing.sm + 2, borderRadius: radii.pill, backgroundColor: "rgba(28,28,30,0.94)" },
  text: { color: "#FFFFFF", fontSize: 14, fontWeight: "600", textAlign: "center" },
});
