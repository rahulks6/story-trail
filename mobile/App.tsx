import React from "react";
import { StatusBar } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AuthProvider } from "./src/state/AuthContext";
import { NotificationsProvider } from "./src/state/NotificationsContext";
import { DMProvider } from "./src/state/DMContext";
import { RealtimeProvider } from "./src/state/RealtimeContext";
import { RootNavigator } from "./src/navigation/RootNavigator";
import { ErrorBoundary } from "./src/components/ErrorBoundary";
import { colorScheme } from "./src/theme/colors";

export default function App(): React.JSX.Element {
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
                <RootNavigator />
              </DMProvider>
            </NotificationsProvider>
          </RealtimeProvider>
        </AuthProvider>
      </SafeAreaProvider>
    </ErrorBoundary>
  );
}
