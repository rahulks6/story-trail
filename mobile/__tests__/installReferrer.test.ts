import { NativeModules, Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { checkInstallReferrer, inviteCodeFromReferrer } from "../src/state/installReferrer";
import { clearPendingInvite, pendingInvite, savePendingInvite } from "../src/state/invites";

jest.mock("../src/api/growth", () => ({ getMyInvite: jest.fn(), redeemInvite: jest.fn(), getInviter: jest.fn() }));
jest.mock("../src/analytics/analytics", () => ({ track: jest.fn() }));
jest.mock("../src/state/AuthContext", () => ({ useAuth: () => ({}) }));

const getReferrer = jest.fn<Promise<string | null>, []>();

beforeEach(async () => {
  jest.replaceProperty(Platform, "OS", "android");
  NativeModules.KatkeeInstallReferrer = { getReferrer };
  getReferrer.mockReset();
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
