import { useEffect } from "react";
import { AppState, Linking, NativeModules, Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useAuth } from "./AuthContext";
import { onStoryPublished } from "./storyChanges";

/**
 * Asking for a Play Store rating, only from people who are clearly enjoying Katkee and only at a
 * good moment: a few seconds after their Story posts (after the "Story shared" moment), once they
 * have posted MIN_STORIES Stories on at least MIN_ACTIVE_DAYS different days. At most MAX_ASKS
 * times per account on a phone, at least ASK_AGAIN_AFTER_MS apart. Google's own card shows
 * (InAppReviewPackage.kt); Google may still decide not to show it, and never says whether
 * someone rated. Settings > Rate Katkee opens the Play Store page any time.
 */
export const MIN_STORIES = 3;
export const MIN_ACTIVE_DAYS = 3;
export const MAX_ASKS = 3;
export const ASK_AGAIN_AFTER_MS = 120 * 24 * 60 * 60 * 1000;
/** After the "Story shared" moment and the first-Story invite card (InviteAfterStory). */
const DELAY_MS = 4000;
export const PLAY_STORE_URL = "https://play.google.com/store/apps/details?id=com.katkee.app";

interface Saved { stories: number; days: string[]; asks: number; lastAsk: number }
const key = (userId: string) => `katkee.reviewPrompt.v1.${userId}`;
const today = (now: number) => new Date(now).toISOString().slice(0, 10);

async function load(userId: string): Promise<Saved> {
  try {
    const raw = await AsyncStorage.getItem(key(userId));
    const s = raw ? (JSON.parse(raw) as Partial<Saved>) : {};
    return {
      stories: typeof s.stories === "number" ? s.stories : 0,
      days: Array.isArray(s.days) ? s.days.filter((d): d is string => typeof d === "string") : [],
      asks: typeof s.asks === "number" ? s.asks : 0,
      lastAsk: typeof s.lastAsk === "number" ? s.lastAsk : 0,
    };
  } catch {
    return { stories: 0, days: [], asks: 0, lastAsk: 0 };
  }
}

async function save(userId: string, s: Saved): Promise<void> {
  // Only the last few days matter for MIN_ACTIVE_DAYS.
  await AsyncStorage.setItem(key(userId), JSON.stringify({ ...s, days: s.days.slice(-30) })).catch(() => undefined);
}

/** The app was used today (counted once a day). */
export async function markActiveDay(userId: string, now = Date.now()): Promise<void> {
  const s = await load(userId);
  const day = today(now);
  if (s.days.includes(day)) return;
  await save(userId, { ...s, days: [...s.days, day] });
}

/** A Story posted: counts it, and says whether this is a good moment to ask. */
export async function storyPostedShouldAsk(userId: string, now = Date.now()): Promise<boolean> {
  const s = await load(userId);
  const day = today(now);
  const next: Saved = { ...s, stories: s.stories + 1, days: s.days.includes(day) ? s.days : [...s.days, day] };
  const ask = next.stories >= MIN_STORIES && next.days.length >= MIN_ACTIVE_DAYS && next.asks < MAX_ASKS && now - next.lastAsk >= ASK_AGAIN_AFTER_MS;
  await save(userId, ask ? { ...next, asks: next.asks + 1, lastAsk: now } : next);
  return ask;
}

interface ReviewModule { requestReview(): Promise<boolean> }

/** Google Play's card over the app; nothing on a phone without Play (or on iPhone, for now). */
export async function requestInAppReview(): Promise<boolean> {
  const native = NativeModules.KatkeeInAppReview as ReviewModule | undefined;
  if (Platform.OS !== "android" || !native) return false;
  try {
    return await native.requestReview();
  } catch {
    return false;
  }
}

/** Settings > Rate Katkee: the Play Store app, or the web page without it. */
export async function openStoreListing(): Promise<void> {
  try {
    await Linking.openURL("market://details?id=com.katkee.app");
  } catch {
    await Linking.openURL(PLAY_STORE_URL).catch(() => undefined);
  }
}

/** Counts the day and listens for posted Stories, for the signed-in account. Mounted once. */
export function useReviewPrompt(): void {
  const { status, user } = useAuth();
  const userId = status === "signedIn" ? user?.id ?? null : null;
  useEffect(() => {
    if (!userId || Platform.OS !== "android") return;
    void markActiveDay(userId);
    let timer: ReturnType<typeof setTimeout> | null = null;
    const stop = onStoryPublished(() => {
      void storyPostedShouldAsk(userId).then((ask) => {
        if (!ask || timer) return;
        timer = setTimeout(() => {
          timer = null;
          if (AppState.currentState !== "active") return;
          void requestInAppReview();
        }, DELAY_MS);
      });
    });
    return () => {
      stop();
      if (timer) clearTimeout(timer);
    };
  }, [userId]);
}
