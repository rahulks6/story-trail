import React from "react";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { Alert, AppState, Image, Modal } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { HighlightViewerScreen } from "../src/screens/highlight/HighlightViewerScreen";
import { HighlightEditorScreen } from "../src/screens/highlight/HighlightEditorScreen";
import * as highlightsApi from "../src/api/highlights";
import * as mediaApi from "../src/api/media";
import { timeNativeAnimations } from "./helpers/nativeAnimations";

// Managing your own Highlight: from the Highlight itself (⋯) and in the editor.
jest.mock("../src/state/AuthContext", () => ({ useAuth: () => ({ accessToken: "token", user: { id: "u-me", username: "me" } }) }));
let mockFocused = true;
const mockPrevent = { enabled: false, callback: null as null | ((e: { data: { action: unknown } }) => void) };
jest.mock("@react-navigation/native", () => ({
  ...jest.requireActual("@react-navigation/native"),
  usePreventRemove: (enabled: boolean, callback: (e: { data: { action: unknown } }) => void) => {
    mockPrevent.enabled = enabled;
    mockPrevent.callback = callback;
  },
  useIsFocused: () => mockFocused,
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
  setHighlightCover: jest.fn(async () => ({})),
}));
const api = highlightsApi as jest.Mocked<typeof highlightsApi>;

let tree: ReactTestRenderer;
const navigation = { navigate: jest.fn(), goBack: jest.fn(), pop: jest.fn(), getState: jest.fn(), dispatch: jest.fn() };
afterEach(async () => {
  await act(async () => tree?.unmount());
  jest.clearAllMocks();
});
const byLabel = (label: string) => tree.root.find((n: ReactTestInstance) => typeof n.props.onPress === "function" && n.props.accessibilityLabel === label);
async function choose(label: string): Promise<void> {
  await act(async () => byLabel(label).props.onPress());
  await act(async () => tree.root.findAllByType(Modal).find((m) => typeof m.props.onDismiss === "function")!.props.onDismiss());
}
const viewer = () => (
  <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}>
    <HighlightViewerScreen route={{ key: "v", name: "HighlightViewer", params: { highlightId: "h1", title: "Trips" } } as never} navigation={navigation as never} />
  </SafeAreaProvider>
);
async function openViewer(storyIds: string[]): Promise<void> {
  api.getHighlightDetail.mockResolvedValue({ highlight: highlight(storyIds) } as never);
  await act(async () => {
    tree = create(viewer());
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

test("the editor shows the cover and lets you pick any of the Highlight's Stories as it", async () => {
  api.getHighlightDetail.mockResolvedValue({ highlight: highlight(["s1", "s2"]) } as never);
  api.updateHighlight.mockResolvedValue({ highlight: highlight(["s1", "s2"]) } as never);
  await act(async () => {
    tree = create(
      <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}>
        <HighlightEditorScreen route={{ key: "e", name: "HighlightEditor", params: { highlightId: "h1", chooseCover: true } } as never} navigation={navigation as never} />
      </SafeAreaProvider>,
    );
  });
  await act(async () => { await Promise.resolve(); });
  // Opened from "Change cover": the choice is already up.
  const picker = tree.root.findAllByType(Modal).find((m) => m.props.visible && m.findAll((n) => n.props.children === "Choose a cover").length > 0);
  expect(picker).toBeDefined();
  const options = picker!.findAll((n: ReactTestInstance) => typeof n.props.onPress === "function" && /cover/.test(n.props.accessibilityLabel ?? ""));
  expect(options.map((o) => o.props.accessibilityLabel)).toEqual(["Current cover", "Use as cover"]);
  await act(async () => options[1]!.props.onPress());
  const save = tree.root.find((n: ReactTestInstance) => typeof n.props.onPress === "function" && n.findAll((c) => c.props.children === "Save").length > 0);
  await act(async () => save.props.onPress());
  expect(api.updateHighlight).toHaveBeenCalledWith("h1", expect.objectContaining({ coverStoryId: "s2" }), "token");
});

test("a new Highlight gets the cover you chose, and a tidy name", async () => {
  api.createHighlight.mockResolvedValue({ highlight: { ...highlight(["s1", "s2"]), id: "h-new" } } as never);
  await act(async () => {
    tree = create(
      <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}>
        <HighlightEditorScreen route={{ key: "e", name: "HighlightEditor", params: { initialStoryIds: ["s1", "s2"] } } as never} navigation={navigation as never} />
      </SafeAreaProvider>,
    );
  });
  await act(async () => { await Promise.resolve(); });
  const { TextInput } = jest.requireActual("react-native");
  await act(async () => tree.root.findByType(TextInput).props.onChangeText("  Summer   trip "));
  await act(async () => byLabel("Change cover").props.onPress());
  await act(async () => byLabel("Use as cover").props.onPress());
  const create_ = tree.root.find((n: ReactTestInstance) => typeof n.props.onPress === "function" && n.findAll((c) => c.props.children === "Create").length > 0);
  await act(async () => create_.props.onPress());
  expect(api.createHighlight).toHaveBeenCalledWith({ title: "Summer trip", storyIds: ["s1", "s2"] }, "token");
  expect((api as unknown as { setHighlightCover: jest.Mock }).setHighlightCover).toHaveBeenCalledWith("h-new", "s2", "token");
});

test("a cover that fails to set doesn't keep the editor open, so Create can't make a second Highlight", async () => {
  const alert = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
  api.createHighlight.mockResolvedValue({ highlight: { ...highlight(["s1", "s2"]), id: "h-new" } } as never);
  (api as unknown as { setHighlightCover: jest.Mock }).setHighlightCover.mockRejectedValueOnce(new Error("offline"));
  await act(async () => {
    tree = create(
      <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}>
        <HighlightEditorScreen route={{ key: "e", name: "HighlightEditor", params: { initialStoryIds: ["s1", "s2"] } } as never} navigation={navigation as never} />
      </SafeAreaProvider>,
    );
  });
  await act(async () => { await Promise.resolve(); });
  const { TextInput } = jest.requireActual("react-native");
  await act(async () => tree.root.findByType(TextInput).props.onChangeText("Trip"));
  await act(async () => byLabel("Change cover").props.onPress());
  await act(async () => byLabel("Use as cover").props.onPress());
  const create_ = () => tree.root.find((n: ReactTestInstance) => typeof n.props.onPress === "function" && n.findAll((c) => c.props.children === "Create").length > 0);
  await act(async () => create_().props.onPress());
  expect(api.createHighlight).toHaveBeenCalledTimes(1);
  expect(alert).toHaveBeenCalledWith("Highlight created", expect.stringContaining("Couldn't set the cover"));
  expect(navigation.goBack).toHaveBeenCalledTimes(1);
  alert.mockRestore();
});

test("leaving a new Highlight part-made asks first; Create leaves without asking", async () => {
  const alert = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
  api.createHighlight.mockResolvedValue({ highlight: { ...highlight(["s1"]), id: "h-new" } } as never);
  await act(async () => {
    tree = create(
      <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}>
        <HighlightEditorScreen route={{ key: "e", name: "HighlightEditor", params: { initialStoryIds: ["s1"] } } as never} navigation={navigation as never} />
      </SafeAreaProvider>,
    );
  });
  await act(async () => { await Promise.resolve(); });
  expect(mockPrevent.enabled).toBe(false); // nothing typed yet
  const { TextInput } = jest.requireActual("react-native");
  await act(async () => tree.root.findByType(TextInput).props.onChangeText("Trip"));
  expect(mockPrevent.enabled).toBe(true);
  act(() => mockPrevent.callback!({ data: { action: { type: "GO_BACK" } } }));
  const [title, , buttons] = alert.mock.calls.at(-1)!;
  expect(title).toBe("Discard changes?");
  act(() => (buttons as Array<{ text: string; onPress?: () => void }>).find((b) => b.text === "Discard")!.onPress!());
  expect(navigation.dispatch).toHaveBeenCalledWith({ type: "GO_BACK" });
  const create_ = tree.root.find((n: ReactTestInstance) => typeof n.props.onPress === "function" && n.findAll((c) => c.props.children === "Create").length > 0);
  await act(async () => create_.props.onPress());
  expect(mockPrevent.enabled).toBe(false);
  expect(navigation.goBack).toHaveBeenCalledTimes(1);
  alert.mockRestore();
});

test("the archive grid's three columns always fit the screen", async () => {
  await act(async () => {
    tree = create(
      <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 320, height: 640 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}>
        <HighlightEditorScreen route={{ key: "e", name: "HighlightEditor", params: {} } as never} navigation={navigation as never} />
      </SafeAreaProvider>,
    );
  });
  await act(async () => { await Promise.resolve(); });
  const { StyleSheet, Dimensions } = jest.requireActual("react-native");
  const thumbs = tree.root.findAllByType(Image).map((i) => StyleSheet.flatten(i.props.style)).filter((st) => typeof st.width === "number");
  expect(thumbs.length).toBeGreaterThan(0);
  // Each cell: the thumb plus 2 on each side; the grid has 16 on each side.
  const width = Dimensions.get("window").width;
  for (const st of thumbs) expect(3 * (st.width + 4) + 32).toBeLessThanOrEqual(width);
});

test("with the editor pushed on top, the viewer pauses: its video stops, and its timer can't move on or close the editor", async () => {
  jest.useFakeTimers();
  timeNativeAnimations();
  (AppState as { currentState: string }).currentState = "active";
  mockFocused = true;
  (mediaApi.getMedia as jest.Mock).mockResolvedValue({ kind: "video" });
  try {
    await openViewer(["s1"]);
    for (let i = 0; i < 3; i++) await act(async () => { await Promise.resolve(); });
    const video = () => tree.root.find((n: ReactTestInstance) => (n.type as unknown) === "Video");
    expect(video().props.paused).toBe(false);
    await act(async () => video().props.onLoad({ duration: 4 }));
    await act(async () => { jest.advanceTimersByTime(2_000); });
    // "Edit Highlight": the editor covers the viewer.
    mockFocused = false;
    await act(async () => tree.update(viewer()));
    expect(video().props.paused).toBe(true);
    await act(async () => { jest.advanceTimersByTime(10_000); });
    expect(navigation.goBack).not.toHaveBeenCalled();
    // Back on the viewer: it carries on from where it was (about 2 of 4 seconds left), then closes.
    mockFocused = true;
    await act(async () => tree.update(viewer()));
    expect(video().props.paused).toBe(false);
    await act(async () => { jest.advanceTimersByTime(1_500); });
    expect(navigation.goBack).not.toHaveBeenCalled();
    await act(async () => { jest.advanceTimersByTime(1_000); });
    expect(navigation.goBack).toHaveBeenCalledTimes(1);
  } finally {
    (mediaApi.getMedia as jest.Mock).mockResolvedValue({ kind: "photo" });
    mockFocused = true;
    await act(async () => tree?.unmount());
    jest.useRealTimers();
  }
});
