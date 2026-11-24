import React from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { Text } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { OnboardingScreen } from "../src/screens/onboarding/OnboardingScreen";
import { needsOnboarding, OnboardingProvider, takeCreateAfterOnboarding } from "../src/state/onboarding";
import * as usersApi from "../src/api/users";

const me = { id: "u-new", username: "newbie", email: "n@example.com", displayName: "New", bio: "", avatarMediaId: null, interests: [] as string[], isPrivate: false };
const mockAuth = { user: me, accessToken: "token", applyProfile: jest.fn() };
jest.mock("../src/state/AuthContext", () => ({ useAuth: () => mockAuth }));
jest.mock("../src/api/users", () => ({
  updateMyProfile: jest.fn(),
  getSuggestions: jest.fn(),
  followUser: jest.fn(),
  unfollowUser: jest.fn(),
}));
jest.mock("../src/components/Avatar", () => ({ Avatar: () => null }));
jest.mock("../src/state/invites", () => ({ shareInvite: jest.fn() }));
jest.mock("../src/api/growth", () => ({ getTodayTheme: jest.fn(async () => ({ date: "2026-11-24", slug: "chai", emoji: "☕", title: "Your chai or coffee moment", postedToday: false })) }));
jest.mock("../src/api/media", () => ({ uploadPhoto: jest.fn(async () => ({ id: "media-1" })) }));
jest.mock("react-native-image-picker", () => ({ launchImageLibrary: jest.fn(async () => ({ assets: [{ uri: "file:///me.jpg", width: 800, height: 800 }] })), launchCamera: jest.fn() }));
// Placing the photo in the circle: done at once here (AvatarCropper has its own tests).
jest.mock("../src/components/AvatarCropper", () => ({
  AvatarCropper: ({ photo, onDone }: { photo: { uri: string } | null; onDone: (uri: string) => void }) => {
    const { useEffect } = require("react");
    useEffect(() => { if (photo) onDone(photo.uri + "#cropped"); }, [photo, onDone]);
    return null;
  },
}));
// The contacts step's own behaviour is tested in contacts.test.tsx.
jest.mock("../src/components/ContactsFinder", () => ({
  ContactsFinder: ({ header, footer }: { header: React.ReactNode; footer: React.ReactNode }) => {
    const { Text: T, View: V } = require("react-native");
    return <V>{header}<T>Find friends from your contacts</T>{footer}</V>;
  },
}));
const api = usersApi as jest.Mocked<typeof usersApi>;
const person = (username: string, reason: usersApi.SuggestedPerson["reason"]) =>
  ({ id: `id-${username}`, username, displayName: username, avatarMediaId: null, isPrivate: false, reason, viewer: {} }) as unknown as usersApi.SuggestedPerson;

let tree: ReactTestRenderer;
const finish = jest.fn();
const texts = () => tree.root.findAllByType(Text).map((t) => [t.props.children].flat().join(""));
const pressable = (label: string) => tree.root.find((n: ReactTestInstance) => typeof n.props.onPress === "function" && n.props.accessibilityLabel === label);
const press = async (label: string) => { await act(async () => pressable(label).props.onPress()); };
const byTestId = (id: string) => tree.root.find((n: ReactTestInstance) => n.props.testID === id && typeof n.props.onPress === "function");
const settle = async () => { for (let i = 0; i < 4; i++) await act(async () => { await Promise.resolve(); }); };

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  api.getSuggestions.mockResolvedValue({ suggestions: [] });
});
const mount = async () => {
  await act(async () => {
    tree = create(
      <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}>
        <OnboardingProvider value={{ finish }}>
          <OnboardingScreen />
        </OnboardingProvider>
      </SafeAreaProvider>,
    );
  });
  await settle();
};
afterEach(async () => { if (tree) await act(async () => tree.unmount()); });

test("photo, then a goal of people to follow, then contacts, then a first Story", async () => {
  api.getSuggestions.mockResolvedValueOnce({ suggestions: [person("asha", { kind: "shared_interest", interest: "Travel" }), person("dev", { kind: "new" })] });
  await mount();
  // First a profile photo, which can wait.
  expect(texts()).toEqual(expect.arrayContaining(["Step 1 of 4", "Add a profile photo"]));
  await press("Not now");
  await settle();
  // Katkee learns interests from what people watch; onboarding no longer asks.
  expect(texts()).not.toContain("What are you into?");
  // Two suggested, so the goal is two.
  expect(texts()).toEqual(expect.arrayContaining(["Step 2 of 4", "Follow at least 2 people", "Following 0 of 2", "Also into Travel", "New to Katkee"]));
  expect(api.updateMyProfile).not.toHaveBeenCalled();

  api.followUser.mockResolvedValue({ status: "following" });
  await press("Follow @asha");
  await settle();
  expect(api.followUser).toHaveBeenCalledWith("asha", "token");
  expect(pressable("Following @asha")).toBeTruthy();
  expect(texts()).toEqual(expect.arrayContaining(["Following 1 of 2", "Follow 1 more"]));
  await press("Follow @dev");
  await settle();
  expect(texts()).toContain("Your Home is ready ✓");

  await press("Next");
  expect(finish).not.toHaveBeenCalled();
  expect(texts()).toEqual(expect.arrayContaining(["Step 3 of 4", "Find friends from your contacts"]));
  await press("Next");
  await settle();
  expect(texts()).toEqual(expect.arrayContaining(["Step 4 of 4", "Share your first Story", "Your chai or coffee moment"]));
  await press("Maybe later");
  expect(finish).toHaveBeenCalled();
  expect(takeCreateAfterOnboarding()).toBe(false);
  expect(await needsOnboarding(me)).toBe(false);
});

test("Follow all follows everyone suggested; Skip for now still moves on", async () => {
  api.getSuggestions.mockResolvedValueOnce({ suggestions: ["a1", "a2", "a3", "a4"].map((u) => person(u, { kind: "new" })) });
  api.followUser.mockResolvedValue({ status: "following" });
  await mount();
  await press("Not now");
  await settle();
  expect(texts()).toEqual(expect.arrayContaining(["Follow at least 3 people", "Follow 3 more"]));
  await act(async () => byTestId("onboarding-follow-all").props.onPress());
  await settle();
  expect(api.followUser.mock.calls.map((c) => c[0])).toEqual(["a1", "a2", "a3", "a4"]);
  expect(texts()).toContain("Your Home is ready ✓");
  await act(async () => tree.unmount());

  api.getSuggestions.mockResolvedValueOnce({ suggestions: ["b1", "b2", "b3"].map((u) => person(u, { kind: "new" })) });
  await mount();
  await press("Not now");
  await settle();
  await act(async () => byTestId("onboarding-skip").props.onPress());
  expect(texts()).toContain("Find friends from your contacts");
});

test("Open camera on the last step asks Home to open Create", async () => {
  mockAuth.user = { ...me, avatarMediaId: "has-one" } as never;
  try {
    await mount();
    await press("Next");
    await press("Next");
    await settle();
    await press("Open camera");
    expect(finish).toHaveBeenCalled();
    expect(takeCreateAfterOnboarding()).toBe(true);
    expect(takeCreateAfterOnboarding()).toBe(false);
  } finally {
    mockAuth.user = me as never;
  }
});

test("with nobody to suggest it offers an invite, and every step can be passed", async () => {
  api.getSuggestions.mockResolvedValueOnce({ suggestions: [] });
  await mount();
  await press("Not now");
  await settle();
  expect(texts()).toEqual(expect.arrayContaining(["You're one of the first here"]));
  expect(pressable("Invite friends")).toBeTruthy();
  const { shareInvite } = jest.requireMock("../src/state/invites") as { shareInvite: jest.Mock };
  await press("Invite friends");
  expect(shareInvite).toHaveBeenCalledWith("onboarding", "token", "u-new");
  await press("Next");
  await press("Next");
  await settle();
  await press("Maybe later");
  expect(finish).toHaveBeenCalled();
});

test("a profile photo chosen in onboarding is saved to the account at once", async () => {
  api.updateMyProfile.mockResolvedValueOnce({ user: { ...me, avatarMediaId: "media-1" } } as never);
  await mount();
  // The big circle and the button both choose a photo.
  const choose = tree.root.findAll((n: ReactTestInstance) => typeof n.props.onPress === "function" && n.props.accessibilityLabel === "Choose a photo");
  expect(choose.length).toBeGreaterThan(0);
  await act(async () => choose[0]!.props.onPress());
  await settle();
  const media = jest.requireMock("../src/api/media") as { uploadPhoto: jest.Mock };
  expect(media.uploadPhoto).toHaveBeenCalledWith("file:///me.jpg#cropped", "image/jpeg", "token");
  expect(api.updateMyProfile).toHaveBeenCalledWith({ avatarMediaId: "media-1" }, "token");
  expect(mockAuth.applyProfile).toHaveBeenCalled();
  expect(texts()).toContain("People to follow");
});

test("someone who already has a photo skips that step", async () => {
  mockAuth.user = { ...me, avatarMediaId: "has-one" } as never;
  try {
    await mount();
    expect(texts()).toEqual(expect.arrayContaining(["Step 1 of 3", "People to follow"]));
  } finally {
    mockAuth.user = me as never;
  }
});

test("shown once, and never to someone who already has interests", async () => {
  expect(await needsOnboarding(me)).toBe(true);
  expect(await needsOnboarding({ ...me, interests: ["Food"] })).toBe(false);
});
