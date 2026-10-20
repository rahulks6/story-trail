import { createContext, useContext } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { PublicUser } from "../api/client";

/**
 * First-run onboarding (OnboardingScreen): pick interests, follow a few people. Shown once per
 * account on this device, to anyone who hasn't chosen interests yet, so a new account doesn't
 * open on an empty feed.
 */
const doneKey = (userId: string) => `katkee.onboarding.done.v1.${userId}`;

export async function needsOnboarding(user: PublicUser): Promise<boolean> {
  if (user.interests.length > 0) return false;
  const done = await AsyncStorage.getItem(doneKey(user.id)).catch(() => null);
  return done === null;
}

export async function markOnboardingDone(userId: string): Promise<void> {
  await AsyncStorage.setItem(doneKey(userId), String(Date.now())).catch(() => undefined);
}

/** Lets the onboarding screen tell the navigator it's finished. */
export const OnboardingContext = createContext<{ finish: () => void }>({ finish: () => undefined });
export const useOnboarding = () => useContext(OnboardingContext);
export const OnboardingProvider = OnboardingContext.Provider;
