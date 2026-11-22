import { NativeModules, Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { pendingInvite, savePendingInvite } from "./invites";
import { analyticsActive, track } from "../analytics/analytics";

/**
 * A friend who installs Katkee from an invite page's Google Play button is credited to that
 * invite, without coming back to tap the link. The button's Play link carries
 * `referrer=katkee_invite%3D<code>` (backend website.routes.ts playLinkWithInvite), and Google Play
 * hands that to the app after installing (InstallReferrerPackage.kt). It's read once, on the first
 * launch, and kept like an opened invite link until someone signs up (state/invites.ts).
 */
const CHECKED_KEY = "katkee.installReferrer.checked.v1";
/** Where this install came from (installSourceFromReferrer), until it's been counted once. */
const SOURCE_KEY = "katkee.installReferrer.source.v1";
const REPORTED_KEY = "katkee.installReferrer.reported.v1";
const CODE_RE = /^[2-9a-hjkmnp-z]{8}$/;

/** The invite code in a Play install referrer, or null (an ordinary install, or anything else). */
export function inviteCodeFromReferrer(referrer: string | null | undefined): string | null {
  if (!referrer) return null;
  for (const part of referrer.split("&")) {
    const [key, value = ""] = part.split("=");
    if (key !== "katkee_invite") continue;
    let code: string;
    try {
      code = decodeURIComponent(value).trim().toLowerCase();
    } catch {
      return null;
    }
    return CODE_RE.test(code) ? code : null;
  }
  return null;
}

export type InstallSource = "google_ads" | "meta_ads" | "invite" | "play_organic" | "play_other" | "unknown";

/**
 * Where an install came from, in broad strokes only: a Google Ads click (Play passes the click id
 * as gclid, gbraid or wbraid), a Katkee ad on Facebook or Instagram (its Play link says
 * utm_source=meta, brand/ads/META_ADS.md), a Katkee invite, an ordinary Play Store visit, some other campaign
 * link, or not known. Never the referrer itself or the click id.
 */
export function installSourceFromReferrer(referrer: string | null | undefined): InstallSource {
  if (!referrer) return "unknown";
  if (inviteCodeFromReferrer(referrer)) return "invite";
  const params = new Map<string, string>();
  for (const part of referrer.split("&")) {
    const [key = "", value = ""] = part.split("=");
    let decoded = value;
    try { decoded = decodeURIComponent(value); } catch { /* keep as is */ }
    params.set(key.trim().toLowerCase(), decoded.trim().toLowerCase());
  }
  if (["gclid", "gbraid", "wbraid"].some((k) => params.get(k))) return "google_ads";
  const medium = params.get("utm_medium");
  const source = params.get("utm_source") ?? "";
  // Paid links only: an unpaid link from an Instagram bio stays "another link".
  if (source === "meta" || (["facebook", "fb", "instagram", "ig"].includes(source) && medium && ["paid", "paid_social", "cpc", "ppc"].includes(medium))) return "meta_ads";
  if (medium && ["cpc", "ppc", "paid"].includes(medium)) return "google_ads";
  if (medium === "organic" || (params.get("utm_source") === "google-play" && !medium)) return "play_organic";
  return params.size ? "play_other" : "unknown";
}

/** Counts this install's source once, the first time someone is signed in on the phone. */
export async function reportInstallSource(): Promise<void> {
  try {
    if (!analyticsActive()) return;
    const source = await AsyncStorage.getItem(SOURCE_KEY);
    if (!source || (await AsyncStorage.getItem(REPORTED_KEY))) return;
    if (!analyticsActive()) return;
    await AsyncStorage.setItem(REPORTED_KEY, "1");
    track("install_source", { source });
  } catch {
    // Storage unavailable: try again next sign-in.
  }
}

interface ReferrerModule {
  getReferrer(): Promise<string | null>;
}

/**
 * Once per install, on Android: keeps the invite a Play install came from, unless one is already
 * waiting, and notes where the install came from (counted once someone signs in).
 */
export async function checkInstallReferrer(): Promise<void> {
  const native = NativeModules.KatkeeInstallReferrer as ReferrerModule | undefined;
  if (Platform.OS !== "android" || !native) return;
  try {
    if (await AsyncStorage.getItem(CHECKED_KEY)) return;
    const referrer = await native.getReferrer().catch(() => null);
    await AsyncStorage.setItem(SOURCE_KEY, installSourceFromReferrer(referrer));
    await AsyncStorage.setItem(CHECKED_KEY, "1");
    void reportInstallSource();
    const code = inviteCodeFromReferrer(referrer);
    if (code && !(await pendingInvite())) await savePendingInvite(code);
  } catch {
    // Storage unavailable: try again next launch.
  }
}
