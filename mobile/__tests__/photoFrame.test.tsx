import React from "react";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { captureRef } from "react-native-view-shot";
import { framePhoto, isFramed, settled, UNFRAMED, MAX_PHOTO_SCALE, MIN_PHOTO_SCALE } from "../src/models/photoFrame";
import { coverBox, initialFrame } from "../src/models/photoFrame";
import { StoryEditorScreen } from "../src/screens/create/StoryEditorScreen";
import * as uploadQueue from "../src/state/uploadQueue";
import * as filterPhoto from "../src/utils/filterPhoto";

jest.mock("../src/state/AuthContext", () => ({ useAuth: () => ({ accessToken: "token", user: { id: "me", username: "rahul" } }) }));
jest.mock("@react-navigation/native", () => ({ ...jest.requireActual("@react-navigation/native"), useNavigation: () => ({ reset: jest.fn(), navigate: jest.fn() }), useFocusEffect: (effect: () => () => void) => require("react").useEffect(effect, []), useIsFocused: () => true }));
jest.mock("../src/analytics/analytics", () => ({ track: jest.fn() }));

const t = (x: number, y: number) => ({ pageX: x, pageY: y });

describe("moving a photo with two fingers", () => {
  it("grows with the fingers' spread, turns with their angle and moves with the point between them", () => {
    // 400 x 800 frame; fingers 100 apart, then 200 apart and turned a quarter, 40 to the right.
    const next = framePhoto(UNFRAMED, [t(150, 400), t(250, 400)], [t(240, 300), t(240, 500)], 400, 800);
    expect(next.scale).toBeCloseTo(2);
    expect(next.rotation).toBeCloseTo(90);
    expect(next.x).toBeCloseTo(0.6);
    expect(next.y).toBeCloseTo(0.5);
    expect(isFramed(next)).toBe(true);
  });

  it("keeps its size within limits, and settles exactly straight, centred and full size when nearly so", () => {
    expect(framePhoto(UNFRAMED, [t(0, 0), t(100, 0)], [t(0, 0), t(1000, 0)], 400, 800).scale).toBe(MAX_PHOTO_SCALE);
    expect(framePhoto(UNFRAMED, [t(0, 0), t(100, 0)], [t(0, 0), t(10, 0)], 400, 800).scale).toBe(MIN_PHOTO_SCALE);
    expect(settled({ x: 0.505, y: 0.49, scale: 1.02, rotation: 2 })).toEqual(UNFRAMED);
    expect(settled({ x: 0.5, y: 0.5, scale: 1, rotation: 88.5 }).rotation).toBe(90);
    expect(settled({ x: 0.5, y: 0.5, scale: 1, rotation: 370 }).rotation).toBe(10);
    expect(isFramed({ x: 0.505, y: 0.5, scale: 1.01, rotation: -1 })).toBe(false);
  });
});

describe("in the Story editor", () => {
  let tree: ReactTestRenderer;
  const flush = async () => { for (let i = 0; i < 6; i++) await act(async () => { await Promise.resolve(); }); };
  const byLabel = (label: string) => tree.root.findAll((n: ReactTestInstance) => typeof n.props.onPress === "function" && n.props.accessibilityLabel === label);
  // Each event has a later time: React Native drops a move that repeats the last one's time.
  let clock = 1;
  const touches = (points: [number, number][]) => {
    const at = ++clock;
    const list = points.map(([x, y], i) => ({ identifier: i, pageX: x, pageY: y, locationX: x, locationY: y, timestamp: at }));
    return {
      nativeEvent: { ...list[0], touches: list, changedTouches: list },
      touchHistory: { numberActiveTouches: list.length, indexOfSingleActiveTouch: 0, mostRecentTimeStamp: at, touchBank: list.map((l) => ({ touchActive: true, startPageX: l.pageX, startPageY: l.pageY, startTimeStamp: at, currentPageX: l.pageX, currentPageY: l.pageY, currentTimeStamp: at, previousPageX: l.pageX, previousPageY: l.pageY, previousTimeStamp: at })) },
    };
  };
  const open = async () => {
    await act(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tree = create(<StoryEditorScreen navigation={{ goBack: jest.fn(), replace: jest.fn(), reset: jest.fn() } as any} route={{ key: "e", name: "StoryEditor", params: { mediaUri: "file:///gallery/p.jpg", kind: "photo", mimeType: "image/jpeg", width: 1200, height: 1600 } } as any} />);
    });
    const media = tree.root.findAll((n: ReactTestInstance) => typeof n.type === "string" && typeof n.props.onLayout === "function")[0]!;
    await act(async () => media.props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 400, height: 800 } } }));
    await flush();
  };
  // The layer over the photo that takes its touches (swipe for filters, tap for text, two fingers to move it).
  const canvas = () => tree.root.find((n: ReactTestInstance) => typeof n.type === "string" && n.props.accessibilityElementsHidden === true && typeof n.props.onResponderGrant === "function");
  afterEach(async () => { await act(async () => tree?.unmount()); jest.restoreAllMocks(); (captureRef as jest.Mock).mockReset(); });

  it("two fingers move, resize and turn the photo; it's shared exactly as it looks, and Reset puts it back", async () => {
    const enqueue = jest.spyOn(uploadQueue, "enqueueUpload").mockResolvedValue({} as never);
    (captureRef as jest.Mock).mockResolvedValue("/tmp/framed.jpg");
    await open();
    expect(byLabel("Reset photo")).toHaveLength(0);
    await act(async () => {
      canvas().props.onResponderGrant(touches([[150, 400]]));
      canvas().props.onResponderMove(touches([[150, 400], [250, 400]]));
      canvas().props.onResponderMove(touches([[240, 300], [240, 500]]));
      canvas().props.onResponderRelease(touches([]));
    });
    await flush();
    expect(byLabel("Reset photo")).toHaveLength(1);

    await act(async () => byLabel("Share to Your story, everyone")[0]!.props.onPress());
    await flush();
    // Saved at full Story size, in the editor's proportions, and sent instead of the gallery file.
    expect((captureRef as jest.Mock).mock.calls[0]![1]).toMatchObject({ format: "jpg", width: 1080, height: 2160, result: "tmpfile" });
    expect(enqueue.mock.calls[0]![1]).toBe("file:///tmp/framed.jpg");
    expect(enqueue.mock.calls[0]![3]).toBe("image/jpeg");
    expect(enqueue.mock.calls[0]![4]).toMatchObject({ crop: { zoom: 1, offsetX: 0, offsetY: 0 } });
  });

  it("a filter covers the whole Story in the editor, the blurred surroundings of a moved photo too", async () => {
    jest.spyOn(filterPhoto, "filteredPhotoUri").mockResolvedValue("file:///cache/filtered.jpg");
    await open();
    // Make the photo smaller than the frame, so its blurred copy shows around it.
    await act(async () => {
      canvas().props.onResponderGrant(touches([[150, 400]]));
      canvas().props.onResponderMove(touches([[150, 400], [250, 400]]));
      canvas().props.onResponderMove(touches([[180, 400], [220, 400]]));
      canvas().props.onResponderRelease(touches([]));
    });
    // Then swipe to the next filter and let it settle.
    await act(async () => {
      canvas().props.onResponderGrant(touches([[300, 400]]));
      canvas().props.onResponderMove(touches([[240, 402]]));
      canvas().props.onResponderRelease(touches([[240, 402]]));
    });
    await act(async () => { await new Promise((r) => setTimeout(r, 400)); });
    await flush();
    const filtered = tree.root.findByProps({ testID: "filtered-photo" });
    const surroundings = filtered.findByProps({ testID: "filtered-surroundings" });
    const blurred = surroundings.findAll((n: ReactTestInstance) => n.props.blurRadius === 40);
    expect(blurred.length).toBeGreaterThan(0);
    expect(blurred[0]!.props.source).toEqual({ uri: "file:///cache/filtered.jpg" });
  });

  it("an untouched photo is sent as it is, without saving a copy", async () => {
    const enqueue = jest.spyOn(uploadQueue, "enqueueUpload").mockResolvedValue({} as never);
    await open();
    await act(async () => byLabel("Share to Your story, everyone")[0]!.props.onPress());
    await flush();
    expect(captureRef).not.toHaveBeenCalled();
    expect(enqueue.mock.calls[0]![1]).toBe("file:///gallery/p.jpg");
  });

  it("Reset brings the photo back to how it came", async () => {
    jest.spyOn(uploadQueue, "enqueueUpload").mockResolvedValue({} as never);
    await open();
    await act(async () => {
      canvas().props.onResponderGrant(touches([[150, 400]]));
      canvas().props.onResponderMove(touches([[150, 400], [250, 400]]));
      canvas().props.onResponderMove(touches([[100, 400], [300, 400]]));
      canvas().props.onResponderRelease(touches([]));
    });
    await flush();
    await act(async () => byLabel("Reset photo")[0]!.props.onPress());
    expect(byLabel("Reset photo")).toHaveLength(0);
  });
});

describe("a photo drawn whole, never pre-cut", () => {
  it("fills the frame at full size and keeps its shape, so its edges are there to show", () => {
    // A 4:3 landscape photo in a 9:16 frame: as tall as the frame, wider than it.
    expect(coverBox(360, 640, 4000, 3000).width).toBeCloseTo(640 * (4000 / 3000), 5);
    expect(coverBox(360, 640, 4000, 3000).height).toBeCloseTo(640, 5);
    expect(coverBox(360, 640, 1080, 1920)).toEqual({ width: 360, height: 640 });
  });

  it("starts a wide or square photo whole inside the frame, and a tall one filling it", () => {
    const landscape = initialFrame(360, 640, 4000, 3000);
    expect(landscape.scale).toBeCloseTo(360 / (640 * (4000 / 3000)), 5);
    expect(landscape).toEqual(expect.objectContaining({ x: 0.5, y: 0.5, rotation: 0 }));
    expect(isFramed(landscape)).toBe(true);
    expect(initialFrame(360, 640, 1000, 1000).scale).toBeCloseTo(360 / 640, 5);
    expect(initialFrame(360, 640, 1080, 1920)).toEqual(UNFRAMED);
    // A 3:4 phone photo is wider than a Story: whole, with the blur above and below.
    expect(initialFrame(360, 640, 3000, 4000).scale).toBeCloseTo(0.75, 5);
    // A very wide panorama still fits, down to the smallest size a pinch allows.
    expect(initialFrame(360, 640, 9000, 1000).scale).toBe(MIN_PHOTO_SCALE);
    expect(initialFrame(0, 0, 4000, 3000)).toEqual(UNFRAMED);
  });

  it("can be pinched down to show a whole wide photo", () => {
    expect(framePhoto(UNFRAMED, [t(0, 0), t(100, 0)], [t(0, 0), t(25, 0)], 400, 800).scale).toBe(0.25);
  });
});
