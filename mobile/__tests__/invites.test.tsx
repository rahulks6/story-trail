import React from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { Share, Text } from "react-native";
import { deepLinkTarget, linkPath, opensInApp } from "../src/navigation/profileLinks";
import { clearPendingInvite, inviteMessage, pendingInvite, PENDING_INVITE_TTL_MS, redeemPendingInvite, savePendingInvite, shareInvite } from "../src/state/invites";
import { InviteLinkScreen } from "../src/screens/profile/InviteLinkScreen";
import { suggestionReasonText } from "../src/screens/search/SearchScreen";
import * as growthApi from "../src/api/growth";
import { ApiError } from "../src/api/client";
import { track } from "../src/analytics/analytics";

jest.mock("../src/state/AuthContext", () => ({ useAuth: () => ({ user: { id: "me" }, accessToken: "token", status: "signedIn" }) }));
jest.mock("../src/api/growth", () => ({ getMyInvite: jest.fn(), redeemInvite: jest.fn(), getInviter: jest.fn(), matchContacts: jest.fn() }));
jest.mock("../src/api/users", () => ({ followUser: jest.fn(async () => ({ status: "following" })) }));
jest.mock("../src/analytics/analytics", () => ({ track: jest.fn() }));
jest.mock("../src/components/Avatar", () => ({ Avatar: () => null }));
const growth = growthApi as jest.Mocked<typeof growthApi>;
const settle = async () => { for (let i = 0; i < 6; i++) await act(async () => { await Promise.resolve(); }); };

beforeEach(async () => {
  jest.clearAllMocks();
  await clearPendingInvite();
  await AsyncStorage.clear();
});

describe("invite links", () => {
  test("katkee.com/i/<code> and katkee://invite/<code> open the app; anything else in /i/ doesn't", () => {
    expect(deepLinkTarget(linkPath("https://katkee.com/i/abcd2345")!)).toEqual({ kind: "invite", code: "abcd2345" });
    expect(deepLinkTarget(linkPath("https://katkee.com/i/ABCD2345/")!)).toEqual({ kind: "invite", code: "abcd2345" });
    expect(deepLinkTarget("invite/abcd2345")).toEqual({ kind: "invite", code: "abcd2345" });
    expect(opensInApp("https://katkee.com/i/abcd2345")).toBe(true);
    expect(opensInApp("katkee://invite/abcd2345")).toBe(true);
    // Look-alike characters (0, o, 1, l, i) are never in a code, and the length is exact.
    for (const bad of ["i/abcd234o", "i/abc", "i/abcd23456", "i/abcd2345/x", "i/"]) expect(deepLinkTarget(bad)).toBeNull();
    expect(opensInApp("https://katkee.com.evil.example/i/abcd2345")).toBe(false);
  });

  test("Invite friends shares your own link and counts where it was tapped", async () => {
    growth.getMyInvite.mockResolvedValue({ invite: { code: "abcd2345", url: "https://katkee.com/i/abcd2345", joinedCount: 0 } });
    const share = jest.spyOn(Share, "share").mockResolvedValue({ action: Share.sharedAction, activityType: undefined });
    await shareInvite("settings", "token", "me-1");
    expect(share).toHaveBeenCalledWith({ message: inviteMessage("https://katkee.com/i/abcd2345") });
    expect(inviteMessage("https://katkee.com/i/abcd2345")).toContain("https://katkee.com/i/abcd2345");
    expect(track).toHaveBeenCalledWith("invite_shared", { from: "settings" });
    // The link is fetched once per person; closing the sheet isn't counted as a share.
    share.mockResolvedValueOnce({ action: Share.dismissedAction, activityType: undefined });
    await shareInvite("home", "token", "me-1");
    expect(growth.getMyInvite).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledTimes(1);
    share.mockRestore();
  });

  test("an invite opened before signing up is redeemed once, after sign-in", async () => {
    await savePendingInvite("abcd2345");
    expect(await pendingInvite()).toBe("abcd2345");
    growth.redeemInvite.mockResolvedValueOnce({ status: "redeemed", inviter: { username: "asha", displayName: "Asha", verified: false } });
    await redeemPendingInvite("token");
    expect(growth.redeemInvite).toHaveBeenCalledWith("abcd2345", "token");
    expect(track).toHaveBeenCalledWith("invite_link_opened", { signedIn: false });
    expect(await pendingInvite()).toBeNull();
    await redeemPendingInvite("token");
    expect(growth.redeemInvite).toHaveBeenCalledTimes(1);
  });

  test("offline keeps the invite for later; a link that doesn't work is dropped", async () => {
    await savePendingInvite("abcd2345");
    growth.redeemInvite.mockRejectedValueOnce(new TypeError("Network request failed"));
    await redeemPendingInvite("token");
    expect(await pendingInvite()).toBe("abcd2345");
    growth.redeemInvite.mockRejectedValueOnce(new ApiError(404, "This invite link isn't valid."));
    await redeemPendingInvite("token");
    expect(await pendingInvite()).toBeNull();
  });

  test("a kept invite is forgotten after a month", async () => {
    await AsyncStorage.setItem("katkee.invite.pending.v1", JSON.stringify({ code: "abcd2345", savedAt: Date.now() - PENDING_INVITE_TTL_MS - 1 }));
    expect(await pendingInvite()).toBeNull();
  });

  test("suggestions say why: invited you, or joined from your invite", () => {
    expect(suggestionReasonText({ kind: "invited_you" })).toBe("Invited you to Katkee");
    expect(suggestionReasonText({ kind: "joined_from_your_invite" })).toBe("Joined from your invite");
  });
});

describe("opening an invite in the app", () => {
  let tree: ReactTestRenderer;
  const texts = () => tree.root.findAllByType(Text).map((t) => [t.props.children].flat().join(""));
  const pressable = (label: string) => tree.root.find((n: ReactTestInstance) => typeof n.props.onPress === "function" && n.props.accessibilityLabel === label);
  const navigation = { goBack: jest.fn(), canGoBack: () => true, replace: jest.fn() };
  const open = async () => {
    await act(async () => {
      tree = create(<InviteLinkScreen navigation={navigation as never} route={{ key: "k", name: "InviteLink", params: { code: "abcd2345" } }} />);
    });
    await settle();
  };
  afterEach(async () => { await act(async () => tree.unmount()); });

  test("a new account is credited and meets the inviter, with Follow", async () => {
    growth.redeemInvite.mockResolvedValueOnce({ status: "redeemed", inviter: { username: "asha", displayName: "Asha", verified: false } });
    await open();
    expect(track).toHaveBeenCalledWith("invite_link_opened", { signedIn: true });
    expect(texts()).toContain("You joined from Asha's invite. We've let them know.");
    await act(async () => pressable("Follow @asha").props.onPress());
    await settle();
    expect(pressable("Following")).toBeTruthy();
  });

  test("an older account just sees who invited them", async () => {
    growth.redeemInvite.mockResolvedValueOnce({ status: "not_new", inviter: { username: "asha", displayName: "Asha", verified: false } });
    await open();
    expect(texts()).toContain("Asha invited you to Katkee.");
  });

  test("a link that doesn't work says so", async () => {
    growth.redeemInvite.mockRejectedValueOnce(new ApiError(404, "This invite link isn't valid."));
    await open();
    expect(texts()).toContain("This invite link doesn't work");
  });
});
