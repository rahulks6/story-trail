import React from "react";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { AppState, Text } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ArchivedStoryViewerScreen } from "../src/screens/profile/ArchivedStoryViewerScreen";
import * as engagementApi from "../src/api/engagement";

// One of your Archive's Stories, played on its own.
let mockFocused = true;
jest.mock("../src/state/AuthContext", () => ({ useAuth: () => ({ accessToken: "token", user: { id: "u-me", username: "me" } }) }));
jest.mock("@react-navigation/native", () => ({
  ...jest.requireActual("@react-navigation/native"),
  useNavigation: () => ({ navigate: jest.fn() }),
  useIsFocused: () => mockFocused,
}));
jest.mock("../src/components/StoryOverlayLayer", () => ({ StoryOverlayLayer: () => null, useContainerLayout: () => [{ width: 390, height: 844 }, () => undefined] }));
jest.mock("../src/components/AddToHighlightSheet", () => ({ AddToHighlightSheet: () => null }));
jest.mock("../src/api/media", () => ({ getMedia: jest.fn(async () => ({ kind: "video" })) }));
jest.mock("../src/api/stories", () => ({ mediaFileUrl: (id: string, variant: string) => `https://api.test/media/${id}/${variant}` }));
jest.mock("../src/api/engagement", () => ({
  getStoryDetail: jest.fn(async (id: string) => ({ story: { id, mediaId: `m-${id}`, caption: "", overlays: [], drawing: [], filter: "original", audioMuted: false, crop: { zoom: 1, offsetX: 0, offsetY: 0 } } })),
}));

let tree: ReactTestRenderer;
const navigation = { goBack: jest.fn() };
const screen = () => (
  <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}>
    <ArchivedStoryViewerScreen route={{ key: "a", name: "ArchivedStoryViewer", params: { storyId: "s1" } } as never} navigation={navigation as never} />
  </SafeAreaProvider>
);
const settle = async () => { for (let i = 0; i < 4; i++) await act(async () => { await Promise.resolve(); }); };
const video = () => tree.root.find((n: ReactTestInstance) => (n.type as unknown) === "Video");
const texts = () => tree.root.findAllByType(Text).map((t) => [t.props.children].flat().join(""));

beforeEach(() => {
  mockFocused = true;
  (AppState as { currentState: string }).currentState = "active";
});
afterEach(async () => {
  await act(async () => tree?.unmount());
  jest.clearAllMocks();
});

test("the video plays only while the viewer is on screen", async () => {
  await act(async () => { tree = create(screen()); });
  await settle();
  expect(video().props.paused).toBe(false);
  mockFocused = false;
  await act(async () => tree.update(screen()));
  expect(video().props.paused).toBe(true);
});

test("a video that won't play says so and can be tried again, instead of a black screen", async () => {
  await act(async () => { tree = create(screen()); });
  await settle();
  await act(async () => video().props.onError({ error: {} }));
  expect(texts()).toContain("Couldn't play this Story.");
  const tryAgain = tree.root.find((n: ReactTestInstance) => typeof n.props.onPress === "function" && n.findAll((c) => c.props.children === "Try again").length > 0);
  await act(async () => tryAgain.props.onPress());
  await settle();
  expect(engagementApi.getStoryDetail).toHaveBeenCalledTimes(2);
  expect(video().props.paused).toBe(false);
});
