import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { HomeScreen } from "../src/screens/home/HomeScreen";
import { profileChanged, storyPublished } from "../src/state/storyChanges";
import * as storiesApi from "../src/api/stories";

// Home reloads when something it shows has changed elsewhere in the app.
jest.mock("../src/state/AuthContext", () => ({ useAuth: () => ({ accessToken: "token", user: { id: "u-me", username: "me" } }) }));
jest.mock("@react-navigation/native", () => ({ ...jest.requireActual("@react-navigation/native"), useNavigation: () => ({ navigate: jest.fn() }) }));
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
