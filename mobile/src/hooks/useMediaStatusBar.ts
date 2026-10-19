import { useContext, useEffect } from "react";
import { StatusBar } from "react-native";
import { NavigationContext } from "@react-navigation/native";

/**
 * Story, camera and editor screens are always dark: while one is showing, the status bar's clock
 * and icons are light, even when the app is in light mode.
 */
export function useMediaStatusBar(): void {
  const navigation = useContext(NavigationContext);
  useEffect(() => {
    let entry: ReturnType<typeof StatusBar.pushStackEntry> | null = null;
    const show = () => { if (!entry) entry = StatusBar.pushStackEntry({ barStyle: "light-content", animated: true }); };
    const hide = () => { if (entry) { StatusBar.popStackEntry(entry); entry = null; } };
    if (!navigation || navigation.isFocused()) show();
    const offFocus = navigation?.addListener("focus", show);
    const offBlur = navigation?.addListener("blur", hide);
    return () => { offFocus?.(); offBlur?.(); hide(); };
  }, [navigation]);
}
