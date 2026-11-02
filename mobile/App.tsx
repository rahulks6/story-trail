import React, { useEffect, useState } from "react";
import { StatusBar } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AuthProvider } from "./src/state/AuthContext";
import { NotificationsProvider } from "./src/state/NotificationsContext";
import { DMProvider } from "./src/state/DMContext";
import { RealtimeProvider } from "./src/state/RealtimeContext";
import { RootNavigator } from "./src/navigation/RootNavigator";
import { CallProvider } from "./src/calls/CallContext";
import { ErrorBoundary } from "./src/components/ErrorBoundary";
import { ToastHost } from "./src/components/Toast";
import { colorScheme } from "./src/theme/colors";
import { initLanguage } from "./src/i18n";

export default function App(): React.JSX.Element {
  // The saved language (or the phone's) is read before the first screen, so nothing flashes in
  // English first; until then the native splash is still showing.
  const [languageReady, setLanguageReady] = useState(false);
  useEffect(() => {
    void initLanguage().finally(() => setLanguageReady(true));
  }, []);
  return (
    // ErrorBoundary is outermost so it can catch a crash even from
    // AuthProvider/the providers below it, not just from screens.
    <ErrorBoundary>
      <SafeAreaProvider>
        {/* Dark icons on light screens; Story screens switch to light icons (useMediaStatusBar). */}
        <StatusBar barStyle={colorScheme() === "light" ? "dark-content" : "light-content"} />
        <AuthProvider>
          <RealtimeProvider>
            <NotificationsProvider>
              <DMProvider>
                {/* Calls show over every screen (and the call screen over the app's own toasts). */}
                <CallProvider>
                  {languageReady ? <RootNavigator /> : null}
                  <ToastHost />
                </CallProvider>
              </DMProvider>
            </NotificationsProvider>
          </RealtimeProvider>
        </AuthProvider>
      </SafeAreaProvider>
    </ErrorBoundary>
  );
}
