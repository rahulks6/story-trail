import React, { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, PanResponder, StyleSheet, Text, View } from "react-native";
import { Pressable } from "./Pressable";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { onForegroundPush, type ForegroundNotice } from "../push/pushNotifications";
import { deepLinkTarget, linkPath } from "../navigation/profileLinks";
import { colors, radii, spacing, typography } from "../theme";
import { tapFeedback } from "../utils/haptics";

const VISIBLE_MS = 4000;

interface Props {
  /** The screen on view and its params, so a message for the open chat doesn't show a banner. */
  currentRoute: () => { name: string; params?: object } | undefined;
  /** Opens the notification's link the way a tapped system notification would. */
  open: (url: string) => void;
}

/** Whether the push is about what's already on screen: that chat, or Activity itself. */
export function isAboutCurrentScreen(url: string | null, route: { name: string; params?: object } | undefined): boolean {
  if (!url || !route) return false;
  const path = linkPath(url);
  const target = path === null ? null : deepLinkTarget(path);
  if (target?.kind === "conversation") {
    return route.name === "Conversation" && (route.params as { conversationId?: string } | undefined)?.conversationId === target.conversationId;
  }
  if (target?.kind === "activity") return route.name === "Activity";
  return false;
}

/**
 * While the app is open the system shows no notification, so a new message from someone you're
 * not chatting with right now would go unnoticed. This slides a banner down from the top (tap to
 * open, swipe up to dismiss); it goes by itself after a few seconds.
 */
export function InAppNotificationBanner({ currentRoute, open }: Props): React.JSX.Element | null {
  const { top } = useSafeAreaInsets();
  const [notice, setNotice] = useState<ForegroundNotice | null>(null);
  const offset = useRef(new Animated.Value(-160)).current;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const routeRef = useRef(currentRoute);
  routeRef.current = currentRoute;

  const hide = useRef(() => {
    if (timer.current) clearTimeout(timer.current);
    Animated.timing(offset, { toValue: -160, duration: 200, useNativeDriver: true }).start(({ finished }) => {
      if (finished) setNotice(null);
    });
  }).current;

  useEffect(() => {
    const stop = onForegroundPush((next) => {
      if (isAboutCurrentScreen(next.url, routeRef.current())) return;
      setNotice(next);
      tapFeedback("tap");
      AccessibilityInfo.announceForAccessibility?.(`${next.title}. ${next.body}`);
      Animated.spring(offset, { toValue: 0, useNativeDriver: true, bounciness: 4 }).start();
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(hide, VISIBLE_MS);
    });
    return () => {
      stop();
      if (timer.current) clearTimeout(timer.current);
    };
  }, [hide, offset]);

  // Swipe up to dismiss; the banner follows the finger upwards only.
  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) => g.dy < -6 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderMove: (_e, g) => offset.setValue(Math.min(0, g.dy)),
      onPanResponderRelease: (_e, g) => {
        if (g.dy < -24) hide();
        else Animated.spring(offset, { toValue: 0, useNativeDriver: true }).start();
      },
    }),
  ).current;

  if (!notice) return null;
  return (
    <Animated.View style={[styles.wrap, { top: top + spacing.xs, transform: [{ translateY: offset }] }]} pointerEvents="box-none">
      <View collapsable={false} {...pan.panHandlers}>
        <Pressable
          style={styles.card}
          onPress={() => {
            hide();
            if (notice.url) open(notice.url);
          }}
          accessibilityRole="button"
          accessibilityLabel={`${notice.title}. ${notice.body}`}
          accessibilityHint={notice.url ? "Opens it" : undefined}
        >
          <Text style={styles.title} numberOfLines={1}>{notice.title}</Text>
          {notice.body ? <Text style={styles.body} numberOfLines={2}>{notice.body}</Text> : null}
        </Pressable>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", left: spacing.sm, right: spacing.sm, zIndex: 100, elevation: 100 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    shadowColor: "#000",
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  title: { ...typography.bodyStrong, color: colors.textPrimary },
  body: { ...typography.body, color: colors.textSecondary, marginTop: 2 },
});
