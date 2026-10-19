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

  it("shows styles above the keyboard, and colours in their place from the colour button", () => {
    const row = () => tree.root.findAllByType(ScrollView).filter((s) => s.props.horizontal);
    expect(row()).toHaveLength(1);
    expect(StyleSheet.flatten(row()[0]!.props.style)).toMatchObject({ flexGrow: 0 });
    expect(tree.root.findAll((n: ReactTestInstance) => n.props.accessibilityLabel === "Script text style" && typeof n.props.onPress === "function")).toHaveLength(1);
    press("Show colours");
    expect(tree.root.findAll((n: ReactTestInstance) => n.props.accessibilityLabel === "Text colour #E4483C" && typeof n.props.onPress === "function")).toHaveLength(1);
  });

  it("shows the text in the chosen style, colour and alignment while writing", () => {
    press("Typewriter text style");
    expect(inputStyle().fontFamily).toBe("AmericanTypewriter"); // the bundled Special Elite on Android
    press("Show colours");
    press("Text colour #E4483C");
    expect(inputStyle().color).toBe("#E4483C");
    press("Alignment: center");
    expect(inputStyle().textAlign).toBe("left");
  });

  it("puts the text on a label in the chosen colour, with readable text on it", () => {
    const onDone = jest.fn();
    act(() => { tree = create(<TextToolModal visible onCancel={jest.fn()} onDone={onDone} />); });
    act(() => tree.root.findByType(TextInput).props.onChangeText("Hi"));
    press("Show colours");
    press("Text colour #F5B400");
    act(() => tree.root.find((n: ReactTestInstance) => n.props.accessibilityLabel === "Text background" && typeof n.props.onPress === "function").props.onPress());
    act(() => tree.root.find((n: ReactTestInstance) => typeof n.props.onPress === "function" && n.findAll((c) => c.props.children === "Done").length > 0).props.onPress());
    expect(onDone.mock.calls[0]![1]).toMatchObject({ backgroundColor: "#F5B400", color: "#000000" });
  });

  it("makes Neon a bright core glowing in the chosen colour, with room so the glow isn't cut off", () => {
    press("Show colours");
    press("Text colour #FF5DA2");
    press("Show text styles");
    press("Neon text style");
    const style = inputStyle();
    expect(style.textShadowColor).toBe("#FF5DA2");
    expect(style.textShadowRadius).toBeGreaterThanOrEqual(6);
    expect(style.color).not.toBe("#FF5DA2"); // the washed-out core
    expect(style.padding).toBe(style.textShadowRadius);
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
