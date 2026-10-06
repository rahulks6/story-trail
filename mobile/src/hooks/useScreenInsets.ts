import { useContext } from "react";
import { BottomTabBarHeightContext } from "@react-navigation/bottom-tabs";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/**
 * Safe-area insets for screens that draw edge to edge without a native header: the status
 * bar, notch or Dynamic Island at the top, and the home indicator or Android navigation bar
 * at the bottom (Android 15+ always draws apps edge to edge). Inside the tab navigator the tab
 * bar already clears the bottom edge, so `bottom` is 0 there.
 */
export function useScreenInsets(): { top: number; bottom: number; left: number; right: number } {
  const insets = useSafeAreaInsets();
  const insideTabs = useContext(BottomTabBarHeightContext) !== undefined;
  return { top: insets.top, bottom: insideTabs ? 0 : insets.bottom, left: insets.left, right: insets.right };
}
