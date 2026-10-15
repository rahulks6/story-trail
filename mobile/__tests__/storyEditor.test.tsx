import React from "react";
import { Modal, Text } from "react-native";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { StoryEditorScreen } from "../src/screens/create/StoryEditorScreen";
import { FILTER_PREVIEWS } from "../src/models/filterPreviews";

jest.mock("../src/state/AuthContext", () => ({ useAuth: () => ({ accessToken: "token", user: { id: "me", username: "rahul" } }) }));
jest.mock("@react-navigation/native", () => ({ ...jest.requireActual("@react-navigation/native"), useNavigation: () => ({ reset: jest.fn() }) }));
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
const navigation = { goBack: jest.fn(), replace: jest.fn() };

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
