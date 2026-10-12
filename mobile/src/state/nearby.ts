import { useEffect, useRef } from "react";
import { AppState, PermissionsAndroid, Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Geolocation from "@react-native-community/geolocation";
import { putMyArea } from "../api/area";
import { AREA_CELL_LENGTH, encodeGeohash } from "../utils/geohash";
import { useAuth } from "./AuthContext";

/**
 * Nearby Stories (Phase 9). Off until you turn it on. When on, the phone reads an approximate
 * location (Android asks for approximate location only; iOS for "while using"), turns it into a
 * city-sized area cell and sends only that cell: never coordinates. Your device's time zone is
 * always sent so new Stories can still come from your region. Turning it off clears the cell.
 */
export type NearbyChoice = "on" | "off";

const choiceKey = (userId: string) => `katkee.nearby.${userId}`;
const syncedKey = (userId: string) => `katkee.nearby.synced.${userId}`;
/** The area is refreshed at most this often while the app is used. */
export const AREA_REFRESH_MS = 6 * 60 * 60 * 1000;

export async function nearbyChoice(userId: string): Promise<NearbyChoice | null> {
  const value = await AsyncStorage.getItem(choiceKey(userId)).catch(() => null);
  return value === "on" || value === "off" ? value : null;
}

export async function setNearbyChoice(userId: string, choice: NearbyChoice): Promise<void> {
  await AsyncStorage.setItem(choiceKey(userId), choice).catch(() => undefined);
}

/** The device's IANA time zone, e.g. "Asia/Kolkata", or null when the runtime can't say. */
export function deviceTimeZone(): string | null {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return typeof zone === "string" && zone.length > 0 && zone.length <= 64 ? zone : null;
  } catch {
    return null;
  }
}

/** Approximate location only. `ask` false never shows a system prompt on Android. */
async function locationAllowed(ask: boolean): Promise<boolean> {
  if (Platform.OS === "android") {
    const permission = PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION;
    if (await PermissionsAndroid.check(permission)) return true;
    if (!ask) return false;
    return (await PermissionsAndroid.request(permission)) === PermissionsAndroid.RESULTS.GRANTED;
  }
  if (!ask) return true; // iOS reports a refusal through the reading itself.
  return new Promise((resolve) => {
    try {
      Geolocation.requestAuthorization(() => resolve(true), () => resolve(false));
    } catch {
      resolve(false);
    }
  });
}

type Reading = { cell: string } | { error: "denied" | "unavailable" };

/** One low-accuracy reading, turned into a cell straight away. */
function currentCell(): Promise<Reading> {
  return new Promise((resolve) => {
    try {
      Geolocation.getCurrentPosition(
        (position) => {
          try {
            resolve({ cell: encodeGeohash(position.coords.latitude, position.coords.longitude, AREA_CELL_LENGTH) });
          } catch {
            resolve({ error: "unavailable" });
          }
        },
        (error) => resolve({ error: error?.code === 1 ? "denied" : "unavailable" }),
        { enableHighAccuracy: false, timeout: 15_000, maximumAge: 30 * 60 * 1000 },
      );
    } catch {
      resolve({ error: "unavailable" });
    }
  });
}

/** Turns Nearby Stories on: asks for approximate location, then sends the area cell. */
export async function turnNearbyOn(userId: string, accessToken: string): Promise<"on" | "denied" | "unavailable"> {
  if (!(await locationAllowed(true))) return "denied";
  const reading = await currentCell();
  if ("error" in reading) return reading.error;
  const zone = deviceTimeZone();
  await putMyArea(zone ? { cell: reading.cell, timeZone: zone } : { cell: reading.cell }, accessToken);
  await setNearbyChoice(userId, "on");
  await AsyncStorage.setItem(syncedKey(userId), String(Date.now())).catch(() => undefined);
  return "on";
}

/** Turns Nearby Stories off and clears the area cell on the server. */
export async function turnNearbyOff(userId: string, accessToken: string): Promise<void> {
  await putMyArea({ cell: null }, accessToken);
  await setNearbyChoice(userId, "off");
}

/** Records "Not now" so the invitation isn't shown again; nothing is sent. */
export async function declineNearby(userId: string): Promise<void> {
  await setNearbyChoice(userId, "off");
}

const inFlight = new Map<string, Promise<void>>();

/**
 * Keeps the server's copy current, at most every few hours: always the time zone, and the cell
 * only while Nearby Stories is on and location is still allowed. If location was switched off
 * in the system settings, the stored cell is cleared rather than left to go stale.
 */
export function syncArea(userId: string, accessToken: string, options: { force?: boolean; now?: number } = {}): Promise<void> {
  const running = inFlight.get(userId);
  if (running) return running;
  const run = (async () => {
    const now = options.now ?? Date.now();
    if (!options.force) {
      const last = Number(await AsyncStorage.getItem(syncedKey(userId)).catch(() => null));
      if (last > 0 && now - last < AREA_REFRESH_MS) return;
    }
    const body: { cell?: string | null; timeZone?: string } = {};
    const zone = deviceTimeZone();
    if (zone) body.timeZone = zone;
    const choice = await nearbyChoice(userId);
    if (choice === "off") body.cell = null;
    if (choice === "on") {
      if (!(await locationAllowed(false))) body.cell = null;
      else {
        const reading = await currentCell();
        if ("cell" in reading) body.cell = reading.cell;
        else if (reading.error === "denied") body.cell = null;
      }
    }
    if (Object.keys(body).length === 0) return;
    await putMyArea(body, accessToken);
    await AsyncStorage.setItem(syncedKey(userId), String(now)).catch(() => undefined);
  })().finally(() => inFlight.delete(userId));
  inFlight.set(userId, run);
  return run;
}

/** While signed in: refreshes the area on sign-in and whenever the app comes back to the front. */
export function useAreaSync(): void {
  const { status, user, accessToken } = useAuth();
  const tokenRef = useRef(accessToken);
  tokenRef.current = accessToken;
  const userId = status === "signedIn" ? user?.id ?? null : null;

  useEffect(() => {
    if (!userId) return;
    const run = () => {
      const token = tokenRef.current;
      if (token) void syncArea(userId, token).catch(() => undefined);
    };
    run();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") run();
    });
    return () => subscription.remove();
  }, [userId]);
}
