import React from "react";
import { AppState } from "react-native";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { BOOMERANG_RECORD_MS, shutterLabel, shutterTap } from "../src/models/captureModes";
import { CameraScreen } from "../src/screens/create/CameraScreen";

jest.mock("@react-navigation/native", () => ({ ...jest.requireActual("@react-navigation/native"), useIsFocused: () => true }));

// A recorder that finishes with a file when stopped, like the native one.
const mockRecorder = { finish: null as null | ((path: string) => void), start: jest.fn(), stop: jest.fn() };
const mockCreateRecorder = jest.fn(async () => ({
  startRecording: async (onFinished: (path: string) => void) => {
    mockRecorder.start();
    mockRecorder.finish = onFinished;
  },
  stopRecording: async () => {
    mockRecorder.stop();
    mockRecorder.finish?.("/tmp/clip.mp4");
  },
}));
const g = globalThis as unknown as { __haptics: string[]; __camera: Record<string, unknown> };
g.__camera.videoOutput = { createRecorder: mockCreateRecorder };
let tree: ReactTestRenderer;
const navigation = { replace: jest.fn(), goBack: jest.fn() };
const flush = async () => { for (let i = 0; i < 6; i++) await act(async () => { await Promise.resolve(); }); };
const byLabel = (label: string) => tree.root.find((n: ReactTestInstance) => typeof n.type === "string" && n.props.accessibilityLabel === label);
const shutter = () => tree.root.find((n: ReactTestInstance) => typeof n.type === "string" && typeof n.props.onAccessibilityAction === "function" && n.props.accessibilityActions?.some((a: { name: string; label: string }) => a.name === "activate" && /photo|record|Boomerang/i.test(a.label)));
const activate = async () => { await act(async () => shutter().props.onAccessibilityAction({ nativeEvent: { actionName: "activate" } })); await flush(); };
const choose = async (label: string) => { await act(async () => tree.root.find((n: ReactTestInstance) => typeof n.props.onPress === "function" && n.props.accessibilityLabel === label).props.onPress()); };

beforeEach(() => {
  jest.useFakeTimers();
  (AppState as { currentState: string }).currentState = "active";
  g.__haptics = [];
  navigation.replace.mockClear();
  mockCreateRecorder.mockClear();
  mockRecorder.start.mockClear();
  mockRecorder.stop.mockClear();
  mockRecorder.finish = null;
});

afterEach(async () => {
  await act(async () => tree?.unmount());
  jest.useRealTimers();
});

async function render() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await act(async () => { tree = create(<CameraScreen navigation={navigation as any} route={{ key: "Camera", name: "Camera" } as any} />); });
  await flush();
}

describe("shutter in each mode", () => {
  it("does what each mode says on a tap", () => {
    expect(shutterTap("normal", false)).toBe("photo");
    expect(shutterTap("normal", true)).toBe("stop");
    expect(shutterTap("handsfree", false)).toBe("start");
    expect(shutterTap("handsfree", true)).toBe("stop");
    expect(shutterTap("boomerang", false)).toBe("boomerang");
    expect(shutterTap("boomerang", true)).toBe("none");
    expect(shutterLabel("handsfree", false)).toBe("Start recording");
    expect(shutterLabel("boomerang", true)).toBe("Recording Boomerang");
  });
});

describe("camera modes", () => {
  it("offers Normal, Hands-free and Boomerang, with Normal chosen", async () => {
    await render();
    expect(byLabel("Normal").props.accessibilityState).toMatchObject({ selected: true });
    expect(byLabel("Hands-free").props.accessibilityState).toMatchObject({ selected: false });
    expect(byLabel("Boomerang").props.accessibilityState).toMatchObject({ selected: false });
  });

  it("Hands-free: one tap starts recording, the next stops it, and the editor opens a normal video", async () => {
    await render();
    await choose("Hands-free");
    expect(g.__haptics).toContain("selection");
    await activate();
    expect(mockCreateRecorder).toHaveBeenCalledWith({ maxDuration: 60 });
    expect(mockRecorder.start).toHaveBeenCalled();
    expect(shutter().props.accessibilityLabel).toBe("Recording — activate to stop");
    // Mode can't change mid-recording: the row is hidden.
    expect(tree.root.findAll((n: ReactTestInstance) => n.props.accessibilityLabel === "Hands-free")).toHaveLength(0);
    await activate();
    expect(mockRecorder.stop).toHaveBeenCalledTimes(1);
    expect(navigation.replace).toHaveBeenCalledWith("StoryEditor", { mediaUri: "file:///tmp/clip.mp4", kind: "video", width: null, height: null, mimeType: "video/mp4" });
  });

  it("Boomerang: one tap records a short burst that stops itself and opens the editor as a Boomerang", async () => {
    await render();
    await choose("Boomerang");
    await activate();
    expect(mockCreateRecorder).toHaveBeenCalledWith({ maxDuration: 3 });
    // Another tap while it records does nothing.
    await activate();
    expect(mockRecorder.stop).not.toHaveBeenCalled();
    await act(async () => { jest.advanceTimersByTime(BOOMERANG_RECORD_MS); });
    await flush();
    expect(mockRecorder.stop).toHaveBeenCalledTimes(1);
    expect(navigation.replace).toHaveBeenCalledWith("StoryEditor", expect.objectContaining({ kind: "video", effect: "boomerang" }));
  });
});
