/**
 * @format
 */
import { AppRegistry, Platform } from "react-native";
import App from "./App";
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
AppRegistry.registerComponent(appName, () => App);
