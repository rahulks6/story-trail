import React from "react";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { AppState, Dimensions, Image, Text } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StoryFeed } from "../src/screens/story/StoryFeed";
import * as storiesApi from "../src/api/stories";
import * as engagementApi from "../src/api/engagement";

// The feed as Home renders it, with the network replaced: two creators, the first with two Stories.
const mockSession = { accessToken: "token", user: { id: "u-viewer", username: "viewer" } };
jest.mock("../src/state/AuthContext", () => ({ useAuth: () => mockSession }));
jest.mock("@react-navigation/native", () => ({ ...jest.requireActual("@react-navigation/native"), useIsFocused: () => true }));
jest.mock("../src/hooks/useReducedMotion", () => ({ useReducedMotion: () => true }));
jest.mock("../src/components/StoryOverlayLayer", () => ({
  StoryOverlayLayer: () => null,
  useContainerLayout: () => [{ width: 390, height: 844 }, () => undefined],
}));
jest.mock("../src/components/CommentsSheet", () => ({ CommentsSheet: (p: object) => require("react").createElement("CommentsSheet", p) }));
jest.mock("../src/components/ShareSheet", () => ({ ShareSheet: (p: object) => require("react").createElement("ShareSheet", p) }));
jest.mock("../src/components/StoryMoreMenu", () => ({ StoryMoreMenu: (p: object) => require("react").createElement("StoryMoreMenu", p) }));
jest.mock("../src/components/StoryInsightsSheet", () => ({ StoryInsightsSheet: (p: object) => require("react").createElement("StoryInsightsSheet", p) }));
jest.mock("../src/api/events", () => ({ recordEvent: jest.fn(async () => undefined) }));
jest.mock("../src/api/media", () => ({ getMedia: jest.fn(async () => ({ kind: "photo" })), mediaSource: (uri: string) => ({ uri }) }));
jest.mock("../src/api/stories", () => {
  const story = (id: string, ownerId: string) => ({
    id, ownerId, mediaId: `m-${id}`, caption: `Caption ${id}`, audience: "public", allowComments: "everyone", allowSharing: true,
    createdAt: "2026-10-06 08:00:00+00", expiresAt: "2026-10-07 08:00:00+00", overlays: [], drawing: [], filter: "original",
    audioMuted: false, crop: { zoom: 1, offsetX: 0, offsetY: 0 }, media: null,
  });
  const byUser: Record<string, unknown[]> = { alice: [story("a1", "u-alice"), story("a2", "u-alice")], bob: [story("b1", "u-bob")] };
  return {
    getUserActiveStories: jest.fn(async (username: string) => ({ stories: byUser[username] ?? [] })),
    getMyActiveStories: jest.fn(async () => ({ stories: [] })),
    getViewCount: jest.fn(async () => ({ views: 12 })),
    recordStoryView: jest.fn(async () => undefined),
    mediaFileUrl: (id: string) => `https://api.test/media/${id}`,
  };
});
jest.mock("../src/api/engagement", () => ({
  getStoryDetail: jest.fn(async (id: string) => ({
    story: {
      id, ownerId: id.startsWith("a") ? "u-alice" : "u-bob", mediaId: `m-${id}`, caption: `Caption ${id}`, audience: "public",
      allowComments: "everyone", allowSharing: true, createdAt: "2026-10-06 08:00:00+00", expiresAt: "2026-10-07 08:00:00+00",
      likeCount: 3, commentCount: 1, viewCount: 12, viewerHasLiked: false, overlays: [], drawing: [], filter: "original",
      audioMuted: false, crop: { zoom: 1, offsetX: 0, offsetY: 0 },
    },
  })),
  likeStory: jest.fn(async () => undefined),
  unlikeStory: jest.fn(async () => undefined),
}));

const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 59, left: 0, right: 0, bottom: 34 } };
let tree: ReactTestRenderer;

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  // The app is in the foreground (the feed loads and plays only then).
  (AppState as { currentState: string }).currentState = "active";
});
afterEach(async () => {
  await act(async () => tree?.unmount());
  jest.useRealTimers();
});

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await act(async () => { await Promise.resolve(); });
}
async function renderFeed(username = "viewer"): Promise<void> {
  mockSession.user.username = username;
  await act(async () => {
    tree = create(
      <SafeAreaProvider initialMetrics={metrics}>
        <StoryFeed creators={["alice", "bob"]} startIndex={0} onOpenDM={jest.fn()} onOpenProfile={jest.fn()} />
      </SafeAreaProvider>,
    );
  });
  await settle();
  // The photo finished loading: playback (and the view) starts.
  await act(async () => tree.root.findByType(Image).props.onLoad());
  await settle();
}
const texts = () => tree.root.findAllByType(Text).map((t) => [t.props.children].flat().join(""));
const surface = () => tree.root.find((n) => typeof n.type === "string" && n.props.accessibilityLabel === "Story");
const touch = (x: number, y: number) => ({
  nativeEvent: { pageX: x, pageY: y, locationX: x, locationY: y, touches: [], changedTouches: [], identifier: 1, timestamp: Date.now() },
  touchHistory: { numberActiveTouches: 0, indexOfSingleActiveTouch: -1, mostRecentTimeStamp: Date.now(), touchBank: [] },
});
async function gesture(from: [number, number], to: [number, number], holdMs = 0): Promise<void> {
  const view = surface();
  await act(async () => view.props.onResponderGrant(touch(...from)));
  if (holdMs) await act(async () => { jest.advanceTimersByTime(holdMs); });
  await act(async () => view.props.onResponderRelease(touch(...to)));
}
const sequence = () => texts().find((t) => / of \d+ today$/.test(t));

test("the right rail is Like, Comment, Share, More; everyone sees the view count, only owners open viewers", async () => {
  await renderFeed();
  const rail = tree.root.findAll((n: ReactTestInstance) => typeof n.type === "string" && n.props.accessibilityRole === "button" && ["Like", "Unlike", "Comments", "Share", "More"].includes(n.props.accessibilityLabel));
  expect(rail.map((n) => n.props.accessibilityLabel)).toEqual(["Like", "Comments", "Share", "More"]);
  expect(texts()).toContain("12");
  expect(texts().some((t) => /viewers/.test(t))).toBe(false); // an icon, not the word "viewers"
  expect(tree.root.findAll((n) => n.props.accessibilityLabel === "12 views. Open viewers and Insights")).toHaveLength(0);

  await act(async () => tree.unmount());
  await renderFeed("alice");
  expect(storiesApi.getMyActiveStories).toHaveBeenCalled();
});

test("tap right and left move within a creator; a double-tap likes instead of moving", async () => {
  await renderFeed();
  const width = Dimensions.get("window").width;
  expect(sequence()).toBe("1 of 2 today");
  await gesture([width * 0.8, 400], [width * 0.8, 400]);
  await act(async () => { jest.advanceTimersByTime(300); });
  await settle();
  expect(sequence()).toBe("2 of 2 today");
  await gesture([width * 0.2, 400], [width * 0.2, 400]);
  await act(async () => { jest.advanceTimersByTime(300); });
  await settle();
  expect(sequence()).toBe("1 of 2 today");

  await gesture([width * 0.8, 400], [width * 0.8, 400]);
  await act(async () => { jest.advanceTimersByTime(100); });
  await gesture([width * 0.8, 400], [width * 0.8, 400]);
  await act(async () => { jest.advanceTimersByTime(300); });
  await settle();
  expect(engagementApi.likeStory).toHaveBeenCalledWith("a1", "token");
  expect(sequence()).toBe("1 of 2 today");
});

test("swipe up moves to the next creator, swipe down back; holding pauses without moving", async () => {
  await renderFeed();
  await gesture([200, 600], [200, 400]);
  await settle();
  expect(storiesApi.getUserActiveStories).toHaveBeenLastCalledWith("bob", "token");
  await act(async () => tree.root.findByType(Image).props.onLoad());
  await settle();
  expect(texts()).toContain("Caption b1");

  await gesture([200, 400], [200, 600]);
  await settle();
  expect(texts()).toContain("Caption a1");

  await gesture([300, 400], [300, 400], 400);
  await act(async () => { jest.advanceTimersByTime(300); });
  await settle();
  expect(sequence()).toBe("1 of 2 today");
});
