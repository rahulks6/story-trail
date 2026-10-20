import React from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { Text } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { MAX_INTERESTS, OnboardingScreen } from "../src/screens/onboarding/OnboardingScreen";
import { needsOnboarding, OnboardingProvider } from "../src/state/onboarding";
import * as usersApi from "../src/api/users";
import { ApiError } from "../src/api/client";

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
  await act(async () => {
    tree = create(
      <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}>
        <OnboardingProvider value={{ finish }}>
          <OnboardingScreen />
        </OnboardingProvider>
      </SafeAreaProvider>,
    );
  });
});
afterEach(async () => { await act(async () => tree.unmount()); });

test("picks up to five interests, saves them, then suggests people to follow", async () => {
  expect(texts()).toContain("What are you into?");
  for (const i of ["Travel", "Food", "Music", "Cricket", "Tech", "Books"]) await press(i);
  expect(texts()).toContain(`Pick up to ${MAX_INTERESTS}.`);
  expect(pressable("Books").props.accessibilityState).toEqual({ checked: false });

  api.updateMyProfile.mockResolvedValueOnce({ user: { ...me, interests: ["Travel", "Food", "Music", "Cricket", "Tech"] } } as never);
  api.getSuggestions.mockResolvedValueOnce({ suggestions: [person("asha", { kind: "shared_interest", interest: "Travel" }), person("dev", { kind: "new" })] });
  await press("Next (5)");
  await settle();
  expect(api.updateMyProfile).toHaveBeenCalledWith({ interests: ["Travel", "Food", "Music", "Cricket", "Tech"] }, "token");
  expect(mockAuth.applyProfile).toHaveBeenCalled();
  expect(texts()).toEqual(expect.arrayContaining(["People to follow", "Also into Travel", "New to Katkee"]));

  api.followUser.mockResolvedValueOnce({ status: "following" });
  await press("Follow @asha");
  await settle();
  expect(api.followUser).toHaveBeenCalledWith("asha", "token");
  expect(pressable("Following @asha")).toBeTruthy();

  await press("Done");
  expect(finish).toHaveBeenCalled();
  expect(await needsOnboarding(me)).toBe(false);
});

test("both steps can be skipped, and with nobody to suggest it offers an invite", async () => {
  api.getSuggestions.mockResolvedValueOnce({ suggestions: [] });
  await press("Skip");
  await settle();
  expect(api.updateMyProfile).not.toHaveBeenCalled();
  expect(texts()).toEqual(expect.arrayContaining(["You're one of the first here"]));
  expect(pressable("Invite friends")).toBeTruthy();
  await press("Start using Katkee");
  expect(finish).toHaveBeenCalled();
});

test("a failed save keeps you on the interests step with the reason", async () => {
  await press("Travel");
  api.updateMyProfile.mockRejectedValueOnce(new ApiError(422, "Choose up to 5 interests, each 1-30 characters."));
  await press("Next (1)");
  await settle();
  expect(texts()).toContain("Choose up to 5 interests, each 1-30 characters.");
  expect(texts()).toContain("What are you into?");
});

test("shown once, and never to someone who already has interests", async () => {
  expect(await needsOnboarding(me)).toBe(true);
  expect(await needsOnboarding({ ...me, interests: ["Food"] })).toBe(false);
});
