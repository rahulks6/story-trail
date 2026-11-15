import { useEffect, useRef } from "react";
import { AppState } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getCrossedPaths, postCrossedVisit, putCrossedPaths } from "../api/crossedPaths";
import { currentCell, locationAllowed } from "./nearby";
import { useAuth } from "./AuthContext";

/**
 * Crossed paths (backend modules/crossed-paths). Off until you turn it on. While on, each time the
 * app comes to the front (at most every half hour) it reads approximate location and sends only a
 * neighbourhood-sized cell, about 5 x 5 km: never coordinates, and nothing in the background.
 * Turning it off forgets your visits on the server.
 */
export const CROSSED_CELL_LENGTH = 5;
export const CROSSED_VISIT_EVERY_MS = 30 * 60 * 1000;
const choiceKey = (userId: string) => `katkee.crossedPaths.${userId}`;
const sentKey = (userId: string) => `katkee.crossedPaths.sent.${userId}`;

export async function crossedPathsOn(userId: string): Promise<boolean> {
  return (await AsyncStorage.getItem(choiceKey(userId)).catch(() => null)) === "on";
}

async function remember(userId: string, on: boolean): Promise<void> {
  await AsyncStorage.setItem(choiceKey(userId), on ? "on" : "off").catch(() => undefined);
}

/** Sends where you are now, roughly, if Crossed paths is on and location is still allowed. */
export async function sendCrossedVisit(userId: string, accessToken: string, options: { force?: boolean; now?: number } = {}): Promise<boolean> {
  if (!(await crossedPathsOn(userId))) return false;
  const now = options.now ?? Date.now();
  if (!options.force) {
    const last = Number(await AsyncStorage.getItem(sentKey(userId)).catch(() => null));
    if (last > 0 && now - last < CROSSED_VISIT_EVERY_MS) return false;
  }
  if (!(await locationAllowed(false))) return false;
  const reading = await currentCell(CROSSED_CELL_LENGTH);
  if (!("cell" in reading)) return false;
  await postCrossedVisit(reading.cell, accessToken);
  await AsyncStorage.setItem(sentKey(userId), String(now)).catch(() => undefined);
  return true;
}

/** Turns it on: approximate location first, then the setting, then the first visit. */
export async function turnCrossedPathsOn(userId: string, accessToken: string): Promise<"on" | "denied"> {
  if (!(await locationAllowed(true))) return "denied";
  await putCrossedPaths(true, accessToken);
  await remember(userId, true);
  await sendCrossedVisit(userId, accessToken, { force: true }).catch(() => false);
  return "on";
}

export async function turnCrossedPathsOff(userId: string, accessToken: string): Promise<void> {
  await putCrossedPaths(false, accessToken);
  await remember(userId, false);
}

/** While signed in: learns the setting from the server once, then sends a visit when the app opens. */
export function useCrossedPathsSync(): void {
  const { status, user, accessToken } = useAuth();
  const tokenRef = useRef(accessToken);
  tokenRef.current = accessToken;
  const userId = status === "signedIn" ? user?.id ?? null : null;
  useEffect(() => {
    if (!userId) return;
    let alive = true;
    const run = () => {
      const token = tokenRef.current;
      if (token) void sendCrossedVisit(userId, token).catch(() => false);
    };
    const token = tokenRef.current;
    if (token) {
      void getCrossedPaths(token)
        .then(({ enabled }) => remember(userId, enabled))
        .catch(() => undefined)
        .finally(() => { if (alive) run(); });
    }
    const subscription = AppState.addEventListener("change", (state) => { if (state === "active") run(); });
    return () => { alive = false; subscription.remove(); };
  }, [userId]);
}
