import { useEffect, useState } from "react";
import { Alert, Linking, Platform, Share } from "react-native";
import RNShare, { Social } from "react-native-share";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { ApiError } from "../api/client";
import { getInviter, getMyInvite, redeemInvite, type Inviter } from "../api/growth";
import { track } from "../analytics/analytics";
import { useAuth } from "./AuthContext";
import { t } from "../i18n";
import { contactHash } from "../utils/contactHashes";

/**
 * Invite friends. Everyone's link is https://katkee.com/i/<code> (backend growth/invites.ts).
 *
 * Who joined from whose link is worked out from the link itself, not from the app store: there is
 * no attribution SDK and no fingerprinting. Opening an invite link in the app (an App Link, or
 * "Open invite in Katkee" on the website after installing) keeps the code on this phone until
 * someone signs in, then redeems it once. The server credits only a brand-new account.
 */

/** Where Invite friends was tapped: the server's allowed values for invite_shared. */
export type InviteSource = "settings" | "home" | "search" | "messages" | "onboarding" | "contacts" | "after_story" | "contest";

const PENDING_KEY = "katkee.invite.pending.v1";
/** An invite opened and never followed by a sign-up is forgotten after this long. */
export const PENDING_INVITE_TTL_MS = 30 * 24 * 3600 * 1000;

/** The text that goes with the link; the link itself carries the code. */
export function inviteMessage(url: string): string {
  return t("invites.joinMeOnKatkeeFor", { url });
}

let cached: { userId: string; url: string } | null = null;

/** The person's own invite link (made on first use, then remembered). Throws when offline. */
export async function myInviteUrl(accessToken: string, userId?: string | null): Promise<string> {
  if (cached && cached.userId === userId) return cached.url;
  const url = (await getMyInvite(accessToken)).invite.url;
  if (userId) cached = { userId, url };
  return url;
}

/**
 * Straight to WhatsApp (a chat, a group or your status) with `message`; the system share sheet
 * when WhatsApp isn't there. True when something was shared.
 */
export async function shareTextToWhatsApp(message: string): Promise<boolean> {
  try {
    await RNShare.shareSingle({ social: Social.Whatsapp, message });
    return true;
  } catch {
    try {
      const result = await Share.share({ message });
      return result.action !== Share.dismissedAction;
    } catch {
      return false;
    }
  }
}

/**
 * Opens the share sheet with the person's own invite link (made on first use). Errors are shown,
 * not thrown: every caller is a button.
 */
export async function shareInvite(from: InviteSource, accessToken: string | null, userId?: string | null): Promise<void> {
  if (!accessToken) return;
  let url: string;
  try {
    url = await myInviteUrl(accessToken, userId);
  } catch {
    Alert.alert(t("invites.couldntGetYourInviteLink"), t("invites.checkYourConnectionAndTry"));
    return;
  }
  try {
    const result = await Share.share({ message: inviteMessage(url) });
    // Android reports every share as shared; iPhone says when the sheet was closed instead.
    if (result.action !== Share.dismissedAction) track("invite_shared", { from });
  } catch {
    // The share sheet closing with an error is nothing to report.
  }
}

/** Contacts already sent an invite, as hashes of their numbers, kept only on the phone. */
const invitedKey = (userId: string) => `katkee.contactInvites.v1.${userId}`;

export async function invitedContacts(userId: string): Promise<Set<string>> {
  try {
    const raw = await AsyncStorage.getItem(invitedKey(userId));
    const list: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(list) ? list.filter((h): h is string => typeof h === "string") : []);
  } catch {
    return new Set();
  }
}

/** The key invitedContacts() uses for a number (E.164). */
export function invitedId(phone: string): string {
  return contactHash("phone", phone);
}

/**
 * Sends the person's invite to one contact (`phone` in E.164): a WhatsApp chat with them, the
 * text already written, or a text message when WhatsApp isn't there, or the share sheet when
 * neither opens. The number goes only to the app that sends it, never to Katkee's servers. True
 * when something opened.
 */
export async function inviteContact(phone: string, accessToken: string | null, userId?: string | null): Promise<boolean> {
  if (!accessToken) return false;
  let url: string;
  try {
    url = await myInviteUrl(accessToken, userId);
  } catch {
    Alert.alert(t("invites.couldntGetYourInviteLink"), t("invites.checkYourConnectionAndTry"));
    return false;
  }
  const text = encodeURIComponent(inviteMessage(url));
  const targets = [
    `whatsapp://send?phone=${phone.slice(1)}&text=${text}`,
    // iPhone's Messages reads the body after "&", Android's after "?".
    `sms:${phone}${Platform.OS === "ios" ? "&" : "?"}body=${text}`,
  ];
  let opened = false;
  for (const target of targets) {
    try {
      await Linking.openURL(target);
      opened = true;
      break;
    } catch {
      // Not installed: try the next way.
    }
  }
  if (!opened) {
    try {
      const result = await Share.share({ message: inviteMessage(url) });
      opened = result.action !== Share.dismissedAction;
    } catch {
      return false;
    }
  }
  if (!opened) return false;
  track("invite_shared", { from: "contacts" });
  if (userId) {
    const invited = await invitedContacts(userId);
    invited.add(invitedId(phone));
    await AsyncStorage.setItem(invitedKey(userId), JSON.stringify([...invited].slice(-2000))).catch(() => undefined);
  }
  return true;
}

/** The code just opened, before storage has it: Sign up can show "Invited by" straight away. */
let justOpened: string | null = null;

/** Kept until someone signs in (or a month passes). */
export async function savePendingInvite(code: string): Promise<void> {
  justOpened = code;
  await AsyncStorage.setItem(PENDING_KEY, JSON.stringify({ code, savedAt: Date.now() })).catch(() => undefined);
}

export async function pendingInvite(now = Date.now()): Promise<string | null> {
  if (justOpened) return justOpened;
  try {
    const raw = await AsyncStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw) as { code?: unknown; savedAt?: unknown };
    if (typeof saved.code !== "string" || typeof saved.savedAt !== "number" || now - saved.savedAt > PENDING_INVITE_TTL_MS) {
      await AsyncStorage.removeItem(PENDING_KEY);
      return null;
    }
    return saved.code;
  } catch {
    return null;
  }
}

export async function clearPendingInvite(): Promise<void> {
  justOpened = null;
  await AsyncStorage.removeItem(PENDING_KEY).catch(() => undefined);
}

/**
 * Redeems a kept invite once someone is signed in. Any answer from the server (credited, too old,
 * already credited, a link that doesn't work) settles it; only a network failure keeps it for the
 * next sign-in. Nothing is shown: the inviter turns up first in People to follow.
 */
export async function redeemPendingInvite(accessToken: string): Promise<void> {
  const code = await pendingInvite();
  if (!code) return;
  try {
    await redeemInvite(code, accessToken);
    await clearPendingInvite();
    // Opened before there was an account (nothing is tracked while signed out), counted now.
    track("invite_link_opened", { signedIn: false });
  } catch (error) {
    if (error instanceof ApiError && error.status < 500 && error.status !== 429) await clearPendingInvite();
  }
}

export function useInviteRedemption(): void {
  const { status, accessToken, user } = useAuth();
  const signedIn = status === "signedIn" && !!accessToken;
  useEffect(() => {
    if (signedIn && accessToken) void redeemPendingInvite(accessToken);
    // Once per account signing in; a refreshed token isn't a new chance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn, user?.id]);
}

/** Whose invite is waiting on this phone, for Sign up's "Invited by" line; null when none. */
export function usePendingInviter(): Inviter | null {
  const [inviter, setInviter] = useState<Inviter | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void pendingInvite().then((code) => {
      if (!code || controller.signal.aborted) return;
      getInviter(code, controller.signal).then(({ inviter: found }) => setInviter(found)).catch(() => undefined);
    });
    return () => controller.abort();
  }, []);
  return inviter;
}
