import React from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { Text } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { OnboardingScreen } from "../src/screens/onboarding/OnboardingScreen";
import { needsOnboarding, OnboardingProvider } from "../src/state/onboarding";
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

test("starts with people to follow (no interests question), then contacts", async () => {
  api.getSuggestions.mockResolvedValueOnce({ suggestions: [person("asha", { kind: "shared_interest", interest: "Travel" }), person("dev", { kind: "new" })] });
  await mount();
  // Katkee learns interests from what people watch; onboarding no longer asks.
  expect(texts()).not.toContain("What are you into?");
  expect(texts()).toEqual(expect.arrayContaining(["Step 1 of 2", "People to follow", "Also into Travel", "New to Katkee"]));
  expect(api.updateMyProfile).not.toHaveBeenCalled();

  api.followUser.mockResolvedValueOnce({ status: "following" });
  await press("Follow @asha");
  await settle();
  expect(api.followUser).toHaveBeenCalledWith("asha", "token");
  expect(pressable("Following @asha")).toBeTruthy();

  await press("Next");
  expect(finish).not.toHaveBeenCalled();
  expect(texts()).toEqual(expect.arrayContaining(["Step 2 of 2", "Find friends from your contacts"]));
  await press("Start using Katkee");
  expect(finish).toHaveBeenCalled();
  expect(await needsOnboarding(me)).toBe(false);
});

test("every step can be skipped, and with nobody to suggest it offers an invite", async () => {
  api.getSuggestions.mockResolvedValueOnce({ suggestions: [] });
  await mount();
  expect(texts()).toEqual(expect.arrayContaining(["You're one of the first here"]));
  expect(pressable("Invite friends")).toBeTruthy();
  const { shareInvite } = jest.requireMock("../src/state/invites") as { shareInvite: jest.Mock };
  await press("Invite friends");
  expect(shareInvite).toHaveBeenCalledWith("onboarding", "token", "u-new");
  await press("Skip");
  await press("Start using Katkee");
  expect(finish).toHaveBeenCalled();
});

test("shown once, and never to someone who already has interests", async () => {
  expect(await needsOnboarding(me)).toBe(true);
  expect(await needsOnboarding({ ...me, interests: ["Food"] })).toBe(false);
});
