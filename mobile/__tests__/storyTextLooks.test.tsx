import React from "react";
import { StyleSheet } from "react-native";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { OverlayBody } from "../src/components/OverlayBody";
import type { Overlay, TextOverlayProperties } from "../src/models/storyDraft";
import { textLookOf } from "../src/components/TextDecorations";

let tree: ReactTestRenderer;
afterEach(() => act(() => tree?.unmount()));

const text = (p: Partial<TextOverlayProperties>): Overlay => ({
  id: "t1", type: "text", x: 0.5, y: 0.5, scale: 1, rotation: 0, zIndex: 0,
  properties: { text: "Hello", style: "Clean", color: "#FFFFFF", backgroundColor: null, align: "center", fontSize: 0.05, ...p },
}) as Overlay;
const render = (overlay: Overlay) => act(() => { tree = create(<OverlayBody overlay={overlay} containerWidth={400} containerHeight={800} />); });
const borders = () => tree.root.findAll((n: ReactTestInstance) => n.props.testID === "text-border" && typeof n.type !== "string");
const markers = () => tree.root.findAll((n: ReactTestInstance) => n.props.testID === "text-marker" && typeof n.type === "string");

test("which look a stored text has, old Stories included", () => {
  expect(textLookOf({ backgroundColor: null, style: "Clean" })).toBe("plain");
  expect(textLookOf({ backgroundColor: "#F5B400", style: "Clean" })).toBe("label");
  expect(textLookOf({ backgroundColor: "#F5B400", style: "Clean", effect: "marker" })).toBe("marker");
  expect(textLookOf({ backgroundColor: null, style: "Clean", effect: "outline" })).toBe("border");
  expect(textLookOf({ backgroundColor: null, style: "Outline" })).toBe("border");
});

test("a border goes round the letters in any font, black around light text", () => {
  render(text({ style: "Typewriter", effect: "outline" }));
  expect(borders().length).toBeGreaterThanOrEqual(8);
  for (const copy of borders()) expect(StyleSheet.flatten(copy.props.style).color).toBe("#000000");
  expect(markers()).toHaveLength(0);
});

test("a highlighter is a block behind each line, in the chosen colour", () => {
  render(text({ color: "#000000", backgroundColor: "#F5B400", effect: "marker", text: "Good morning Pune" }));
  const measurer = tree.root.findAll((n: ReactTestInstance) => typeof n.props.onTextLayout === "function")[0]!;
  act(() => measurer.props.onTextLayout({ nativeEvent: { lines: [
    { text: "Good morning ", x: 4, y: 0, width: 150, height: 44 },
    { text: "Pune", x: 50, y: 44, width: 60, height: 44 },
  ] } }));
  const blocks = markers().map((m) => StyleSheet.flatten(m.props.style));
  expect(blocks).toHaveLength(2);
  // Each block hugs its own line, a little wider than the words.
  expect(blocks[0]!.width).toBeGreaterThan(150);
  expect(blocks[1]!.width).toBeLessThan(blocks[0]!.width as number);
  expect(blocks[1]!.top).toBeGreaterThan(blocks[0]!.top as number);
  for (const b of blocks) expect(b.backgroundColor).toBe("#F5B400");
});

test("a label stays one box, and plain text has neither", () => {
  render(text({ color: "#000000", backgroundColor: "#F5B400" }));
  expect(markers()).toHaveLength(0);
  expect(borders()).toHaveLength(0);
  expect(tree.root.findAll((n: ReactTestInstance) => typeof n.type === "string" && StyleSheet.flatten(n.props.style)?.backgroundColor === "#F5B400")).toHaveLength(1);
  render(text({}));
  expect(markers()).toHaveLength(0);
  expect(borders()).toHaveLength(0);
});
