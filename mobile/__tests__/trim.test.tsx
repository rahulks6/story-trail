import React from "react";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { formatTrimTime, initialTrim, isTrimmed, moveTrim } from "../src/models/trim";
import { StoryEditorScreen } from "../src/screens/create/StoryEditorScreen";
import { TrimBar } from "../src/components/TrimBar";
import * as uploadQueue from "../src/state/uploadQueue";

jest.mock("../src/state/AuthContext", () => ({ useAuth: () => ({ accessToken: "token", user: { id: "me", username: "rahul" } }) }));
jest.mock("@react-navigation/native", () => ({ ...jest.requireActual("@react-navigation/native"), useNavigation: () => ({ reset: jest.fn(), navigate: jest.fn() }), useFocusEffect: (effect: () => () => void) => require("react").useEffect(effect, []), useIsFocused: () => true }));
jest.mock("../src/analytics/analytics", () => ({ track: jest.fn() }));

describe("choosing the part of a video to keep", () => {
  test("starts with all of a short video, or the first minute of a long one", () => {
    expect(initialTrim(12_345, 60_000)).toEqual({ startMs: 0, endMs: 12_345 });
    expect(initialTrim(95_000, 60_000)).toEqual({ startMs: 0, endMs: 60_000 });
  });

  test("moves an end within the video, never shorter than a second", () => {
    const from = { startMs: 0, endMs: 20_000 };
    expect(moveTrim(from, "start", 5_000, 30_000, 60_000)).toEqual({ startMs: 5_000, endMs: 20_000 });
    expect(moveTrim(from, "start", -5_000, 30_000, 60_000)).toEqual({ startMs: 0, endMs: 20_000 });
    expect(moveTrim(from, "start", 25_000, 30_000, 60_000)).toEqual({ startMs: 19_000, endMs: 20_000 });
    expect(moveTrim(from, "end", 50_000, 30_000, 60_000)).toEqual({ startMs: 0, endMs: 30_000 });
  });

  test("on a long video, never keeps more than a Story: an end pulled further drags the other along", () => {
    const from = { startMs: 0, endMs: 60_000 };
    expect(moveTrim(from, "end", 10_000, 95_000, 60_000)).toEqual({ startMs: 10_000, endMs: 70_000 });
    expect(moveTrim(from, "middle", 50_000, 95_000, 60_000)).toEqual({ startMs: 35_000, endMs: 95_000 });
  });

  test("says when anything was cut, and reads times as m:ss", () => {
    expect(isTrimmed({ startMs: 0, endMs: 12_000 }, 12_000)).toBe(false);
    expect(isTrimmed({ startMs: 1_000, endMs: 12_000 }, 12_000)).toBe(true);
    expect(isTrimmed(null, 12_000)).toBe(false);
    expect(formatTrimTime(83_400)).toBe("1:23");
  });
});

describe("trimming in the editor", () => {
  let tree: ReactTestRenderer;
  const flush = async () => { for (let i = 0; i < 6; i++) await act(async () => { await Promise.resolve(); }); };
  const byLabel = (label: string) => tree.root.find((n: ReactTestInstance) => typeof n.props.onPress === "function" && n.props.accessibilityLabel === label);
  const video = () => tree.root.find((n: ReactTestInstance) => (n.type as unknown) === "Video");
  afterEach(async () => { await act(async () => tree?.unmount()); jest.restoreAllMocks(); });

  async function open(params: Record<string, unknown> = {}) {
    await act(async () => {
      tree = create(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        <StoryEditorScreen navigation={{ goBack: jest.fn(), replace: jest.fn(), reset: jest.fn() } as any} route={{ key: "e", name: "StoryEditor", params: { mediaUri: "file:///v.mp4", kind: "video", mimeType: "video/mp4", width: 1080, height: 1920, ...params } } as any} />,
      );
    });
    const media = tree.root.findAll((n: ReactTestInstance) => typeof n.type === "string" && typeof n.props.onLayout === "function")[0]!;
    await act(async () => media.props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 400, height: 800 } } }));
    await act(async () => video().props.onLoad({ duration: 30 }));
    await flush();
  }

  test("sends only a real cut with the Story, and the preview loops the kept part", async () => {
    const enqueue = jest.spyOn(uploadQueue, "enqueueUpload").mockResolvedValue({} as never);
    await open();
    await act(async () => byLabel("Trim video").props.onPress());
    const track = tree.root.findByType(TrimBar).find((n: ReactTestInstance) => typeof n.type === "string" && typeof n.props.onLayout === "function");
    await act(async () => track.props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 300, height: 52 } } }));
    const bar = () => tree.root.find((n: ReactTestInstance) => n.props.accessibilityLabel === "Start of the part to keep" && typeof n.props.onAccessibilityAction === "function");
    for (let i = 0; i < 3; i++) await act(async () => bar().props.onAccessibilityAction({ nativeEvent: { actionName: "increment" } }));
    await act(async () => byLabel("Done trimming").props.onPress());
    // Past the end of the kept part: back to its start.
    await act(async () => video().props.onProgress({ currentTime: 31 }));
    await act(async () => byLabel("Share to Your story, everyone").props.onPress());
    expect(enqueue.mock.calls[0]![6]).toEqual({ startMs: 3_000, endMs: 30_000 });
  });

  test("an untouched video goes whole", async () => {
    const enqueue = jest.spyOn(uploadQueue, "enqueueUpload").mockResolvedValue({} as never);
    await open();
    await act(async () => byLabel("Share to Your story, everyone").props.onPress());
    expect(enqueue.mock.calls[0]![6]).toBeNull();
  });

  test("a gallery video longer than a Story opens trimming, and its first minute goes even untouched", async () => {
    const enqueue = jest.spyOn(uploadQueue, "enqueueUpload").mockResolvedValue({} as never);
    await open({ initialTrim: { startMs: 0, endMs: 60_000 } });
    expect(tree.root.findAll((n: ReactTestInstance) => n.props.accessibilityLabel === "Done trimming").length).toBeGreaterThan(0);
    await act(async () => byLabel("Done trimming").props.onPress());
    await act(async () => byLabel("Share to Your story, everyone").props.onPress());
    expect(enqueue.mock.calls[0]![6]).toEqual({ startMs: 0, endMs: 60_000 });
  });
});
