import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { Keyboard, Platform, StyleSheet, Text, View } from "react-native";
import { KeyboardAvoider } from "../src/components/KeyboardAvoider";

// Android (edge-to-edge) reports the keyboard but no longer resizes the window, so these
// run as Android: the avoider itself must move the content.
let tree: ReactTestRenderer;
const realOS = Platform.OS;
afterEach(async () => {
  await act(async () => tree?.unmount());
  (Platform as { OS: string }).OS = realOS;
  jest.restoreAllMocks();
});

async function openKeyboard(element: React.ReactElement, layout: { y: number; height: number }, keyboardTop: number): Promise<View[]> {
  (Platform as { OS: string }).OS = "android";
  const addListener = jest.spyOn(Keyboard, "addListener");
  await act(async () => { tree = create(element); });
  const views = () => tree.root.findAllByType(View) as unknown as View[];
  const outer = tree.root.findAllByType(View)[0]!;
  await act(async () => {
    await outer.props.onLayout({ nativeEvent: { layout: { x: 0, width: 390, ...layout } }, persist: () => undefined });
  });
  const shown = addListener.mock.calls.filter(([name]) => name === "keyboardDidShow").at(-1)![1] as (e: unknown) => void;
  await act(async () => {
    shown({ endCoordinates: { screenX: 0, screenY: keyboardTop, width: 390, height: 844 - keyboardTop }, duration: 0, easing: "keyboard" });
    await Promise.resolve();
  });
  return views();
}

test("the Story editor's caption panel is lifted to sit on the keyboard (position)", async () => {
  // A panel floating 66 pt above the bottom of an 844 pt screen; the keyboard's top is at 494.
  const [, content] = await openKeyboard(
    <KeyboardAvoider behavior="position" style={{ position: "absolute", bottom: 66, left: 0, right: 0 }}><Text>Add a caption…</Text></KeyboardAvoider>,
    { y: 600, height: 178 }, 494,
  );
  expect(StyleSheet.flatten((content as unknown as { props: { style: object } }).props.style)).toMatchObject({ bottom: 600 + 178 - 494 });
});

test("a full-screen form gets bottom padding equal to the keyboard's overlap (padding)", async () => {
  const [outer] = await openKeyboard(<KeyboardAvoider style={{ flex: 1 }}><Text>Email</Text></KeyboardAvoider>, { y: 0, height: 844 }, 520);
  expect(StyleSheet.flatten((outer as unknown as { props: { style: object } }).props.style)).toMatchObject({ paddingBottom: 844 - 520 });
});
