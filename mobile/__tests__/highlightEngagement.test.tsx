import React from "react";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { Share } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { HighlightViewerScreen } from "../src/screens/highlight/HighlightViewerScreen";
import * as engagementApi from "../src/api/engagement";

// Someone else's Highlight: its Stories can be liked, commented on and shared, like a live Story.
jest.mock("../src/state/AuthContext", () => ({ useAuth: () => ({ accessToken: "token", user: { id: "u-me", username: "me" } }) }));
jest.mock("@react-navigation/native", () => ({
  ...jest.requireActual("@react-navigation/native"),
  useIsFocused: () => true,
  useNavigation: () => ({ navigate: jest.fn() }),
  useFocusEffect: (effect: () => void) => require("react").useEffect(() => effect(), [effect]),
}));
jest.mock("../src/components/StoryOverlayLayer", () => ({
  StoryOverlayLayer: () => null,
  useContainerLayout: () => [{ width: 390, height: 844 }, () => undefined],
}));
jest.mock("../src/components/MusicPlayer", () => ({ MusicPlayer: () => null }));
jest.mock("../src/components/CommentsSheet", () => ({ CommentsSheet: (props: { visible: boolean; storyId: string }) => require("react").createElement("CommentsSheet", props) }));
jest.mock("../src/api/media", () => ({ STORY_VIDEO_BUFFER: {}, getMedia: jest.fn(async () => ({ kind: "photo" })) }));
jest.mock("../src/api/stories", () => ({ mediaFileUrl: (id: string) => `https://api.test/media/${id}` }));
let mockStory: Record<string, unknown> = {};
jest.mock("../src/api/highlights", () => ({
  getHighlightDetail: jest.fn(async () => ({ highlight: { id: "h1", title: "Goa", ownerId: "u-asha", items: [{ storyId: "s1", mediaId: "m-s1", position: 0, addedAt: "" }] } })),
  getHighlightItemDetail: jest.fn(async () => ({ story: mockStory })),
  updateHighlight: jest.fn(),
  deleteHighlight: jest.fn(),
}));
jest.mock("../src/api/engagement", () => ({ likeStory: jest.fn(async () => undefined), unlikeStory: jest.fn(async () => undefined), shareStory: jest.fn(async () => undefined) }));

let tree: ReactTestRenderer;
const flush = async () => { for (let i = 0; i < 5; i++) await act(async () => { await Promise.resolve(); }); };
const byLabel = (label: string) => tree.root.findAll((n: ReactTestInstance) => typeof n.props.onPress === "function" && n.props.accessibilityLabel === label);
async function open(story: Record<string, unknown>): Promise<void> {
  mockStory = { id: "s1", ownerId: "u-asha", overlays: [], drawing: [], filter: "original", crop: { zoom: 1, offsetX: 0, offsetY: 0 }, audience: "public", allowComments: "everyone", allowSharing: true, likeCount: 2, commentCount: 1, viewerHasLiked: false, ...story };
  await act(async () => {
    tree = create(
      <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}>
        <HighlightViewerScreen route={{ key: "v", name: "HighlightViewer", params: { highlightId: "h1", title: "Goa", ownerUsername: "asha" } } as never} navigation={{ navigate: jest.fn(), goBack: jest.fn() } as never} />
      </SafeAreaProvider>,
    );
  });
  await flush();
}
afterEach(async () => { await act(async () => tree?.unmount()); jest.clearAllMocks(); });

test("like (and unlike) a Highlight's Story, with its count", async () => {
  await open({});
  await act(async () => byLabel("Like")[0]!.props.onPress());
  expect(engagementApi.likeStory).toHaveBeenCalledWith("s1", "token");
  expect(byLabel("Unlike")).toHaveLength(1);
  await act(async () => byLabel("Unlike")[0]!.props.onPress());
  expect(engagementApi.unlikeStory).toHaveBeenCalledWith("s1", "token");
});

test("comments open on the Story, and Share sends the profile link", async () => {
  await open({});
  await act(async () => byLabel("Add a comment")[0]!.props.onPress());
  const sheet = tree.root.find((n: ReactTestInstance) => String(n.type) === "CommentsSheet");
  expect(sheet.props.visible).toBe(true);
  expect(sheet.props.storyId).toBe("s1");
  const share = jest.spyOn(Share, "share").mockResolvedValue({ action: Share.sharedAction } as never);
  await act(async () => byLabel("Share")[0]!.props.onPress());
  await flush();
  expect(share.mock.calls[0]![0].message).toContain("https://katkee.com/u/asha?id=u-asha");
  expect(engagementApi.shareStory).toHaveBeenCalledWith("s1", "token");
});

test("no Comment where comments are off, no Share for a followers-only Story", async () => {
  await open({ allowComments: "disabled", audience: "followers" });
  expect(byLabel("Like")).toHaveLength(1);
  expect(byLabel("Add a comment")).toHaveLength(0);
  expect(byLabel("Share")).toHaveLength(0);
});
