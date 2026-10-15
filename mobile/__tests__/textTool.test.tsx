import React from "react";
import { ScrollView, StyleSheet, TextInput } from "react-native";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { TextToolModal } from "../src/components/TextToolModal";

let tree: ReactTestRenderer;
const press = (label: string) => act(() => tree.root.find((n: ReactTestInstance) => typeof n.props.onPress === "function" && n.props.accessibilityLabel === label).props.onPress());
const inputStyle = () => StyleSheet.flatten(tree.root.findByType(TextInput).props.style);

describe("the text tool", () => {
  beforeEach(() => {
    act(() => { tree = create(<TextToolModal visible onCancel={jest.fn()} onDone={jest.fn()} />); });
  });

  it("keeps its rows of colours and styles to their own height", () => {
    const rows = tree.root.findAllByType(ScrollView).filter((s) => s.props.horizontal);
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(StyleSheet.flatten(row.props.style)).toMatchObject({ flexGrow: 0 });
  });

  it("shows the text in the chosen style, colour and alignment while writing", () => {
    press("Typewriter text style");
    expect(inputStyle().fontFamily).toBe("Courier"); // "monospace" on Android
    press("Text colour #E4483C");
    expect(inputStyle().color).toBe("#E4483C");
    press("Alignment: center");
    expect(inputStyle().textAlign).toBe("right");
  });

  it("closes without adding anything when Done is tapped with no text", () => {
    const onCancel = jest.fn();
    const onDone = jest.fn();
    act(() => { tree = create(<TextToolModal visible onCancel={onCancel} onDone={onDone} />); });
    act(() => tree.root.find((n: ReactTestInstance) => typeof n.props.onPress === "function" && n.findAll((c) => c.props.children === "Done").length > 0).props.onPress());
    expect(onDone).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalled();
  });
});
