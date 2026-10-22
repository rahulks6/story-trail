// Shared profiles and Stories are katkee.com links (the app where it's installed, the website's
// "Open in Katkee" page elsewhere); the links older versions shared, and the app's own katkee://
// links, keep working.
import React from "react";
import { Share } from "react-native";
import { act, create } from "react-test-renderer";
import Clipboard from "@react-native-clipboard/clipboard";
import { ShareSheet } from "../src/components/ShareSheet";
import { ActionSheet } from "../src/components/ActionSheet";
import { deepLinkTarget, linkPath, LINK_PREFIXES, profileShareLink, storyShareLink } from "../src/navigation/profileLinks";

jest.mock("../src/state/AuthContext", () => ({ useAuth: () => ({ accessToken: "token" }) }));
jest.mock("../src/api/engagement", () => ({ shareStory: jest.fn().mockResolvedValue(undefined) }));
jest.mock("../src/components/Toast", () => ({ showToast: jest.fn() }));

const ID = "0f3c2b1a-1111-4222-8333-444455556666";

test("share links are katkee.com addresses", () => {
  expect(profileShareLink("asha_k", ID)).toBe(`https://katkee.com/u/asha_k?id=${ID}`);
  expect(storyShareLink(ID)).toBe(`https://katkee.com/s/${ID}`);
  // What the app shares, it can open.
  expect(deepLinkTarget(linkPath(profileShareLink("asha_k", ID))!)).toEqual({ kind: "profile", username: "asha_k", userId: ID });
  expect(deepLinkTarget(linkPath(storyShareLink(ID))!)).toEqual({ kind: "story", storyId: ID });
});

test("katkee.com links open the profile or Story, like the katkee:// links before them", () => {
  expect(deepLinkTarget(`/u/Asha_K?id=${ID.toUpperCase()}`)).toEqual({ kind: "profile", username: "asha_k", userId: ID });
  expect(deepLinkTarget("u/asha.k/")).toEqual({ kind: "profile", username: "asha.k" });
  expect(deepLinkTarget("/u/asha.k?id=nope")).toEqual({ kind: "profile", username: "asha.k" });
  expect(deepLinkTarget(`/s/${ID.toUpperCase()}`)).toEqual({ kind: "story", storyId: ID });
  // Old shared links.
  expect(deepLinkTarget(`user/asha_k?id=${ID}`)).toEqual({ kind: "profile", username: "asha_k", userId: ID });
  expect(deepLinkTarget(`story/${ID}`)).toEqual({ kind: "story", storyId: ID });
  for (const bad of ["u/ab", "u/a-b", "u/asha/extra", "s/not-a-uuid", `s/${ID}/extra`, "s/../../admin", "uu/asha_k", "ss/" + ID]) {
    expect(deepLinkTarget(bad)).toBeNull();
  }
});

test("the app takes its own links and katkee.com's, and no other site's", () => {
  expect(LINK_PREFIXES).toEqual(["katkee://", "https://katkee.com", "https://www.katkee.com"]);
  expect(linkPath(`katkee://story/${ID}`)).toBe(`story/${ID}`);
  expect(linkPath("katkee://reset-password?email=a%40b.co&code=123456")).toBe("reset-password?email=a%40b.co&code=123456");
  expect(linkPath(`https://katkee.com/s/${ID}`)).toBe(`/s/${ID}`);
  expect(linkPath("https://www.katkee.com/u/asha_k")).toBe("/u/asha_k");
  expect(linkPath("HTTPS://KATKEE.COM/u/asha_k")).toBe("/u/asha_k");
  for (const other of ["https://katkee.com.evil.example/u/asha_k", "https://evil.example/u/asha_k", "http://katkee.com/u/asha_k", "katkee:/u/x"]) {
    expect(linkPath(other)).toBeNull();
  }
});

test("Share via… and Copy link send the katkee.com link", async () => {
  const share = jest.spyOn(Share, "share").mockResolvedValue({ action: "sharedAction" } as never);
  let tree!: ReturnType<typeof create>;
  await act(async () => {
    tree = create(<ShareSheet visible storyId={ID} ownerUsername="asha_k" isPublic onClose={jest.fn()} onSendToUser={jest.fn()} />);
  });
  const [actions] = tree.root.findByType(ActionSheet).props.groups as Array<Array<{ label: string; onPress: () => void }>>;
  await act(async () => actions!.find((a) => a.label === "Share via…")!.onPress());
  expect(share).toHaveBeenCalledWith({ message: `@asha_k on Katkee: https://katkee.com/s/${ID}` });
  await act(async () => actions!.find((a) => a.label === "Copy link")!.onPress());
  expect(Clipboard.setString).toHaveBeenCalledWith(`https://katkee.com/s/${ID}`);
});
