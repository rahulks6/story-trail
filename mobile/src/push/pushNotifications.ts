import { PermissionsAndroid, Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { registerPushDevice, unregisterPushDevice } from "../api/push";

/**
 * Push notifications through Firebase Cloud Messaging on both platforms (FCM delivers
 * to iPhones through APNs). A build without Firebase configuration (no
 * google-services.json / GoogleService-Info.plist) runs without push: every function
 * here then does nothing, and the app relies on the realtime connection while open.
 *
 * Notification text is written by the server and never contains message text; a tap
 * opens the `katkee://` link in the notification's data (conversation, Story, profile
 * or Activity).
 */
type MessagingModule = typeof import("@react-native-firebase/messaging");
type Messaging = ReturnType<MessagingModule["getMessaging"]>;
type RemoteMessage = { data?: { [key: string]: unknown } } | null | undefined;

export type PushPermission = "granted" | "denied" | "undetermined" | "unavailable";

const TOKEN_KEY = "katkee.push.device.v1";
const ASKED_KEY = "katkee.push.asked.v1";
const LINK = /^katkee:\/\/(conversation\/[0-9a-f-]{36}|story\/[0-9a-f-]{36}|user\/[a-z0-9_.]{3,30}|activity)\/?$/i;

let firebase: { mod: MessagingModule; messaging: Messaging } | null | undefined;

function messagingOrNull(): { mod: MessagingModule; messaging: Messaging } | null {
  if (firebase !== undefined) return firebase;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require("@react-native-firebase/messaging") as MessagingModule;
    firebase = { mod, messaging: mod.getMessaging() };
  } catch {
    firebase = null; // Firebase isn't configured in this build
  }
  return firebase;
}

/** Only links the app itself handles; anything else in a notification is ignored. */
export function notificationLink(message: RemoteMessage): string | null {
  const url = message?.data?.url;
  return typeof url === "string" && LINK.test(url) ? url : null;
}

const androidNeedsRuntimePermission = () => Platform.OS === "android" && Number(Platform.Version) >= 33;

export async function pushPermission(): Promise<PushPermission> {
  const fb = messagingOrNull();
  if (!fb) return "unavailable";
  try {
    if (Platform.OS === "android") {
      if (!androidNeedsRuntimePermission()) return "granted";
      if (await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS)) return "granted";
      return (await AsyncStorage.getItem(ASKED_KEY)) ? "denied" : "undetermined";
    }
    const status = await fb.mod.hasPermission(fb.messaging);
    const { AuthorizationStatus } = fb.mod;
    if (status === AuthorizationStatus.AUTHORIZED || status === AuthorizationStatus.PROVISIONAL) return "granted";
    return status === AuthorizationStatus.NOT_DETERMINED ? "undetermined" : "denied";
  } catch {
    return "unavailable";
  }
}

/** Shows the system prompt (the OS only shows it once; afterwards this reports the answer). */
export async function requestPushPermission(): Promise<boolean> {
  const fb = messagingOrNull();
  if (!fb) return false;
  try {
    await AsyncStorage.setItem(ASKED_KEY, "1");
    if (Platform.OS === "android") {
      if (!androidNeedsRuntimePermission()) return true;
      const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
      return result === PermissionsAndroid.RESULTS.GRANTED;
    }
    const status = await fb.mod.requestPermission(fb.messaging);
    return status === fb.mod.AuthorizationStatus.AUTHORIZED || status === fb.mod.AuthorizationStatus.PROVISIONAL;
  } catch {
    return false;
  }
}

/** Whether the app has already asked once (so it doesn't nag). */
export async function hasAskedForPush(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(ASKED_KEY)) !== null;
  } catch {
    return true;
  }
}

function locale(): string | undefined {
  try {
    const value = Intl.DateTimeFormat().resolvedOptions().locale;
    return /^[A-Za-z0-9-]{2,35}$/.test(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

async function sendToken(userId: string, token: string, accessToken: string): Promise<void> {
  const localeTag = locale();
  await registerPushDevice(
    { provider: "fcm", platform: Platform.OS === "ios" ? "ios" : "android", token, ...(localeTag ? { locale: localeTag } : {}) },
    accessToken,
  );
  await AsyncStorage.setItem(TOKEN_KEY, JSON.stringify({ userId, token }));
}

export type RegisterResult = "registered" | "no_permission" | "unavailable" | "failed";

/** Registers this device for the account if notifications are allowed. Never prompts. */
export async function registerForPush(userId: string, accessToken: string): Promise<RegisterResult> {
  const fb = messagingOrNull();
  if (!fb) return "unavailable";
  if ((await pushPermission()) !== "granted") return "no_permission";
  try {
    const token = await fb.mod.getToken(fb.messaging);
    if (!token) return "failed";
    await sendToken(userId, token, accessToken);
    return "registered";
  } catch {
    return "failed"; // tried again on the next launch or sign-in
  }
}

/** Keeps the server's copy of this device's token current while signed in. */
export function watchPushToken(session: () => { userId: string; accessToken: string } | null): () => void {
  const fb = messagingOrNull();
  if (!fb) return () => undefined;
  try {
    return fb.mod.onTokenRefresh(fb.messaging, (token: string) => {
      const current = session();
      if (current && token) void sendToken(current.userId, token, current.accessToken).catch(() => undefined);
    });
  } catch {
    return () => undefined;
  }
}

/**
 * Sign-out: stop this device's pushes for the account. Best effort; the server also
 * disables the device when the sign-in ends (migration 0031). Deleting the token makes
 * the old one useless to anyone, and the next account gets a fresh one.
 */
export async function unregisterForPush(accessToken: string | null): Promise<void> {
  let saved: { token?: unknown } | null = null;
  try {
    saved = JSON.parse((await AsyncStorage.getItem(TOKEN_KEY)) ?? "null") as { token?: unknown } | null;
    await AsyncStorage.removeItem(TOKEN_KEY);
  } catch {
    saved = null;
  }
  const fb = messagingOrNull();
  await Promise.allSettled([
    accessToken && typeof saved?.token === "string" ? unregisterPushDevice({ provider: "fcm", token: saved.token }, accessToken) : Promise.resolve(),
    fb ? fb.mod.deleteToken(fb.messaging) : Promise.resolve(),
  ]);
}

/** The link of the notification that launched the app, if any. */
export async function initialNotificationLink(): Promise<string | null> {
  const fb = messagingOrNull();
  if (!fb) return null;
  try {
    return notificationLink(await fb.mod.getInitialNotification(fb.messaging));
  } catch {
    return null;
  }
}

/** Calls back with the link of a notification tapped while the app was running in the background. */
export function onNotificationOpened(listener: (url: string) => void): () => void {
  const fb = messagingOrNull();
  if (!fb) return () => undefined;
  try {
    return fb.mod.onNotificationOpenedApp(fb.messaging, (message: RemoteMessage) => {
      const url = notificationLink(message);
      if (url) listener(url);
    });
  } catch {
    return () => undefined;
  }
}

/** A push that arrived while the app is open (the system shows nothing); used to refresh badges. */
export function onForegroundPush(listener: () => void): () => void {
  const fb = messagingOrNull();
  if (!fb) return () => undefined;
  try {
    return fb.mod.onMessage(fb.messaging, () => listener());
  } catch {
    return () => undefined;
  }
}

/**
 * Registered from index.js: pushes are "notification" messages the system shows by
 * itself in the background, so there is nothing to do, but Firebase expects a handler.
 */
export function registerBackgroundHandler(): void {
  const fb = messagingOrNull();
  if (!fb) return;
  try {
    fb.mod.setBackgroundMessageHandler(fb.messaging, async () => undefined);
  } catch {
    // Firebase not configured.
  }
}
