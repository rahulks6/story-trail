import { useContext } from "react";
import { BottomTabBarHeightContext } from "@react-navigation/bottom-tabs";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/**
 * Safe-area insets for screens that draw edge to edge without a native header: the status
 * bar, notch or Dynamic Island at the top, and the home indicator or Android navigation bar
 * at the bottom (Android 15+ always draws apps edge to edge). Where the tab bar shows, it
 * already clears the bottom edge, so `bottom` is 0 there; where it hides (the camera, the
 * Story editor, a chat) the screen clears it itself.
 */
export function useScreenInsets(): { top: number; bottom: number; left: number; right: number } {
  const insets = useSafeAreaInsets();
  const tabBarHeight = useContext(BottomTabBarHeightContext);
  const tabBarShown = tabBarHeight !== undefined && tabBarHeight > 0;
  return { top: insets.top, bottom: tabBarShown ? 0 : insets.bottom, left: insets.left, right: insets.right };
}
