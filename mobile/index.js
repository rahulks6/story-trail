/**
 * @format
 */
import React, { useEffect, useState } from "react";
import { AppRegistry, Platform, View } from "react-native";
import { loadAppearance } from "./src/theme/appearance";
import { name as appName } from "./app.json";
import { registerBackgroundHandler } from "./src/push/pushNotifications";
import { installCrashReporting } from "./src/crashReporting";
import { setClientPlatform } from "./src/api/client";

// Before the app component: Firebase delivers background pushes to this handler.
registerBackgroundHandler();
// Fatal JavaScript errors are counted on the next launch (crash-free sessions).
installCrashReporting();
// Lets the server count daily active people per platform.
setClientPlatform(Platform.OS === "ios" ? "ios" : Platform.OS === "android" ? "android" : "web");
/**
 * The light or dark colours are chosen before any screen's styles are created: the app itself
 * is loaded only once the saved choice has been read (a few milliseconds).
 */
function Root() {
  const [App, setApp] = useState(null);
  useEffect(() => {
    void loadAppearance().then(() => setApp(() => require("./App").default));
  }, []);
  return App ? React.createElement(App) : React.createElement(View, { style: { flex: 1, backgroundColor: "#0B0B0B" } });
}

AppRegistry.registerComponent(appName, () => Root);
