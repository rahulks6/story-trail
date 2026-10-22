import React from "react";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { AppState, Dimensions, Image, StyleSheet, Text } from "react-native";
import * as usersApi from "../src/api/users";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StoryFeed } from "../src/screens/story/StoryFeed";
import * as storiesApi from "../src/api/stories";
import * as engagementApi from "../src/api/engagement";
import { timeNativeAnimations } from "./helpers/nativeAnimations";

// The feed as Home renders it, with the network replaced: two creators, the first with two Stories.
const mockSession = { accessToken: "token", user: { id: "u-viewer", username: "viewer" } };
jest.mock("../src/state/AuthContext", () => ({ useAuth: () => mockSession }));
jest.mock("@react-navigation/native", () => ({ ...jest.requireActual("@react-navigation/native"), useIsFocused: () => true }));
jest.mock("../src/hooks/useReducedMotion", () => ({ useReducedMotion: () => true }));
jest.mock("../src/components/StoryOverlayLayer", () => ({
  StoryOverlayLayer: (p: object) => require("react").createElement("StoryOverlayLayer", p),
  useContainerLayout: () => [{ width: 390, height: 844 }, () => undefined],
}));
jest.mock("../src/components/CommentsSheet", () => ({ CommentsSheet: (p: object) => require("react").createElement("CommentsSheet", p) }));
jest.mock("../src/components/ShareSheet", () => ({ ShareSheet: (p: object) => require("react").createElement("ShareSheet", p) }));
jest.mock("../src/components/StoryMoreMenu", () => ({ StoryMoreMenu: (p: object) => require("react").createElement("StoryMoreMenu", p) }));
jest.mock("../src/components/StoryInsightsSheet", () => ({ StoryInsightsSheet: (p: object) => require("react").createElement("StoryInsightsSheet", p) }));
jest.mock("../src/components/AddToHighlightSheet", () => ({ AddToHighlightSheet: (p: object) => require("react").createElement("AddToHighlightSheet", p) }));
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
  timeNativeAnimations();
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
const openProfile = jest.fn();
async function renderFeed(username = "viewer", creators = ["alice", "bob"]): Promise<void> {
  openProfile.mockClear();
  mockSession.user.username = username;
  await act(async () => {
    tree = create(
      <SafeAreaProvider initialMetrics={metrics}>
        <StoryFeed creators={creators} startIndex={0} onOpenDM={jest.fn()} onOpenProfile={openProfile} />
      </SafeAreaProvider>,
    );
  });
  await settle();
  // The photo finished loading: playback (and the view) starts.
  await act(async () => storyImage().props.onLoad());
  await settle();
}
// The Story's photo (playback starts when it loads), not the creator's avatar beside it.
const storyImage = () => tree.root.find((n) => n.type === Image && typeof n.props.onLoad === "function");
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
const sequence = () => tree.root.findAll((n) => typeof n.type === "string" && n.props.accessibilityRole === "progressbar").map((n) => n.props.accessibilityLabel as string)[0];

test("the right rail is Like, Share, More; view counts are the owner's alone", async () => {
  await renderFeed();
  const rail = tree.root.findAll((n: ReactTestInstance) => typeof n.type === "string" && n.props.accessibilityRole === "button" && ["Like", "Unlike", "Comments", "Share", "More"].includes(n.props.accessibilityLabel));
  // Comments open from "Add a comment…" under the Story (the rail carries them on your own Story only).
  expect(rail.map((n) => n.props.accessibilityLabel)).toEqual(["Like", "Share", "More"]);
  expect(texts()).not.toContain("12"); // someone else's Story: no view count (as on Instagram)
  expect(tree.root.findAll((n) => typeof n.props.accessibilityLabel === "string" && /views/.test(n.props.accessibilityLabel))).toHaveLength(0);
  expect(tree.root.findAll((n) => n.props.accessibilityLabel === "12 views. Open viewers and Insights")).toHaveLength(0);

  await act(async () => tree.unmount());
  await renderFeed("alice");
  expect(storiesApi.getMyActiveStories).toHaveBeenCalled();
});

test("under someone's Story: a comment bar; the name opens their profile; your own Story shows its views", async () => {
  await renderFeed();
  const byLabel = (label: string) => tree.root.find((n: ReactTestInstance) => typeof n.props.onPress === "function" && n.props.accessibilityLabel === label);
  expect(texts()).toContain("Add a comment…");
  await act(async () => byLabel("Add a comment").props.onPress());
  // The comments open with the keyboard up, ready to write.
  expect(tree.root.findByType("CommentsSheet" as never).props).toMatchObject({ visible: true, autoFocus: true });
  await act(async () => byLabel("Open @alice's profile").props.onPress());
  expect(openProfile).toHaveBeenCalledWith("alice");

  await act(async () => tree.unmount());
  // Your own Stories come from your own list.
  (storiesApi.getMyActiveStories as jest.Mock).mockResolvedValueOnce({ stories: (await storiesApi.getUserActiveStories("alice", "t")).stories });
  await renderFeed("alice", ["alice"]);
  expect(texts()).toContain("12 views");
  expect(texts()).not.toContain("Add a comment…");
  // …and can be added to a Highlight from right there, pausing the Story meanwhile.
  await act(async () => byLabel("Add this Story to a Highlight").props.onPress());
  const sheet = tree.root.findByType("AddToHighlightSheet" as never);
  expect(sheet.props).toMatchObject({ visible: true, storyIds: [expect.any(String)] });
  await act(async () => sheet.props.onAdded("Trips"));
  expect(texts()).toContain("Added");
});

test("tap right and left move within a creator; a double-tap likes instead of moving", async () => {
  await renderFeed();
  const width = Dimensions.get("window").width;
  expect(sequence()).toBe("Story 1 of 2");
  await gesture([width * 0.8, 400], [width * 0.8, 400]);
  await act(async () => { jest.advanceTimersByTime(300); });
  await settle();
  expect(sequence()).toBe("Story 2 of 2");
  await gesture([width * 0.2, 400], [width * 0.2, 400]);
  await act(async () => { jest.advanceTimersByTime(300); });
  await settle();
  expect(sequence()).toBe("Story 1 of 2");

  await gesture([width * 0.8, 400], [width * 0.8, 400]);
  await act(async () => { jest.advanceTimersByTime(100); });
  await gesture([width * 0.8, 400], [width * 0.8, 400]);
  await act(async () => { jest.advanceTimersByTime(300); });
  await settle();
  expect(engagementApi.likeStory).toHaveBeenCalledWith("a1", "token");
  expect(sequence()).toBe("Story 1 of 2");
});

test("swipe up moves to the next creator, swipe down back; holding pauses without moving", async () => {
  await renderFeed();
  await gesture([200, 600], [200, 400]);
  await settle();
  expect(storiesApi.getUserActiveStories).toHaveBeenLastCalledWith("bob", "token");
  await act(async () => storyImage().props.onLoad());
  await settle();
  expect(texts()).toContain("Caption b1");

  await gesture([200, 400], [200, 600]);
  await settle();
  expect(texts()).toContain("Caption a1");

  await gesture([300, 400], [300, 400], 400);
  await act(async () => { jest.advanceTimersByTime(300); });
  await settle();
  expect(sequence()).toBe("Story 1 of 2");
});

test("the top shows who posted it and when, with Follow for a creator you don't follow yet", async () => {
  const follow = jest.spyOn(usersApi, "followUser").mockResolvedValue({ status: "following" } as never);
  mockSession.user.username = "viewer";
  await act(async () => {
    tree = create(
      <SafeAreaProvider initialMetrics={metrics}>
        <StoryFeed creators={["alice"]} following={{ alice: false }} startIndex={0} onOpenDM={jest.fn()} onOpenProfile={openProfile} />
      </SafeAreaProvider>,
    );
  });
  await settle();
  await act(async () => storyImage().props.onLoad());
  await settle();
  expect(texts()).toEqual(expect.arrayContaining(["alice", "Follow"]));
  expect(texts().some((t) => /^(just now|\d+[mhdw])$/.test(t))).toBe(true);
  await act(async () => tree.root.find((n: ReactTestInstance) => typeof n.props.onPress === "function" && n.props.accessibilityLabel === "Follow @alice").props.onPress());
  expect(follow).toHaveBeenCalledWith("alice", "token");
  expect(texts()).toContain("Following");
});

test("holding a Story clears the screen to just the Story", async () => {
  await renderFeed();
  const rail = () => tree.root.find((n: ReactTestInstance) => typeof n.type === "string" && Array.isArray(n.props.style) && n.props.pointerEvents !== undefined && n.findAll((c) => c.props.accessibilityLabel === "Share").length > 0 && n.props.style.some((st: unknown) => st && typeof st === "object" && "right" in (st as object)));
  expect(StyleSheet.flatten(rail().props.style).opacity ?? 1).toBe(1);
  await act(async () => surface().props.onResponderGrant(touch(300, 400)));
  await act(async () => { jest.advanceTimersByTime(400); });
  expect(StyleSheet.flatten(rail().props.style).opacity).toBe(0);
  await act(async () => surface().props.onResponderRelease(touch(300, 400)));
  expect(StyleSheet.flatten(rail().props.style).opacity ?? 1).toBe(1);
});

test("text and stickers come with the photo, not after it, and the next person's Stories load ahead", async () => {
  const overlay = { id: "o1", type: "text", x: 0.5, y: 0.5, scale: 1, rotation: 0, zIndex: 1, properties: { text: "Hi" } };
  const list = (storiesApi.getUserActiveStories as jest.Mock);
  const original = list.getMockImplementation()!;
  list.mockImplementation(async (username: string) => {
    const result = await original(username);
    return username === "alice" ? { stories: result.stories.map((st: object) => ({ ...st, overlays: [overlay] })) } : result;
  });
  // The detail request is slow: the edits must not wait for it.
  const detail = engagementApi.getStoryDetail as jest.Mock;
  const originalDetail = detail.getMockImplementation()!;
  detail.mockImplementation(() => new Promise(() => undefined));
  await act(async () => {
    tree = create(
      <SafeAreaProvider initialMetrics={metrics}>
        <StoryFeed creators={["alice", "bob"]} startIndex={0} onOpenDM={jest.fn()} onOpenProfile={openProfile} />
      </SafeAreaProvider>,
    );
  });
  await settle();
  const layer = tree.root.find((n) => (n.type as unknown) === "StoryOverlayLayer");
  expect(layer.props.overlays).toEqual([overlay]);
  // Hidden together until the photo has loaded, then shown together.
  const fades = () => tree.root.findAll((n) => typeof n.type === "string" && StyleSheet.flatten(n.props.style)?.opacity !== undefined && n.findAll((c) => c.type === Image || (c.type as unknown) === "StoryOverlayLayer").length > 0);
  expect(fades().length).toBeGreaterThan(0);
  expect(fades().every((n) => StyleSheet.flatten(n.props.style).opacity === 0)).toBe(true);
  expect(list).toHaveBeenCalledWith("bob", "token");
  list.mockImplementation(original);
  detail.mockImplementation(originalDetail);
});

test("a Story with a song plays that part of it, credits it, and keeps a photo up for the song's length", async () => {
  const music = { trackId: "t1", title: "Sunny Walk", artist: "Artist", attribution: "Sunny Walk by Artist (CC BY 4.0)", license: "CC BY 4.0", licenseUrl: "https://creativecommons.org/licenses/by/4.0/", url: "https://cdn.test/m/t1/audio.mp3", startMs: 30_000, durationMs: 12_000 };
  const list = (storiesApi.getUserActiveStories as jest.Mock);
  const original = list.getMockImplementation()!;
  list.mockImplementation(async (username: string) => {
    const result = await original(username);
    return username === "alice" ? { stories: result.stories.map((st: object) => ({ ...st, music })) } : result;
  });
  await renderFeed();
  const player = tree.root.findAll((n) => (n.type as unknown) === "Video" && n.props.source?.uri === music.url);
  expect(player).toHaveLength(1);
  expect(player[0]!.props.paused).toBe(false);
  expect(tree.root.findAll((n) => n.props.accessibilityLabel === "Music: Sunny Walk by Artist" && typeof n.props.onPress === "function")).toHaveLength(1);
  // Not moved on at the usual 5 seconds; moved on after the song's 12.
  await act(async () => { jest.advanceTimersByTime(6_000); });
  expect(sequence()).toBe("Story 1 of 2");
  await act(async () => { jest.advanceTimersByTime(6_500); });
  await settle();
  expect(sequence()).toBe("Story 2 of 2");
  list.mockImplementation(original);
});

const delivery = (url: string, urlsExpireAt: string) => ({ status: "ready", kind: "photo", width: 1080, height: 1920, durationMs: null, thumbnailUrl: null, imageUrl: url, videos: [], urlsExpireAt });
const aliceCalls = () => (storiesApi.getUserActiveStories as jest.Mock).mock.calls.filter((c) => c[0] === "alice").length;

test("Stories whose signed links have expired (back after hours away) are fetched again before showing", async () => {
  const list = storiesApi.getUserActiveStories as jest.Mock;
  const original = list.getMockImplementation()!;
  const prefetch = jest.spyOn(Image, "prefetch").mockResolvedValue(true);
  let fetches = 0;
  list.mockImplementation(async (username: string) => {
    const result = await original(username);
    if (username !== "alice") return result;
    fetches += 1;
    const expired = fetches === 1;
    return { stories: result.stories.map((st: { id: string }) => ({ ...st, media: delivery(`https://cdn.test/${st.id}?v=${fetches}`, new Date(Date.now() + (expired ? -60_000 : 3_600_000)).toISOString()) })) };
  });
  await renderFeed();
  try {
    expect(aliceCalls()).toBe(2);
    expect(storyImage().props.source.uri).toBe("https://cdn.test/a1?v=2");
    expect(sequence()).toBe("Story 1 of 2");
  } finally {
    list.mockImplementation(original);
    prefetch.mockRestore();
  }
});

test("a photo that won't load fetches fresh links once, then offers Try again, which fetches again", async () => {
  await renderFeed();
  expect(aliceCalls()).toBe(1);
  await act(async () => storyImage().props.onError());
  await settle();
  // Fresh links, same Story, no error shown.
  expect(aliceCalls()).toBe(2);
  expect(texts()).toContain("Caption a1");
  await act(async () => storyImage().props.onError());
  await settle();
  expect(texts()).toContain("Couldn't load this photo.");
  const tryAgain = tree.root.find((n: ReactTestInstance) => typeof n.props.onPress === "function" && n.findAll((c) => c.props.children === "Try again").length > 0);
  await act(async () => tryAgain.props.onPress());
  await settle();
  expect(aliceCalls()).toBe(3);
  expect(texts()).toContain("Caption a1");
});

test("Follow sends one request however fast it's tapped, and says Requested for a private account", async () => {
  let resolve!: (v: unknown) => void;
  const follow = jest.spyOn(usersApi, "followUser").mockImplementation(() => new Promise((r) => { resolve = r; }) as never);
  mockSession.user.username = "viewer";
  await act(async () => {
    tree = create(
      <SafeAreaProvider initialMetrics={metrics}>
        <StoryFeed creators={["alice"]} following={{ alice: false }} startIndex={0} onOpenDM={jest.fn()} onOpenProfile={openProfile} />
      </SafeAreaProvider>,
    );
  });
  await settle();
  const button = tree.root.find((n: ReactTestInstance) => typeof n.props.onPress === "function" && n.props.accessibilityLabel === "Follow @alice");
  // Two taps before the screen has re-rendered.
  await act(async () => { button.props.onPress(); button.props.onPress(); });
  expect(follow).toHaveBeenCalledTimes(1);
  await act(async () => resolve({ status: "requested" }));
  await settle();
  expect(texts()).toContain("Requested");
  follow.mockRestore();
});

test("your own Story that's no longer active opens from your Archive", async () => {
  const onOpenArchived = jest.fn();
  mockSession.user.username = "alice";
  (storiesApi.getMyActiveStories as jest.Mock).mockResolvedValueOnce({ stories: (await storiesApi.getUserActiveStories("alice", "t")).stories });
  await act(async () => {
    tree = create(
      <SafeAreaProvider initialMetrics={metrics}>
        <StoryFeed creators={["alice"]} startIndex={0} initialStoryId="a-expired" onClose={jest.fn()} onOpenArchived={onOpenArchived} onOpenDM={jest.fn()} onOpenProfile={openProfile} />
      </SafeAreaProvider>,
    );
  });
  await settle();
  expect(onOpenArchived).toHaveBeenCalledWith("a-expired");
});
