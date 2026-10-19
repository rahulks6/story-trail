import React from "react";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { Alert, Image, Modal } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { HighlightViewerScreen } from "../src/screens/highlight/HighlightViewerScreen";
import { HighlightEditorScreen } from "../src/screens/highlight/HighlightEditorScreen";
import * as highlightsApi from "../src/api/highlights";

// Managing your own Highlight: from the Highlight itself (⋯) and in the editor.
jest.mock("../src/state/AuthContext", () => ({ useAuth: () => ({ accessToken: "token", user: { id: "u-me", username: "me" } }) }));
jest.mock("@react-navigation/native", () => ({
  ...jest.requireActual("@react-navigation/native"),
  useNavigation: () => ({ navigate: jest.fn() }),
  useFocusEffect: (effect: () => void) => require("react").useEffect(() => effect(), [effect]),
}));
jest.mock("../src/components/StoryOverlayLayer", () => ({
  StoryOverlayLayer: () => null,
  useContainerLayout: () => [{ width: 390, height: 844 }, () => undefined],
}));
jest.mock("../src/components/MusicPlayer", () => ({ MusicPlayer: () => null }));
jest.mock("../src/api/media", () => ({ getMedia: jest.fn(async () => ({ kind: "photo" })) }));
jest.mock("../src/api/stories", () => ({
  mediaFileUrl: (id: string) => `https://api.test/media/${id}`,
  // The Archive's first page doesn't reach the Highlight's oldest Story (s-old).
  getMyArchivedStories: jest.fn(async () => ({ stories: [{ id: "s1", mediaId: "m-s1" }, { id: "s2", mediaId: "m-s2" }] })),
}));
const item = (storyId: string, position: number) => ({ storyId, mediaId: `m-${storyId}`, position, addedAt: "2026-10-01" });
const highlight = (storyIds: string[]) => ({
  id: "h1", title: "Trips", ownerId: "u-me", coverMediaId: null, itemCount: storyIds.length, createdAt: "", updatedAt: "",
  items: storyIds.map(item),
});
jest.mock("../src/api/highlights", () => ({
  getHighlightDetail: jest.fn(),
  getHighlightItemDetail: jest.fn(async (_h: string, storyId: string) => ({ story: { id: storyId, overlays: [], drawing: [], filter: "original", crop: { zoom: 1, offsetX: 0, offsetY: 0 } } })),
  updateHighlight: jest.fn(),
  deleteHighlight: jest.fn(async () => undefined),
  createHighlight: jest.fn(),
}));
const api = highlightsApi as jest.Mocked<typeof highlightsApi>;

let tree: ReactTestRenderer;
const navigation = { navigate: jest.fn(), goBack: jest.fn(), pop: jest.fn(), getState: jest.fn() };
afterEach(async () => {
  await act(async () => tree?.unmount());
  jest.clearAllMocks();
});
const byLabel = (label: string) => tree.root.find((n: ReactTestInstance) => typeof n.props.onPress === "function" && n.props.accessibilityLabel === label);
async function choose(label: string): Promise<void> {
  await act(async () => byLabel(label).props.onPress());
  await act(async () => tree.root.findAllByType(Modal).find((m) => typeof m.props.onDismiss === "function")!.props.onDismiss());
}
async function openViewer(storyIds: string[]): Promise<void> {
  api.getHighlightDetail.mockResolvedValue({ highlight: highlight(storyIds) } as never);
  await act(async () => {
    tree = create(
      <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}>
        <HighlightViewerScreen route={{ key: "v", name: "HighlightViewer", params: { highlightId: "h1", title: "Trips" } } as never} navigation={navigation as never} />
      </SafeAreaProvider>,
    );
  });
  await act(async () => { await Promise.resolve(); });
}

test("from the Highlight's ⋯ you can remove the Story on screen; the rest stay, in order", async () => {
  await openViewer(["s1", "s2", "s3"]);
  await act(async () => byLabel("Next item").props.onPress());
  api.updateHighlight.mockResolvedValue({ highlight: highlight(["s1", "s3"]) } as never);
  await act(async () => byLabel("Highlight options").props.onPress());
  await choose("Remove this Story from the Highlight");
  expect(api.updateHighlight).toHaveBeenCalledWith("h1", { storyIds: ["s1", "s3"] }, "token");
  // Two Stories left, and the viewer moves on to the next one.
  expect(tree.root.findAll((n: ReactTestInstance) => n.props.accessibilityLabel === "Next item" && typeof n.props.onPress === "function")).toHaveLength(1);
  const shown = tree.root.findAllByType(Image).map((i) => (i.props.source as { uri: string }).uri);
  expect(shown).toContain("https://api.test/media/m-s3");
});

test("removing a Highlight's last Story deletes the Highlight, after asking", async () => {
  const alert = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
  await openViewer(["s1"]);
  await act(async () => byLabel("Highlight options").props.onPress());
  await choose("Remove this Story from the Highlight");
  expect(api.updateHighlight).not.toHaveBeenCalled();
  const buttons = alert.mock.calls[0]![2] as Array<{ text: string; onPress?: () => void }>;
  await act(async () => buttons.find((b) => b.text === "Delete")!.onPress!());
  expect(api.deleteHighlight).toHaveBeenCalledWith("h1", "token");
  expect(navigation.goBack).toHaveBeenCalled();
  alert.mockRestore();
});

test("the editor shows and keeps a Highlight's Stories from further back in the Archive", async () => {
  api.getHighlightDetail.mockResolvedValue({ highlight: highlight(["s-old", "s1"]) } as never);
  api.updateHighlight.mockResolvedValue({ highlight: highlight(["s-old", "s1"]) } as never);
  await act(async () => {
    tree = create(
      <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}>
        <HighlightEditorScreen route={{ key: "e", name: "HighlightEditor", params: { highlightId: "h1" } } as never} navigation={navigation as never} />
      </SafeAreaProvider>,
    );
  });
  await act(async () => { await Promise.resolve(); });
  const thumbs = tree.root.findAllByType(Image).map((i) => (i.props.source as { uri: string }).uri);
  expect(thumbs).toContain("https://api.test/media/m-s-old");
  const save = tree.root.find((n: ReactTestInstance) => typeof n.props.onPress === "function" && n.findAll((c) => c.props.children === "Save").length > 0);
  await act(async () => save.props.onPress());
  expect(api.updateHighlight).toHaveBeenCalledWith("h1", expect.objectContaining({ storyIds: ["s-old", "s1"] }), "token");
});
