import React from "react";
import { Image } from "react-native";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { launchImageLibrary } from "react-native-image-picker";
import { captureRef } from "react-native-view-shot";
import { LAYOUTS, LAYOUT_OUTPUT, dragPhoto, layoutFor, photoFrame } from "../src/models/layouts";
import { LayoutScreen } from "../src/screens/create/LayoutScreen";

test("every layout's spaces cover the frame exactly, without overlapping", () => {
  for (const layout of LAYOUTS) {
    const area = layout.cells.reduce((sum, c) => sum + c.w * c.h, 0);
    expect(Math.abs(area - 1)).toBeLessThan(1e-9);
    for (const c of layout.cells) expect(c.x >= 0 && c.y >= 0 && c.x + c.w <= 1 + 1e-9 && c.y + c.h <= 1 + 1e-9).toBe(true);
  }
  expect(new Set(LAYOUTS.map((l) => l.cells.length))).toEqual(new Set([2, 3, 4, 5, 6]));
});

test("photos picked together get a layout that fits them", () => {
  expect(layoutFor(1).cells).toHaveLength(2);
  for (const n of [2, 3, 4, 5, 6]) expect(layoutFor(n).cells).toHaveLength(n);
});

test("a photo fills its space and drags only as far as its own edges", () => {
  const wide = { uri: "a", width: 2000, height: 1000, x: 0, y: 0 };
  // 100 x 100 space: the photo is drawn 200 x 100, centred.
  expect(photoFrame(wide, 100, 100)).toEqual({ width: 200, height: 100, left: -50, top: -0 });
  // Dragging right shows its left side, up to its edge and no further; it can't move up or down.
  expect(dragPhoto(wide, 25, 40, 100, 100)).toEqual({ x: -0.5, y: 0 });
  expect(dragPhoto(wide, 500, 0, 100, 100)).toEqual({ x: -1, y: 0 });
  expect(photoFrame({ ...wide, x: -1 }, 100, 100)!.left).toBeCloseTo(0);
  // Without its size it is simply centred.
  expect(photoFrame({ uri: "b", x: 0, y: 0 }, 100, 100)).toBeNull();
});

describe("making a layout", () => {
  let tree: ReactTestRenderer;
  const navigation = { goBack: jest.fn(), replace: jest.fn() };
  const flush = async () => { for (let i = 0; i < 6; i++) await act(async () => { await Promise.resolve(); }); };
  const byLabel = (label: string) => tree.root.find((n: ReactTestInstance) => typeof n.props.onPress === "function" && n.props.accessibilityLabel === label);
  const photos = () => tree.root.findAllByType(Image).map((i) => i.props.source.uri);
  const open = async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await act(async () => { tree = create(<LayoutScreen navigation={navigation as any} route={{ key: "l", name: "Layout" } as any} />); });
  };
  const asset = (name: string) => ({ uri: `file:///${name}.jpg`, width: 1200, height: 1600 });
  afterEach(async () => { await act(async () => tree?.unmount()); jest.clearAllMocks(); });

  test("Add photos picks several at once and chooses a layout for them; the button then says Next", async () => {
    (launchImageLibrary as jest.Mock).mockResolvedValueOnce({ assets: [asset("a"), asset("b"), asset("c")] });
    (captureRef as jest.Mock).mockResolvedValueOnce("/tmp/collage.jpg");
    await open();
    await act(async () => byLabel("Add photos").props.onPress());
    await flush();
    expect((launchImageLibrary as jest.Mock).mock.calls[0]![0]).toMatchObject({ selectionLimit: 6 });
    expect(photos()).toEqual(["file:///a.jpg", "file:///b.jpg", "file:///c.jpg"]);
    await act(async () => byLabel("Next").props.onPress());
    await flush();
    expect((captureRef as jest.Mock).mock.calls[0]![1]).toMatchObject({ format: "jpg", width: LAYOUT_OUTPUT.width, height: LAYOUT_OUTPUT.height });
    expect(navigation.replace).toHaveBeenCalledWith("StoryEditor", { mediaUri: "file:///tmp/collage.jpg", kind: "photo", mimeType: "image/jpeg", width: 1080, height: 1920 });
  });

  test("with spaces left, the button adds just the photos still missing; one space can be filled on its own", async () => {
    (launchImageLibrary as jest.Mock).mockResolvedValueOnce({ assets: [asset("a")] });
    await open();
    await act(async () => byLabel("6 photos").props.onPress());
    await act(async () => byLabel("Add photo 1").props.onPress());
    await flush();
    (launchImageLibrary as jest.Mock).mockResolvedValueOnce({ assets: [asset("b"), asset("c")] });
    await act(async () => byLabel("Add 5 more photos").props.onPress());
    await flush();
    expect((launchImageLibrary as jest.Mock).mock.calls[1]![0]).toMatchObject({ selectionLimit: 5 });
    expect(photos()).toEqual(["file:///a.jpg", "file:///b.jpg", "file:///c.jpg"]);
    expect(byLabel("Add 3 more photos")).toBeTruthy();
    expect(navigation.replace).not.toHaveBeenCalled();
  });

  test("tapping a photo offers Replace and Remove", async () => {
    (launchImageLibrary as jest.Mock).mockResolvedValueOnce({ assets: [asset("a"), asset("b")] });
    await open();
    await act(async () => byLabel("Add photos").props.onPress());
    await flush();
    await act(async () => byLabel("Change photo 2").props.onPress());
    const sheet = tree.root.find((n: ReactTestInstance) => Array.isArray(n.props.groups) && n.props.visible === true);
    expect(sheet.props.groups[0].map((o: { label: string }) => o.label)).toEqual(["Replace photo", "Remove photo"]);
    await act(async () => sheet.props.groups[0][1].onPress());
    expect(photos()).toEqual(["file:///a.jpg"]);
    expect(byLabel("Add 1 more photo")).toBeTruthy();
  });

  test("a different layout keeps the photos it has room for", async () => {
    (launchImageLibrary as jest.Mock).mockResolvedValue({ assets: [asset("a")] });
    await open();
    await act(async () => byLabel("Add photo 1").props.onPress());
    await flush();
    await act(async () => byLabel("6 photos").props.onPress());
    expect(photos()).toHaveLength(1);
    expect(byLabel("Add photo 6")).toBeTruthy();
  });
});
