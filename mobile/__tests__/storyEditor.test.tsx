import React from "react";
import { Alert, BackHandler, Modal, StyleSheet, Text } from "react-native";
import * as uploadQueue from "../src/state/uploadQueue";
import * as usersApi from "../src/api/users";
import { snapToCentre } from "../src/components/DraggableCanvasObject";
import { PlacedOverlay } from "../src/components/PlacedOverlay";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { StoryEditorScreen } from "../src/screens/create/StoryEditorScreen";
import { FILTER_PREVIEWS } from "../src/models/filterPreviews";

jest.mock("../src/state/AuthContext", () => ({ useAuth: () => ({ accessToken: "token", user: { id: "me", username: "rahul" } }) }));
jest.mock("@react-navigation/native", () => ({ ...jest.requireActual("@react-navigation/native"), useNavigation: () => ({ reset: jest.fn(), navigate: jest.fn() }), useFocusEffect: (effect: () => () => void) => require("react").useEffect(effect, []) }));
jest.mock("../src/analytics/analytics", () => ({ track: jest.fn() }));

type Point = [number, number];
function touchEvent(points: Point[], at: number) {
  const touches = points.map(([x, y], i) => ({ identifier: i, pageX: x, pageY: y, locationX: x, locationY: y, timestamp: at }));
  const touchBank = touches.map((t) => ({
    touchActive: true, startPageX: t.pageX, startPageY: t.pageY, startTimeStamp: at, currentPageX: t.pageX, currentPageY: t.pageY,
    currentTimeStamp: at, previousPageX: t.pageX, previousPageY: t.pageY, previousTimeStamp: at,
  }));
  return { nativeEvent: { ...touches[0], touches, changedTouches: touches }, touchHistory: { numberActiveTouches: touches.length, indexOfSingleActiveTouch: 0, mostRecentTimeStamp: at, touchBank } };
}

let tree: ReactTestRenderer;
const flush = async () => { for (let i = 0; i < 6; i++) await act(async () => { await Promise.resolve(); }); };
const g = globalThis as unknown as { __haptics: string[] };
const navigation = { goBack: jest.fn(), replace: jest.fn(), reset: jest.fn() };

async function open() {
  await act(async () => {
    tree = create(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      <StoryEditorScreen navigation={navigation as any} route={{ key: "e", name: "StoryEditor", params: { mediaUri: "file:///v.mp4", kind: "video", mimeType: "video/mp4", width: 1080, height: 1920 } } as any} />,
    );
  });
  // The media area's size comes from layout.
  const media = tree.root.findAll((n: ReactTestInstance) => typeof n.type === "string" && typeof n.props.onLayout === "function")[0]!;
  await act(async () => media.props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 400, height: 800 } } }));
  await flush();
}
const canvas = () => tree.root.find((n: ReactTestInstance) => typeof n.type === "string" && n.props.collapsable === false && n.props.importantForAccessibility === "no-hide-descendants");
const textModalOpen = () => tree.root.findAllByType(Modal).some((m) => m.props.visible && m.findAll((n: ReactTestInstance) => n.props.placeholder !== undefined && /type|text/i.test(String(n.props.placeholder))).length > 0);
// The filter's name shows briefly on the photo when it changes (there's no strip of filters).
const filterToast = () => tree.root.findAllByType(Text).map((t) => [t.props.children].flat().join("")).filter((t) => FILTER_PREVIEWS.some((f) => f.name === t) || t === "Swipe for filters");

beforeEach(() => {
  g.__haptics = [];
});
afterEach(async () => {
  await act(async () => tree.unmount());
});

describe("Story editor canvas", () => {
  it("changes the filter while the finger is still swiping, one step per swipe distance", async () => {
    await open();
    // The first time, a hint says filters are a swipe away.
    expect(filterToast()).toEqual(["Swipe for filters"]);
    const c = canvas();
    act(() => c.props.onResponderGrant(touchEvent([[300, 400]], 1)));
    act(() => c.props.onResponderMove(touchEvent([[240, 402]], 2)));
    expect(filterToast()).toEqual([FILTER_PREVIEWS[1]!.name]);
    act(() => canvas().props.onResponderMove(touchEvent([[180, 404]], 3)));
    act(() => canvas().props.onResponderRelease(touchEvent([[180, 404]], 4)));
    expect(filterToast()).toEqual([FILTER_PREVIEWS[2]!.name]);
    expect(g.__haptics.filter((h) => h === "selection")).toHaveLength(2);
    expect(textModalOpen()).toBe(false);
  });

  it("opens the text tool with one tap on the photo", async () => {
    await open();
    act(() => canvas().props.onResponderGrant(touchEvent([[200, 300]], 1)));
    act(() => canvas().props.onResponderRelease(touchEvent([[201, 301]], 2)));
    expect(textModalOpen()).toBe(true);
  });
});

describe("sharing from the editor, like Instagram", () => {
  beforeEach(() => jest.restoreAllMocks());
  const press = (label: string) => act(async () => tree.root.find((n: ReactTestInstance) => typeof n.props.onPress === "function" && n.props.accessibilityLabel === label).props.onPress());

  it("shares to Your story in one tap, to everyone or followers only", async () => {
    const enqueue = jest.spyOn(uploadQueue, "enqueueUpload").mockResolvedValue({} as never);
    jest.spyOn(usersApi, "listCloseFriends").mockResolvedValue({ closeFriends: [], limit: 1, offset: 0 });
    await open();
    await press("Share to Your story, everyone");
    expect(enqueue.mock.calls[0]![4]).toMatchObject({ audience: "public" });
    await act(async () => tree.unmount());
    enqueue.mockClear();
    await open();
    await press("Your story for followers only");
    await press("Share to Your story, followers only");
    expect(enqueue.mock.calls[0]![4]).toMatchObject({ audience: "followers" });
  });

  it("asks you to add people before sharing to an empty Close Friends list, and shares once you have some", async () => {
    const enqueue = jest.spyOn(uploadQueue, "enqueueUpload").mockResolvedValue({} as never);
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
    jest.spyOn(usersApi, "listCloseFriends").mockResolvedValue({ closeFriends: [], limit: 1, offset: 0 });
    await open();
    await press("Share to Close Friends");
    expect(alert.mock.calls.at(-1)![0]).toBe("No Close Friends yet");
    expect(enqueue).not.toHaveBeenCalled();
    await act(async () => tree.unmount());
    jest.spyOn(usersApi, "listCloseFriends").mockResolvedValue({ closeFriends: [{ id: "u1", username: "asha", displayName: "Asha", avatarMediaId: null, addedAt: "" }], limit: 1, offset: 0 });
    await open();
    await press("Share to Close Friends");
    expect(enqueue.mock.calls[0]![4]).toMatchObject({ audience: "close_friends" });
  });
});

describe("placing text and stickers", () => {
  it("snaps to the middle when dragged close to it", () => {
    expect(snapToCentre(0.51, 0.3, 400, 800)).toEqual({ x: 0.5, y: 0.3, guides: { x: true, y: false } });
    expect(snapToCentre(0.6, 0.505, 400, 800)).toEqual({ x: 0.6, y: 0.5, guides: { x: false, y: true } });
  });

  it("centres each one on its spot once measured", async () => {
    let placed!: ReactTestRenderer;
    await act(async () => {
      placed = create(<PlacedOverlay overlay={{ x: 0.5, y: 0.5, scale: 1, rotation: 0, zIndex: 1 }} containerWidth={400} containerHeight={800}><Text>Hi</Text></PlacedOverlay>);
    });
    const view = () => placed.root.findAll((n: ReactTestInstance) => typeof n.type === "string" && typeof n.props.onLayout === "function")[0]!;
    expect(StyleSheet.flatten(view().props.style).opacity).toBe(0);
    await act(async () => view().props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 100, height: 40 } } }));
    expect(StyleSheet.flatten(view().props.style)).toMatchObject({ left: 150, top: 380, opacity: 1 });
  });
});

describe("discarding", () => {
  it("asks before throwing edits away, on the close button and Android's back button, then returns to the camera", async () => {
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
    const listeners: Array<() => boolean> = [];
    jest.spyOn(BackHandler, "addEventListener").mockImplementation((_e, fn) => { listeners.push(fn as () => boolean); return { remove: jest.fn() }; });
    await open();
    // Add text so there is something to lose.
    await act(async () => canvas().props.onResponderGrant(touchEvent([[200, 300]], 1)));
    await act(async () => canvas().props.onResponderRelease(touchEvent([[200, 300]], 2)));
    const input = tree.root.find((n: ReactTestInstance) => n.props.placeholder === "Type something…");
    await act(async () => input.props.onChangeText("Hello"));
    await act(async () => tree.root.find((n: ReactTestInstance) => typeof n.props.onPress === "function" && n.findAll((c) => c.props.children === "Done").length > 0).props.onPress());
    expect(listeners.at(-1)!()).toBe(true);
    expect(alert.mock.calls.at(-1)![0]).toBe("Discard Story?");
    const discard = (alert.mock.calls.at(-1)![2] as Array<{ text: string; onPress?: () => void }>).find((b) => b.text === "Discard")!;
    await act(async () => discard.onPress!());
    expect(navigation.reset).toHaveBeenCalledWith({ index: 0, routes: [{ name: "Camera" }] });
    expect(navigation.goBack).not.toHaveBeenCalled();
  });
});
