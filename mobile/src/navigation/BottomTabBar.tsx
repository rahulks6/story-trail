import { Icon } from "../components/Icon";
import React, { useContext, useEffect } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { BottomTabBarHeightCallbackContext, type BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { getFocusedRouteNameFromRoute } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, radii, spacing, typography, ICONS } from "../theme";
import { useDM } from "../state/DMContext";

const TAB_LABELS: Record<string, string> = {
  Home: "Home",
  Search: "Search",
  Create: "",
  DM: "Messages",
  Profile: "Profile",
};

const TAB_ICONS: Record<string, import("../theme/icons").IconName> = {
  Home: ICONS.home,
  Search: ICONS.search,
  DM: ICONS.dm,
  Profile: ICONS.profile,
};

/**
 * Custom bottom tab bar: HOME | SEARCH | + | DM | PROFILE, with the centre Create button raised
 * in Katkee amber so it reads as the primary action. Hidden where the screen needs all of it,
 * like Instagram: the camera and Story editor, and an open chat.
 */
export function tabBarHidden(state: BottomTabBarProps["state"]): boolean {
  const route = state.routes[state.index];
  if (!route) return false;
  if (route.name === "Create") return true;
  if (route.name === "DM") return (getFocusedRouteNameFromRoute(route) ?? "DMInbox") !== "DMInbox";
  return false;
}

export function BottomTabBar({ state, descriptors, navigation }: BottomTabBarProps): React.JSX.Element {
  const { unreadCount: unreadMessages } = useDM();
  // Clears the iPhone home indicator and Android's gesture/navigation bar (edge-to-edge).
  const { bottom } = useSafeAreaInsets();
  // Screens read the tab bar's height to know whether they must clear the bottom edge
  // themselves (hooks/useScreenInsets.ts); a custom bar has to report it, 0 while hidden.
  const reportHeight = useContext(BottomTabBarHeightCallbackContext);
  const hidden = tabBarHidden(state);
  useEffect(() => {
    if (hidden) reportHeight?.(0);
  }, [hidden, reportHeight]);
  if (hidden) return <View />;

  return (
    <View
      style={[styles.container, { paddingBottom: Math.max(bottom, spacing.sm) }]}
      onLayout={(e) => reportHeight?.(e.nativeEvent.layout.height)}
      accessibilityRole="tablist"
    >
      {state.routes.map((route, index) => {
        const { options } = descriptors[route.key];
        const isFocused = state.index === index;
        const label = TAB_LABELS[route.name] ?? route.name;

        const onPress = () => {
          const event = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
          if (event.defaultPrevented) return;
          // Messages always opens on the list of conversations; pick one to open the chat.
          if (route.name === "DM") navigation.navigate("DM", { screen: "DMInbox" });
          // Search always gets back to searching, even after a profile opened from elsewhere.
          else if (route.name === "Search") navigation.navigate("Search", { screen: "SearchHome" });
          else if (!isFocused) navigation.navigate(route.name);
        };

        if (route.name === "Create") {
          return (
            <Pressable
              key={route.key}
              accessibilityRole="tab"
              accessibilityState={{ selected: isFocused }}
              accessibilityLabel="Create a Story"
              onPress={onPress}
              style={styles.createButtonWrapper}
            >
              <View style={styles.createButton}>
                <Icon style={styles.createButtonGlyph} name={ICONS.create} />
              </View>
            </Pressable>
          );
        }

        const badgeCount = route.name === "DM" ? unreadMessages : 0;
        const showUnreadBadge = badgeCount > 0;

        return (
          <Pressable
            key={route.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: isFocused }}
            accessibilityLabel={
              showUnreadBadge
                ? `${options.tabBarAccessibilityLabel ?? label}, ${badgeCount} unread`
                : (options.tabBarAccessibilityLabel ?? label)
            }
            onPress={onPress}
            style={styles.tabItem}
          >
            <View style={styles.tabContent}>
              <Icon style={[styles.tabIcon, isFocused && styles.labelFocused]} name={TAB_ICONS[route.name] ?? "home"} selected={isFocused} />
              {showUnreadBadge ? (
                <View style={styles.unreadBadge}>
                  <Text style={styles.unreadBadgeText} maxFontSizeMultiplier={1.2}>{badgeCount > 99 ? "99+" : badgeCount}</Text>
                </View>
              ) : null}
            </View>
            <Text style={[typography.caption, styles.tabLabel, isFocused && styles.labelFocused]}>{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingTop: spacing.xs,
  },
  tabItem: {
    minHeight:48,
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
    paddingVertical: spacing.xs,
  },
  tabContent: { alignItems: "center", justifyContent: "center" },
  tabIcon: { fontSize: 22, color: colors.textSecondary },
  tabLabel: { color: colors.textSecondary, fontSize: 11 },
  labelFocused: {
    color: colors.accent,
    fontWeight: "700",
  },
  unreadBadge: {
    position: "absolute",
    top: -6,
    right: -14,
    minWidth: 16,
    height: 16,
    borderRadius: radii.pill,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 3,
  },
  unreadBadgeText: {
    color: colors.onAccent,
    fontSize: 10,
    fontWeight: "700",
  },
  createButtonWrapper: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    marginTop: -spacing.lg,
  },
  createButton: {
    width: 56,
    height: 56,
    borderRadius: radii.pill,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: colors.accent,
    shadowOpacity: 0.4,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  createButtonGlyph: {
    fontSize: 30,
    fontWeight: "700",
    color: colors.onAccent,
    lineHeight: 32,
  },
});
