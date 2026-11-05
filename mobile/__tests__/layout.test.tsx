import React from "react";
import { Image } from "react-native";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { launchImageLibrary } from "react-native-image-picker";
import { captureRef } from "react-native-view-shot";
import { LAYOUTS, LAYOUT_OUTPUT } from "../src/models/layouts";
import { LayoutScreen } from "../src/screens/create/LayoutScreen";

test("every layout's spaces cover the frame exactly, without overlapping", () => {
  for (const layout of LAYOUTS) {
    const area = layout.cells.reduce((sum, c) => sum + c.w * c.h, 0);
    expect(Math.abs(area - 1)).toBeLessThan(1e-9);
    for (const c of layout.cells) expect(c.x >= 0 && c.y >= 0 && c.x + c.w <= 1 + 1e-9 && c.y + c.h <= 1 + 1e-9).toBe(true);
  }
  expect(new Set(LAYOUTS.map((l) => l.cells.length))).toEqual(new Set([2, 3, 4, 6]));
});

describe("making a layout", () => {
  let tree: ReactTestRenderer;
  const navigation = { goBack: jest.fn(), replace: jest.fn() };
  const flush = async () => { for (let i = 0; i < 6; i++) await act(async () => { await Promise.resolve(); }); };
  const byLabel = (label: string) => tree.root.find((n: ReactTestInstance) => typeof n.props.onPress === "function" && n.props.accessibilityLabel === label);
  afterEach(async () => { await act(async () => tree?.unmount()); jest.clearAllMocks(); });

  test("fills each space from the gallery, then opens the collage in the editor as one photo", async () => {
    (launchImageLibrary as jest.Mock).mockResolvedValueOnce({ assets: [{ uri: "file:///a.jpg" }] }).mockResolvedValueOnce({ assets: [{ uri: "file:///b.jpg" }] });
    (captureRef as jest.Mock).mockResolvedValueOnce("/tmp/collage.jpg");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await act(async () => { tree = create(<LayoutScreen navigation={navigation as any} route={{ key: "l", name: "Layout" } as any} />); });
    const next = () => tree.root.find((n: ReactTestInstance) => n.props.accessibilityRole === "button" && n.props.accessibilityState?.disabled !== undefined);
    expect(next().props.accessibilityState.disabled).toBe(true);
    await act(async () => byLabel("Add photo 1").props.onPress());
    await flush();
    expect(next().props.accessibilityState.disabled).toBe(true);
    await act(async () => byLabel("Add photo 2").props.onPress());
    await flush();
    expect(tree.root.findAllByType(Image).map((i) => i.props.source.uri)).toEqual(["file:///a.jpg", "file:///b.jpg"]);
    await act(async () => next().props.onPress());
    await flush();
    expect((captureRef as jest.Mock).mock.calls[0]![1]).toMatchObject({ format: "jpg", width: LAYOUT_OUTPUT.width, height: LAYOUT_OUTPUT.height });
    expect(navigation.replace).toHaveBeenCalledWith("StoryEditor", { mediaUri: "file:///tmp/collage.jpg", kind: "photo", mimeType: "image/jpeg", width: 1080, height: 1920 });
  });

  test("a different layout keeps the photos it has room for", async () => {
    (launchImageLibrary as jest.Mock).mockResolvedValue({ assets: [{ uri: "file:///a.jpg" }] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await act(async () => { tree = create(<LayoutScreen navigation={navigation as any} route={{ key: "l", name: "Layout" } as any} />); });
    await act(async () => byLabel("Add photo 1").props.onPress());
    await flush();
    await act(async () => byLabel("6 photos").props.onPress());
    expect(tree.root.findAllByType(Image)).toHaveLength(1);
    expect(byLabel("Add photo 6")).toBeTruthy();
  });
});
