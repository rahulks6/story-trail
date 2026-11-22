import { NativeModules, Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { checkInstallReferrer, installSourceFromReferrer, inviteCodeFromReferrer, reportInstallSource } from "../src/state/installReferrer";
import { analyticsActive, track } from "../src/analytics/analytics";
import { clearPendingInvite, pendingInvite, savePendingInvite } from "../src/state/invites";

jest.mock("../src/api/growth", () => ({ getMyInvite: jest.fn(), redeemInvite: jest.fn(), getInviter: jest.fn() }));
jest.mock("../src/analytics/analytics", () => ({ track: jest.fn(), analyticsActive: jest.fn(() => false) }));
jest.mock("../src/state/AuthContext", () => ({ useAuth: () => ({}) }));

const getReferrer = jest.fn<Promise<string | null>, []>();

beforeEach(async () => {
  jest.replaceProperty(Platform, "OS", "android");
  NativeModules.KatkeeInstallReferrer = { getReferrer };
  getReferrer.mockReset();
  (track as jest.Mock).mockClear();
  (analyticsActive as jest.Mock).mockReturnValue(false);
  await AsyncStorage.clear();
  await clearPendingInvite();
});

test("reads the invite code from a Play install referrer, and nothing else", () => {
  expect(inviteCodeFromReferrer("katkee_invite=abcd2345")).toBe("abcd2345");
  expect(inviteCodeFromReferrer("utm_source=x&katkee_invite=ABCD2345")).toBe("abcd2345");
  expect(inviteCodeFromReferrer("katkee_invite%3Dabcd2345")).toBeNull();
  expect(inviteCodeFromReferrer("utm_source=google-play&utm_medium=organic")).toBeNull();
  expect(inviteCodeFromReferrer("katkee_invite=abc")).toBeNull();
  expect(inviteCodeFromReferrer("katkee_invite=%E0%A4")).toBeNull();
  expect(inviteCodeFromReferrer(null)).toBeNull();
});

test("an install from an invite's Play button keeps that invite for sign-up, once", async () => {
  getReferrer.mockResolvedValue("katkee_invite=abcd2345");
  await checkInstallReferrer();
  expect(await pendingInvite()).toBe("abcd2345");
  await clearPendingInvite();
  await checkInstallReferrer();
  expect(getReferrer).toHaveBeenCalledTimes(1);
  expect(await pendingInvite()).toBeNull();
});

test("an invite link already opened wins over the install referrer", async () => {
  await savePendingInvite("zzzz2345");
  getReferrer.mockResolvedValue("katkee_invite=abcd2345");
  await checkInstallReferrer();
  expect(await pendingInvite()).toBe("zzzz2345");
});

test("an ordinary install, or no Play Store, keeps nothing", async () => {
  getReferrer.mockRejectedValue(new Error("no Play"));
  await checkInstallReferrer();
  expect(await pendingInvite()).toBeNull();
});

test("tells a Google ads install from an invite, the Play Store and anything else", () => {
  expect(installSourceFromReferrer("gclid=Cj0KCQ123&utm_source=google")).toBe("google_ads");
  expect(installSourceFromReferrer("gbraid=0AAAA&utm_medium=cpc")).toBe("google_ads");
  expect(installSourceFromReferrer("utm_source=google&utm_medium=cpc")).toBe("google_ads");
  expect(installSourceFromReferrer("katkee_invite=abcd2345")).toBe("invite");
  expect(installSourceFromReferrer("utm_source=google-play&utm_medium=organic")).toBe("play_organic");
  expect(installSourceFromReferrer("utm_source=instagram&utm_medium=bio")).toBe("play_other");
  expect(installSourceFromReferrer("utm_source%3Dmeta%26utm_medium%3Dpaid_social".replace(/%3D/g, "=").replace(/%26/g, "&"))).toBe("meta_ads");
  expect(installSourceFromReferrer("utm_source=instagram&utm_medium=paid")).toBe("meta_ads");
  expect(installSourceFromReferrer("")).toBe("unknown");
  expect(installSourceFromReferrer(null)).toBe("unknown");
});

test("an install's source is counted once, when someone is signed in, and never the referrer", async () => {
  getReferrer.mockResolvedValue("gclid=Cj0KCQsecret&utm_source=google");
  await checkInstallReferrer();
  expect(track).not.toHaveBeenCalled(); // nobody signed in yet
  (analyticsActive as jest.Mock).mockReturnValue(true);
  await reportInstallSource();
  await reportInstallSource();
  expect(track).toHaveBeenCalledTimes(1);
  expect(track).toHaveBeenCalledWith("install_source", { source: "google_ads" });
});

test("an app updated from before this was added has no source to count", async () => {
  await AsyncStorage.setItem("katkee.installReferrer.checked.v1", "1");
  (analyticsActive as jest.Mock).mockReturnValue(true);
  await checkInstallReferrer();
  await reportInstallSource();
  expect(getReferrer).not.toHaveBeenCalled();
  expect(track).not.toHaveBeenCalled();
});
