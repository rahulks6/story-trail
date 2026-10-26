import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { Animated, Text } from "react-native";

// Every press shows: a button springs down, a wide row gets a tint, a full-screen tap area
// shows nothing. The real component, not the plain one the screen tests use.
const { Pressable } = jest.requireActual("../src/components/Pressable") as typeof import("../src/components/Pressable");

let tree: ReactTestRenderer;
const springs: number[] = [];
const timings: number[] = [];
beforeEach(() => {
  springs.length = 0;
  timings.length = 0;
  jest.spyOn(Animated, "spring").mockImplementation((_v, c) => { springs.push((c as { toValue: number }).toValue); return { start: () => undefined } as never; });
  jest.spyOn(Animated, "timing").mockImplementation((_v, c) => { timings.push((c as { toValue: number }).toValue); return { start: () => undefined } as never; });
});
afterEach(() => { act(() => tree.unmount()); jest.restoreAllMocks(); });

test("a button springs down on press-in and back on release", async () => {
  const outer = jest.fn();
  await act(async () => { tree = create(<Pressable onPressIn={outer} accessibilityLabel="Target"><Text>Go</Text></Pressable>); });
  const host = tree.root.findAll((n) => n.props.onPressIn && n.props.onPressOut && n.type !== Pressable)[0]!;
  await act(async () => host.props.onPressIn({}));
  await act(async () => host.props.onPressOut({}));
  expect(springs).toEqual([0.95, 1]);
  expect(outer).toHaveBeenCalled();
});

test("a wide row gets a tint instead of shrinking; a full-screen area shows nothing", async () => {
  const run = async (layout: { width: number; height: number }, props: object = {}) => {
    springs.length = 0; timings.length = 0;
    await act(async () => { tree = create(<Pressable accessibilityLabel="Target" onLayout={() => undefined} {...props}><Text>Row</Text></Pressable>); });
    const host = tree.root.findAll((n) => n.props.onPressIn && n.props.onLayout && n.type !== Pressable)[0]!;
    await act(async () => host.props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, ...layout } } }));
    await act(async () => host.props.onPressIn({}));
    await act(async () => host.props.onPressOut({}));
    act(() => tree.unmount());
  };
  await run({ width: 750, height: 56 });
  expect(springs).toEqual([]);
  expect(timings).toEqual([1, 0]);
  await run({ width: 750, height: 1334 });
  expect(springs).toEqual([]);
  expect(timings).toEqual([]);
  await run({ width: 40, height: 40 }, { pressEffect: "none" });
  expect(springs).toEqual([]);
  await act(async () => { tree = create(<Text />); });
});
