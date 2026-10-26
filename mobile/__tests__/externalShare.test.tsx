// Sharing your own Story to other apps as the picture or video itself, with a small Katkee mark;
// anyone else's Story keeps the link-only choices.
import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import * as RNFS from "@dr.pogodin/react-native-fs";
import Share from "react-native-share";
import { captureRef } from "react-native-view-shot";
import { ShareSheet } from "../src/components/ShareSheet";
import { ActionSheet } from "../src/components/ActionSheet";
import { StoryShareCard, type ShareCardStory } from "../src/components/StoryShareCard";
import { ExternalShareModal } from "../src/components/ExternalShareModal";
import { API_BASE_URL } from "../src/api/client";
import { uploadStoryOverlay } from "../src/api/media";
import { getStoryExport, startStoryExport } from "../src/api/stories";
import { track } from "../src/analytics/analytics";

jest.mock("../src/state/AuthContext", () => ({ useAuth: () => ({ accessToken: "token" }) }));
jest.mock("../src/api/engagement", () => ({ shareStory: jest.fn().mockResolvedValue(undefined) }));
jest.mock("../src/components/Toast", () => ({ showToast: jest.fn() }));
jest.mock("../src/analytics/analytics", () => ({ track: jest.fn() }));
jest.mock("../src/api/media", () => ({ ...jest.requireActual("../src/api/media"), uploadStoryOverlay: jest.fn() }));
jest.mock("../src/api/stories", () => ({ ...jest.requireActual("../src/api/stories"), startStoryExport: jest.fn(), getStoryExport: jest.fn() }));

const STORY = "0f3c2b1a-1111-4222-8333-444455556666";
const OWNER = "9a8b7c6d-1111-4222-8333-444455556666";

const story = (kind: "photo" | "video"): ShareCardStory => ({
  kind,
  imageSource: { uri: "https://cdn.example/display.jpg" },
  crop: { zoom: 1, offsetX: 0, offsetY: 0 },
  overlays: [{ id: "t1", type: "text", x: 0.5, y: 0.4, scale: 1, rotation: 0, zIndex: 1, properties: { text: "Hello", style: "Clean", color: "#FFFFFF", backgroundColor: null, align: "center", fontSize: 28 } }] as ShareCardStory["overlays"],
  drawing: [],
  filter: "Original",
  filterApplied: true,
});

async function render(props: Partial<React.ComponentProps<typeof ShareSheet>> = {}): Promise<ReactTestRenderer> {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<ShareSheet visible storyId={STORY} ownerUsername="asha_k" isPublic onClose={jest.fn()} onSendToUser={jest.fn()} {...props} />);
  });
  return tree;
}
const actions = (tree: ReactTestRenderer) => (tree.root.findByType(ActionSheet).props.groups as Array<Array<{ label: string; onPress: () => void }>>)[0]!;
const press = (tree: ReactTestRenderer, label: string) => act(async () => actions(tree).find((a) => a.label === label)!.onPress());
type Node = ReactTestRenderer["root"];
const textsIn = (root: Node) => root.findAll((n) => (n.type as unknown) === "Text").map((n) => [n.props.children].flat().join(""));
const texts = (tree: ReactTestRenderer) => textsIn(tree.root);
/** A button of the progress panel (the action sheet has its own Cancel). */
const panelButton = (tree: ReactTestRenderer, label: string) =>
  tree.root.findByType(ExternalShareModal).findAll((n) => n.props.accessibilityRole === "button" && typeof n.props.onPress === "function" && textsIn(n).includes(label))[0]!;

/** Runs timers and the promises they release, a step at a time. */
async function advance(ms: number, step = 50) {
  for (let t = 0; t < ms; t += step) {
    await act(async () => { jest.advanceTimersByTime(step); });
  }
}

const MESSAGE = `@asha_k on Katkee: https://katkee.com/u/asha_k?id=${OWNER}\nhttps://katkee.com/s/${STORY}`;

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
});
afterEach(() => {
  jest.useRealTimers();
});

test("Share to other apps is offered on your own Story only", async () => {
  const other = await render();
  expect(actions(other).map((a) => a.label)).toEqual(["Send in Katkee", "Share via…", "Copy link"]);
  const own = await render({ ownStory: { story: story("photo"), ownerId: OWNER } });
  expect(actions(own).map((a) => a.label)).toEqual(["Send in Katkee", "Share to other apps", "Share via…", "Copy link"]);
});

test("the share card carries the Story's text and the Katkee mark with your username and link", async () => {
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<StoryShareCard story={story("photo")} username="asha_k" mode="photo" />); });
  const all = texts(tree);
  expect(all).toEqual(expect.arrayContaining(["Hello", "@asha_k", "katkee.com/u/asha_k"]));
  expect(tree.root.findAllByProps({ testID: "share-watermark" }).length).toBeGreaterThan(0);
  // A video's layer is only what goes on top: no photo under it.
  await act(async () => { tree.update(<StoryShareCard story={story("video")} username="asha_k" mode="overlay" />); });
  expect(tree.root.findAllByProps({ testID: "share-card-image" })).toHaveLength(0);
});

test("a photo Story is saved as a JPEG and handed to the share sheet with your links, then removed", async () => {
  const busy = jest.fn();
  const tree = await render({ ownStory: { story: story("photo"), ownerId: OWNER }, onExternalShareChange: busy });
  await press(tree, "Share to other apps");
  expect(texts(tree)).toContain("Preparing photo…");
  expect(busy).toHaveBeenLastCalledWith(true); // the Story holds still meanwhile
  expect(captureRef).not.toHaveBeenCalled(); // not before the photo has loaded
  await act(async () => tree.root.findByProps({ testID: "share-card-image" }).props.onLoad());
  await advance(200);

  expect(captureRef).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ format: "jpg", width: 1080, height: 1920, result: "tmpfile" }));
  const [from, to] = (RNFS.moveFile as jest.Mock).mock.calls[0]!;
  expect(from).toBe("/tmp/capture.jpg");
  expect(to).toMatch(/^\/caches\/katkee-share-.+\.jpg$/);
  expect(Share.open).toHaveBeenCalledWith({ url: `file://${to}`, type: "image/jpeg", message: MESSAGE, failOnCancel: false });
  expect(RNFS.unlink).toHaveBeenCalledWith(to);
  expect(track).toHaveBeenCalledWith("story_shared_external", { kind: "photo" });
  expect(texts(tree)).not.toContain("Preparing photo…");
  expect(busy).toHaveBeenLastCalledWith(false);
});

test("a video Story: the overlay goes up, the server puts the video together, the app waits, downloads and shares it", async () => {
  (uploadStoryOverlay as jest.Mock).mockResolvedValue({ id: "overlay-1" });
  (startStoryExport as jest.Mock).mockResolvedValue({ id: "exp-1", status: "processing", expiresAt: "" });
  (getStoryExport as jest.Mock)
    .mockResolvedValueOnce({ id: "exp-1", status: "processing", expiresAt: "" })
    .mockResolvedValueOnce({ id: "exp-1", status: "ready", url: `/api/v1/stories/${STORY}/export/exp-1/file`, expiresAt: "" });
  const tree = await render({ ownStory: { story: story("video"), ownerId: OWNER }, isPublic: false });
  await press(tree, "Share to other apps");
  expect(texts(tree)).toContain("Preparing video…");
  await advance(4000);

  expect(captureRef).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ format: "png", width: 720, height: 1280 }));
  expect(uploadStoryOverlay).toHaveBeenCalledWith("file:///tmp/capture.png", "token");
  expect(RNFS.unlink).toHaveBeenCalledWith("/tmp/capture.png");
  expect(startStoryExport).toHaveBeenCalledWith(STORY, "overlay-1", "token");
  expect(getStoryExport).toHaveBeenCalledTimes(2);
  expect(RNFS.downloadFile).toHaveBeenCalledWith({
    fromUrl: `${API_BASE_URL}/api/v1/stories/${STORY}/export/exp-1/file`,
    toFile: "/caches/katkee-story-exp-1.mp4",
    headers: { Authorization: "Bearer token" },
  });
  // Not public: the profile link only.
  expect(Share.open).toHaveBeenCalledWith({ url: "file:///caches/katkee-story-exp-1.mp4", type: "video/mp4", message: `@asha_k on Katkee: https://katkee.com/u/asha_k?id=${OWNER}`, failOnCancel: false });
  expect(RNFS.unlink).toHaveBeenCalledWith("/caches/katkee-story-exp-1.mp4");
  expect(track).toHaveBeenCalledWith("story_shared_external", { kind: "video" });
});

test("a signed CDN link is downloaded without the sign-in token", async () => {
  (uploadStoryOverlay as jest.Mock).mockResolvedValue({ id: "overlay-2" });
  (startStoryExport as jest.Mock).mockResolvedValue({ id: "exp-2", status: "ready", url: "https://cdn.example/m/exp-2/export.mp4?Signature=x", expiresAt: "" });
  const tree = await render({ ownStory: { story: story("video"), ownerId: OWNER } });
  await press(tree, "Share to other apps");
  await advance(300);
  expect(RNFS.downloadFile).toHaveBeenCalledWith({ fromUrl: "https://cdn.example/m/exp-2/export.mp4?Signature=x", toFile: "/caches/katkee-story-exp-2.mp4" });
});

test("a failure says so calmly, with Try again", async () => {
  (uploadStoryOverlay as jest.Mock).mockResolvedValue({ id: "overlay-3" });
  (startStoryExport as jest.Mock).mockResolvedValue({ id: "exp-3", status: "processing", expiresAt: "" });
  (getStoryExport as jest.Mock).mockResolvedValue({ id: "exp-3", status: "failed", error: "We couldn't prepare this video. Try again.", expiresAt: "" });
  const tree = await render({ ownStory: { story: story("video"), ownerId: OWNER } });
  await press(tree, "Share to other apps");
  await advance(2000);
  expect(texts(tree)).toEqual(expect.arrayContaining(["Couldn't share your Story", "We couldn't prepare this video. Try again.", "Try again", "Close"]));
  expect(Share.open).not.toHaveBeenCalled();
  expect(track).not.toHaveBeenCalled();

  (getStoryExport as jest.Mock).mockResolvedValue({ id: "exp-3", status: "ready", url: "https://cdn.example/x.mp4", expiresAt: "" });
  await act(async () => panelButton(tree, "Try again").props.onPress());
  await advance(2000);
  expect(startStoryExport).toHaveBeenCalledTimes(2);
  expect(Share.open).toHaveBeenCalledTimes(1);
});

test("Cancel stops waiting for the video and shares nothing", async () => {
  (uploadStoryOverlay as jest.Mock).mockResolvedValue({ id: "overlay-4" });
  (startStoryExport as jest.Mock).mockResolvedValue({ id: "exp-4", status: "processing", expiresAt: "" });
  (getStoryExport as jest.Mock).mockResolvedValue({ id: "exp-4", status: "processing", expiresAt: "" });
  const tree = await render({ ownStory: { story: story("video"), ownerId: OWNER } });
  await press(tree, "Share to other apps");
  await advance(2000);
  await act(async () => panelButton(tree, "Cancel").props.onPress());
  const polls = (getStoryExport as jest.Mock).mock.calls.length;
  await advance(5000);
  expect((getStoryExport as jest.Mock).mock.calls.length).toBe(polls);
  expect(Share.open).not.toHaveBeenCalled();
  expect(texts(tree)).not.toContain("Preparing video…");
});
