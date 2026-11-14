import { Icon } from "../components/Icon";
import React, { useContext, useEffect, useRef } from "react";
import { Animated, StyleSheet, Text, View } from "react-native";
import { Pressable } from "../components/Pressable";
import { BottomTabBarHeightCallbackContext, type BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { getFocusedRouteNameFromRoute } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, mediaColors, radii, spacing, ICONS } from "../theme";
import { useDM } from "../state/DMContext";
import { useAuth } from "../state/AuthContext";
import { Avatar } from "../components/Avatar";
import { tapFeedback } from "../utils/haptics";
import { t } from "../i18n";

const TAB_LABELS: Record<string, string> = {
  get Home() { return t("bottomTabBar.home"); },
  get Search() { return t("common.search"); },
  Create: "",
  get DM() { return t("common.messages"); },
  get Profile() { return t("bottomTabBar.profile"); },
};

const TAB_ICONS: Record<string, import("../theme/icons").IconName> = {
  Home: ICONS.home,
  Search: ICONS.search,
  DM: ICONS.dm,
  Profile: ICONS.profile,
};

/**
 * Custom bottom tab bar: HOME | SEARCH | + | DM | PROFILE, as Instagram draws it: icons only (each
 * tab still has its name for screen readers), the current one solid, Create a + in a rounded
 * square, and Profile your own photo. Black on Home, where Stories fill the screen behind it.
 * Hidden where the screen needs all of it: the camera and Story editor, and an open chat.
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
  const onMedia = state.routes[state.index]?.name === "Home";
  const ink = onMedia ? mediaColors.textPrimary : colors.textPrimary;

  return (
    <View
      style={[styles.container, onMedia && styles.containerOnMedia, { paddingBottom: Math.max(bottom, spacing.xs) }]}
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
          if (!isFocused) tapFeedback("select");
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
              accessibilityLabel={t("bottomTabBar.createAStory")}
              onPress={onPress}
              style={styles.tabItem}
            >
              <Icon name={ICONS.create} framed size={26} color={ink} />
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
                ? t("bottomTabBar.tabbaraccessibilitylabelBadgecountUn", { tabBarAccessibilityLabel: options.tabBarAccessibilityLabel ?? label, badgeCount })
                : (options.tabBarAccessibilityLabel ?? label)
            }
            onPress={onPress}
            style={styles.tabItem}
          >
            <View style={styles.tabContent}>
              {route.name === "Profile" ? (
                <ProfileTab focused={isFocused} ring={ink} />
              ) : (
                <TabIcon focused={isFocused} name={TAB_ICONS[route.name] ?? "home"} color={ink} />
              )}
              {showUnreadBadge ? (
                <View style={[styles.unreadBadge, { borderColor: onMedia ? mediaColors.background : colors.background }]}>
                  <Text style={styles.unreadBadgeText} maxFontSizeMultiplier={1.2}>{badgeCount > 99 ? "99+" : badgeCount}</Text>
                </View>
              ) : null}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

/** The tab's icon gives a small bounce when its tab becomes the current one. */
function TabIcon({ focused, name, color }: { focused: boolean; name: import("../theme/icons").IconName; color: string }): React.JSX.Element {
  const scale = useRef(new Animated.Value(1)).current;
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (!focused) return;
    scale.setValue(0.82);
    Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 14, bounciness: 12 }).start();
  }, [focused, scale]);
  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Icon size={26} color={color} name={name} selected={focused} />
    </Animated.View>
  );
}

/** Profile is your own photo (or initial), ringed while it's the current tab. */
function ProfileTab({ focused, ring }: { focused: boolean; ring: string }): React.JSX.Element {
  const { user } = useAuth();
  if (!user) return <Icon size={26} color={ring} name={ICONS.profile} selected={focused} />;
  return (
    <View style={[styles.profileRing, focused && { borderColor: ring }]}>
      <Avatar username={user.username} displayName={user.displayName} avatarMediaId={user.avatarMediaId} size={24} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.background,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingTop: spacing.xs,
  },
  containerOnMedia: { backgroundColor: mediaColors.background, borderTopColor: "rgba(255,255,255,0.08)" },
  tabItem: {
    minHeight: 50,
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  tabContent: { alignItems: "center", justifyContent: "center" },
  profileRing: { width: 30, height: 30, borderRadius: 15, borderWidth: 1.5, borderColor: "transparent", alignItems: "center", justifyContent: "center" },
  unreadBadge: {
    position: "absolute",
    top: -5,
    right: -10,
    minWidth: 18,
    height: 18,
    borderRadius: radii.pill,
    borderWidth: 2,
    backgroundColor: colors.like,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 3,
  },
  unreadBadgeText: {
    color: "#FFFFFF",
    fontSize: 10,
    fontWeight: "700",
  },
});
