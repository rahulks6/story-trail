import { NativeModules, Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { pendingInvite, savePendingInvite } from "./invites";

/**
 * A friend who installs Katkee from an invite page's Google Play button is credited to that
 * invite, without coming back to tap the link. The button's Play link carries
 * `referrer=katkee_invite%3D<code>` (backend website.routes.ts playLinkWithInvite), and Google Play
 * hands that to the app after installing (InstallReferrerPackage.kt). It's read once, on the first
 * launch, and kept like an opened invite link until someone signs up (state/invites.ts).
 */
const CHECKED_KEY = "katkee.installReferrer.checked.v1";
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

interface ReferrerModule {
  getReferrer(): Promise<string | null>;
}

/** Once per install, on Android: keeps the invite a Play install came from, unless one is already waiting. */
export async function checkInstallReferrer(): Promise<void> {
  const native = NativeModules.KatkeeInstallReferrer as ReferrerModule | undefined;
  if (Platform.OS !== "android" || !native) return;
  try {
    if (await AsyncStorage.getItem(CHECKED_KEY)) return;
    const referrer = await native.getReferrer().catch(() => null);
    await AsyncStorage.setItem(CHECKED_KEY, "1");
    const code = inviteCodeFromReferrer(referrer);
    if (code && !(await pendingInvite())) await savePendingInvite(code);
  } catch {
    // Storage unavailable: try again next launch.
  }
}
