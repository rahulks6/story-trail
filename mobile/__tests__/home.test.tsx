import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { AppState, RefreshControl } from "react-native";
import { HOME_STALE_MS, HomeScreen } from "../src/screens/home/HomeScreen";
import { profileChanged, storyPublished } from "../src/state/storyChanges";
import * as storiesApi from "../src/api/stories";

// Home reloads when something it shows has changed elsewhere in the app.
jest.mock("../src/state/NotificationsContext", () => ({ useNotifications: () => ({ unreadCount: 0 }) }));
jest.mock("../src/state/AuthContext", () => ({ useAuth: () => ({ accessToken: "token", user: { id: "u-me", username: "me" } }) }));
const mockNavigation = { navigate: jest.fn() };
let mockFocused = true;
jest.mock("@react-navigation/native", () => ({ ...jest.requireActual("@react-navigation/native"), useNavigation: () => mockNavigation, useIsFocused: () => mockFocused }));
jest.mock("../src/screens/story/StoryFeed", () => ({ StoryFeed: (props: object) => require("react").createElement("StoryFeed", props) }));
jest.mock("../src/api/ads", () => ({ getAdPlacements: jest.fn(async () => ({ placements: [] })) }));
jest.mock("../src/api/stories", () => ({
  getRankedHomeFeed: jest.fn(async () => ({ feed: [{ owner: { id: "u-me", username: "me" }, isFollowing: false, stories: [], score: 1 }], nextCursor: null })),
}));

const stories = storiesApi as jest.Mocked<typeof storiesApi>;
let tree: ReactTestRenderer;
const flush = async () => { for (let i = 0; i < 4; i++) await act(async () => { await Promise.resolve(); }); };

test("Home reloads after an Edit Profile save, so your own Story shows your new name and photo, and after a new Story", async () => {
  await act(async () => { tree = create(<HomeScreen />); });
  await flush();
  expect(stories.getRankedHomeFeed).toHaveBeenCalledTimes(1);
  expect(tree.root.findAllByType("StoryFeed" as never)).toHaveLength(1);
  await act(async () => profileChanged());
  await flush();
  expect(stories.getRankedHomeFeed).toHaveBeenCalledTimes(2);
  await act(async () => storyPublished());
  await flush();
  expect(stories.getRankedHomeFeed).toHaveBeenCalledTimes(3);
  await act(async () => tree.unmount());
  profileChanged(); // no listener left behind
  expect(stories.getRankedHomeFeed).toHaveBeenCalledTimes(3);
});

test("a screen that stops listening for profile changes isn't called again", () => {
  const { onProfileChanged } = jest.requireActual("../src/state/storyChanges") as typeof import("../src/state/storyChanges");
  const listener = jest.fn();
  const stop = onProfileChanged(listener);
  profileChanged();
  stop();
  profileChanged();
  expect(listener).toHaveBeenCalledTimes(1);
});

const feedEntry = (username: string) => ({ owner: { id: `u-${username}`, username }, isFollowing: true, stories: [], score: 1 });
const feedProps = () => tree.root.findByType("StoryFeed" as never).props as { creators: string[]; following: object; onOpenProfile: (u: string) => void; onOpenDM: object };

test("Home keeps the same creators and callbacks across re-renders, and opens a profile above Search's own first screen", async () => {
  mockFocused = true;
  await act(async () => { tree = create(<HomeScreen />); });
  await flush();
  const first = feedProps();
  await act(async () => tree.update(<HomeScreen />));
  const second = feedProps();
  expect(second.creators).toBe(first.creators);
  expect(second.following).toBe(first.following);
  expect(second.onOpenProfile).toBe(first.onOpenProfile);
  expect(second.onOpenDM).toBe(first.onOpenDM);
  second.onOpenProfile("alice");
  expect(mockNavigation.navigate).toHaveBeenCalledWith("Search", { screen: "UserProfile", initial: false, params: { username: "alice" } });
  await act(async () => tree.unmount());
});

test("back on Home after a few minutes away, the feed reloads quietly — not on a quick tab switch", async () => {
  let now = Date.parse("2026-10-19T10:00:00Z");
  const clock = jest.spyOn(Date, "now").mockImplementation(() => now);
  stories.getRankedHomeFeed.mockClear();
  stories.getRankedHomeFeed.mockResolvedValue({ feed: [feedEntry("alice")], nextCursor: null } as never);
  (AppState.addEventListener as jest.Mock).mockClear();
  mockFocused = true;
  await act(async () => { tree = create(<HomeScreen />); });
  await flush();
  expect(stories.getRankedHomeFeed).toHaveBeenCalledTimes(1);
  // A quick look at another tab: nothing reloads.
  mockFocused = false;
  await act(async () => tree.update(<HomeScreen />));
  now += 30_000;
  mockFocused = true;
  await act(async () => tree.update(<HomeScreen />));
  await flush();
  expect(stories.getRankedHomeFeed).toHaveBeenCalledTimes(1);
  // In the background for longer than the limit: reloads on return, still showing the feed meanwhile.
  const listeners = (AppState.addEventListener as jest.Mock).mock.calls.map((c) => c[1] as (s: string) => void);
  const emit = (state: string) => listeners.forEach((fn) => fn(state));
  await act(async () => emit("background"));
  now += HOME_STALE_MS + 1000;
  stories.getRankedHomeFeed.mockResolvedValue({ feed: [feedEntry("alice"), feedEntry("bob")], nextCursor: null } as never);
  await act(async () => emit("active"));
  expect(tree.root.findAllByType("StoryFeed" as never)).toHaveLength(1);
  await flush();
  expect(stories.getRankedHomeFeed).toHaveBeenCalledTimes(2);
  expect(feedProps().creators).toEqual(["alice", "bob"]);
  // Away on another tab for a while: reloads when Home is shown again.
  mockFocused = false;
  await act(async () => tree.update(<HomeScreen />));
  now += HOME_STALE_MS + 1000;
  mockFocused = true;
  await act(async () => tree.update(<HomeScreen />));
  await flush();
  expect(stories.getRankedHomeFeed).toHaveBeenCalledTimes(3);
  await act(async () => tree.unmount());
  clock.mockRestore();
});

test("with no active Stories, Home can be pulled to refresh, and offers Find people", async () => {
  mockFocused = true;
  stories.getRankedHomeFeed.mockClear();
  stories.getRankedHomeFeed.mockResolvedValue({ feed: [], nextCursor: null } as never);
  await act(async () => { tree = create(<HomeScreen />); });
  await flush();
  const control = tree.root.findByType(RefreshControl);
  stories.getRankedHomeFeed.mockResolvedValue({ feed: [feedEntry("alice")], nextCursor: null } as never);
  await act(async () => control.props.onRefresh());
  await flush();
  expect(stories.getRankedHomeFeed).toHaveBeenCalledTimes(2);
  expect(feedProps().creators).toEqual(["alice"]);
  await act(async () => tree.unmount());

  stories.getRankedHomeFeed.mockResolvedValue({ feed: [], nextCursor: null } as never);
  await act(async () => { tree = create(<HomeScreen />); });
  await flush();
  const find = tree.root.find((n) => typeof n.props.onPress === "function" && n.findAll((c) => c.props.children === "Find people").length > 0);
  await act(async () => find.props.onPress());
  expect(mockNavigation.navigate).toHaveBeenCalledWith("Search", { screen: "SearchHome" });
  await act(async () => tree.unmount());
});
