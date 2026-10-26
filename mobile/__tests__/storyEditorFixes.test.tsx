import React from "react";
import { Alert, AppState, Linking, PermissionsAndroid, Platform, StyleSheet, Text } from "react-native";
import Geolocation from "@react-native-community/geolocation";
import * as visionCamera from "react-native-vision-camera";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { DraggableCanvasObject } from "../src/components/DraggableCanvasObject";
import { StickerSheet } from "../src/components/StickerSheet";
import { CameraScreen } from "../src/screens/create/CameraScreen";
import { shareErrorMessage } from "../src/screens/create/StoryEditorScreen";
import { ApiError } from "../src/api/client";
import type { Overlay } from "../src/models/storyDraft";
import type { Placement } from "../src/models/canvasGestures";

jest.mock("../src/state/AuthContext", () => ({ useAuth: () => ({ accessToken: "token", user: { id: "me", username: "rahul" } }) }));
jest.mock("@react-navigation/native", () => ({ ...jest.requireActual("@react-navigation/native"), useIsFocused: () => true }));

type Point = [number, number];
function touchEvent(points: Point[], at: number) {
  const touches = points.map(([x, y], i) => ({ identifier: i, pageX: x, pageY: y, locationX: x, locationY: y, timestamp: at }));
  const touchBank = touches.map((t) => ({
    touchActive: true, startPageX: t.pageX, startPageY: t.pageY, startTimeStamp: at, currentPageX: t.pageX, currentPageY: t.pageY,
    currentTimeStamp: at, previousPageX: t.pageX, previousPageY: t.pageY, previousTimeStamp: at,
  }));
  return { nativeEvent: { ...touches[0], touches, changedTouches: touches }, touchHistory: { numberActiveTouches: touches.length, indexOfSingleActiveTouch: 0, mostRecentTimeStamp: at, touchBank } };
}
const g = globalThis as unknown as { __camera: Record<string, unknown>; __picker: { result: unknown } };
const flush = async () => { for (let i = 0; i < 6; i++) await act(async () => { await Promise.resolve(); }); };
let tree: ReactTestRenderer;
afterEach(async () => {
  await act(async () => tree?.unmount());
  jest.restoreAllMocks();
});

describe("dragging an object commits once, when the finger lifts", () => {
  let overlay: Overlay;
  const onChange = jest.fn((id: string, patch: Partial<Overlay>) => { overlay = { ...overlay, ...patch } as Overlay; });
  const handlers = { onTouchStart: jest.fn(), onTap: jest.fn(), onOpenControls: jest.fn(), onDragStateChange: jest.fn(), onOverTrashChange: jest.fn(), onDeleted: jest.fn() };
  let show: ((p: Placement | null) => void) | null = null;
  const registerLive = jest.fn((_id: string, fn: ((p: Placement | null) => void) | null) => { show = fn; });
  const render = () => (
    <DraggableCanvasObject overlay={overlay} containerWidth={400} containerHeight={800} isOverTrash={() => false} onChange={onChange} registerLive={registerLive} {...handlers} />
  );
  const view = () => tree.root.find((n: ReactTestInstance) => typeof n.type === "string" && typeof n.props.onResponderGrant === "function");
  const left = () => StyleSheet.flatten(view().props.style).left as number;

  beforeEach(async () => {
    onChange.mockClear();
    overlay = { id: "t1", type: "text", x: 0.25, y: 0.25, scale: 1, rotation: 0, zIndex: 1, properties: { text: "Hi", font: "classic", color: "#FFFFFF", background: "none", align: "center" } } as unknown as Overlay;
    await act(async () => { tree = create(render()); });
    await act(async () => view().props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 100, height: 40 } } }));
  });

  it("follows the finger without telling the editor until it lifts", () => {
    act(() => view().props.onResponderGrant(touchEvent([[100, 100]], 1)));
    act(() => view().props.onResponderMove(touchEvent([[140, 100]], 2)));
    act(() => view().props.onResponderMove(touchEvent([[180, 100]], 3)));
    // It moved on screen (80 px), but nothing was committed yet.
    expect(left()).toBeCloseTo(0.25 * 400 + 80 - 50);
    expect(onChange).not.toHaveBeenCalled();
    act(() => view().props.onResponderRelease(touchEvent([[180, 100]], 4)));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]![0]).toBe("t1");
    expect(overlay.x).toBeCloseTo(0.25 + 80 / 400);
    expect(overlay.y).toBeCloseTo(0.25);
  });

  it("shows a live place the editor sends (its two-finger pinch on the photo)", () => {
    expect(registerLive).toHaveBeenCalledWith("t1", expect.any(Function));
    act(() => show!({ x: 0.5, y: 0.25, scale: 2, rotation: 0 }));
    expect(left()).toBeCloseTo(200 - 50);
    act(() => show!(null));
    expect(left()).toBeCloseTo(100 - 50);
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("why sharing failed", () => {
  it("says the queue's own reason, and blames the connection only for network failures", () => {
    expect(shareErrorMessage(new Error("This media is empty or exceeds the upload limit."))).toBe("This media is empty or exceeds the upload limit.");
    expect(shareErrorMessage(new Error("Finish or remove a pending upload before adding another."))).toBe("Finish or remove a pending upload before adding another.");
    expect(shareErrorMessage(new TypeError("Network request failed"))).toMatch(/check your connection/);
    expect(shareErrorMessage(new Error("ENOENT: no such file or directory, open '/x'"))).not.toMatch(/ENOENT/);
    expect(shareErrorMessage(new ApiError(413, "Too large."))).toBe("Too large.");
  });
});

describe("camera microphone", () => {
  const navigation = { replace: jest.fn(), goBack: jest.fn() };
  beforeEach(() => { (AppState as { currentState: string }).currentState = "active"; navigation.replace.mockClear(); });
  afterEach(() => { g.__camera.microphone = true; g.__picker.result = { didCancel: true }; });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const screen = () => <CameraScreen navigation={navigation as any} route={{ key: "Camera", name: "Camera" } as any} />;

  it("records with sound once the microphone is allowed in Settings", async () => {
    const output = jest.spyOn(visionCamera, "useVideoOutput");
    g.__camera.microphone = false;
    await act(async () => { tree = create(screen()); });
    await flush();
    expect(output.mock.calls.at(-1)![0]).toMatchObject({ enableAudio: false });
    // Back from Settings with the microphone allowed.
    g.__camera.microphone = true;
    await act(async () => tree.update(screen()));
    await flush();
    expect(output.mock.calls.at(-1)![0]).toMatchObject({ enableAudio: true });
  });

  it("says a video is too large to share before it's edited", async () => {
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
    g.__picker.result = { assets: [{ uri: "file:///big.mp4", type: "video/mp4", fileSize: 300 * 1024 * 1024 }] };
    await act(async () => { tree = create(screen()); });
    await flush();
    await act(async () => tree.root.find((n: ReactTestInstance) => typeof n.props.onPress === "function" && n.props.accessibilityLabel === "Choose from gallery").props.onPress());
    expect(alert.mock.calls.at(-1)![0]).toBe("Video too large");
    expect(navigation.replace).not.toHaveBeenCalled();
  });

  const pick = async (asset: Record<string, unknown>) => {
    g.__picker.result = { assets: [asset] };
    await act(async () => { tree = create(screen()); });
    await flush();
    await act(async () => tree.root.find((n: ReactTestInstance) => typeof n.props.onPress === "function" && n.props.accessibilityLabel === "Choose from gallery").props.onPress());
  };

  it("says a video is too long before it's edited (the server refuses it only after the upload)", async () => {
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
    await pick({ uri: "file:///long.mp4", type: "video/mp4", fileSize: 50 * 1024 * 1024, duration: 95 });
    expect(alert.mock.calls.at(-1)![0]).toBe("Video too long");
    expect(navigation.replace).not.toHaveBeenCalled();
    await act(async () => tree.unmount());
    await pick({ uri: "file:///ok.mp4", type: "video/mp4", fileSize: 50 * 1024 * 1024, duration: 60.2 });
    expect(navigation.replace).toHaveBeenCalledWith("StoryEditor", expect.objectContaining({ mediaUri: "file:///ok.mp4", kind: "video" }));
  });

  it("says an Android HEIC photo isn't supported before it's edited", async () => {
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
    await pick({ uri: "content://media/1", type: "image/heic", fileSize: 3 * 1024 * 1024 });
    expect(alert.mock.calls.at(-1)![0]).toBe("Photo format not supported");
    expect(navigation.replace).not.toHaveBeenCalled();
  });
});

describe("location sticker when location is off", () => {
  const original = Platform.OS;
  afterEach(() => { Platform.OS = original; });
  const openLocation = async () => {
    await act(async () => { tree = create(<StickerSheet visible onClose={jest.fn()} onAdd={jest.fn()} />); });
    await act(async () => tree.root.find((n: ReactTestInstance) => n.props.accessibilityRole === "tab" && typeof n.props.onPress === "function" && n.findAllByType(Text).some((t) => t.props.children === "Location")).props.onPress());
    await act(async () => tree.root.find((n: ReactTestInstance) => typeof n.props.onPress === "function" && n.findAllByType(Text).some((t) => t.props.children === "Use current location")).props.onPress());
    await flush();
  };
  const settingsButton = (alert: jest.SpyInstance) => (alert.mock.calls.at(-1)![2] as Array<{ text: string; onPress?: () => void }>).find((b) => b.text === "Open Settings")!;

  it("offers Settings after Android's \"don't ask again\"", async () => {
    Platform.OS = "android";
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
    const settings = jest.spyOn(Linking, "openSettings").mockResolvedValue(undefined);
    jest.spyOn(PermissionsAndroid, "request").mockResolvedValue(PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN);
    await openLocation();
    settingsButton(alert).onPress!();
    expect(settings).toHaveBeenCalled();
  });

  it("offers Settings when iOS says permission was denied", async () => {
    Platform.OS = "ios";
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
    (Geolocation.getCurrentPosition as jest.Mock).mockImplementationOnce((_ok: unknown, fail: (e: { code: number }) => void) => fail({ code: 1 }));
    await openLocation();
    expect(settingsButton(alert)).toBeTruthy();
  });
});
