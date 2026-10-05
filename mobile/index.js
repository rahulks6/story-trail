/**
 * @format
 */
import { AppRegistry } from "react-native";
import App from "./App";
import { name as appName } from "./app.json";
import { registerBackgroundHandler } from "./src/push/pushNotifications";

// Before the app component: Firebase delivers background pushes to this handler.
registerBackgroundHandler();
AppRegistry.registerComponent(appName, () => App);
