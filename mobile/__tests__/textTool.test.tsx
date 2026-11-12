import React from "react";
import { ScrollView, StyleSheet, TextInput } from "react-native";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { TextToolModal } from "../src/components/TextToolModal";

let tree: ReactTestRenderer;
const press = (label: string) => act(() => tree.root.find((n: ReactTestInstance) => typeof n.props.onPress === "function" && n.props.accessibilityLabel === label).props.onPress());
const nextLook = () => act(() => tree.root.find((n: ReactTestInstance) => typeof n.props.onPress === "function" && /^Text look: /.test(n.props.accessibilityLabel ?? "")).props.onPress());
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
    nextLook();
    act(() => tree.root.find((n: ReactTestInstance) => typeof n.props.onPress === "function" && n.findAll((c) => c.props.children === "Done").length > 0).props.onPress());
    expect(onDone.mock.calls[0]![1]).toMatchObject({ backgroundColor: "#F5B400", color: "#000000" });
    expect(onDone.mock.calls[0]![1].effect).toBeUndefined();
  });

  it("the A button goes plain → label → see-through → highlighter → border → plain, each shown while typing", () => {
    const onDone = jest.fn();
    act(() => { tree = create(<TextToolModal visible onCancel={jest.fn()} onDone={onDone} canvasHeight={800} canvasWidth={400} />); });
    act(() => tree.root.findByType(TextInput).props.onChangeText("Good morning"));
    press("Show colours");
    press("Text colour #F5B400");
    const lookLabel = () => tree.root.find((n: ReactTestInstance) => typeof n.props.onPress === "function" && /^Text look: /.test(n.props.accessibilityLabel ?? "")).props.accessibilityLabel;
    expect(lookLabel()).toBe("Text look: No background");
    nextLook();
    expect(lookLabel()).toBe("Text look: Label");
    nextLook();
    expect(lookLabel()).toBe("Text look: See-through");
    nextLook();
    expect(lookLabel()).toBe("Text look: Highlighter");
    // The highlighter is measured from the text's lines and drawn behind each one.
    const measurer = tree.root.findAll((n: ReactTestInstance) => typeof n.props.onTextLayout === "function")[0]!;
    act(() => measurer.props.onTextLayout({ nativeEvent: { lines: [{ text: "Good ", x: 10, y: 0, width: 80, height: 30 }, { text: "morning", x: 5, y: 30, width: 90, height: 30 }] } }));
    const blocks = tree.root.findAll((n: ReactTestInstance) => n.props.testID === "text-marker" && typeof n.type === "string");
    expect(blocks).toHaveLength(2);
    expect(StyleSheet.flatten(blocks[0]!.props.style).backgroundColor).toBe("#F5B400");
    expect(inputStyle().color).toBe("#000000");
    nextLook();
    expect(lookLabel()).toBe("Text look: Border");
    // The border is the text in black or white behind it, in every direction.
    const copies = tree.root.findAll((n: ReactTestInstance) => n.props.testID === "text-border" && n.props.children === "Good morning" && typeof n.type !== "string");
    expect(copies.length).toBeGreaterThanOrEqual(8);
    expect(StyleSheet.flatten(copies[0]!.props.style).color).toBe("#000000");
    act(() => tree.root.find((n: ReactTestInstance) => typeof n.props.onPress === "function" && n.findAll((c) => c.props.children === "Done").length > 0).props.onPress());
    expect(onDone.mock.calls[0]![1]).toMatchObject({ color: "#F5B400", backgroundColor: null, effect: "outline" });
    nextLook();
  });

  it("a highlighter is saved as the colour behind the text plus the marker effect", () => {
    const onDone = jest.fn();
    act(() => { tree = create(<TextToolModal visible onCancel={jest.fn()} onDone={onDone} />); });
    act(() => tree.root.findByType(TextInput).props.onChangeText("Hi"));
    nextLook();
    nextLook();
    nextLook();
    act(() => tree.root.find((n: ReactTestInstance) => typeof n.props.onPress === "function" && n.findAll((c) => c.props.children === "Done").length > 0).props.onPress());
    expect(onDone.mock.calls[0]![1]).toMatchObject({ backgroundColor: "#FFFFFF", color: "#000000", effect: "marker" });
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

  it("a see-through label keeps its colour, drawn half transparent while typing", () => {
    const onDone = jest.fn();
    act(() => { tree = create(<TextToolModal visible onCancel={jest.fn()} onDone={onDone} />); });
    act(() => tree.root.findByType(TextInput).props.onChangeText("Hi"));
    press("Show colours");
    press("Text colour #3E7BFF");
    nextLook();
    nextLook();
    const boxes = tree.root.findAll((n: ReactTestInstance) => typeof n.type === "string" && StyleSheet.flatten(n.props.style)?.backgroundColor === "rgba(62,123,255,0.55)");
    expect(boxes.length).toBeGreaterThan(0);
    act(() => tree.root.find((n: ReactTestInstance) => typeof n.props.onPress === "function" && n.findAll((c) => c.props.children === "Done").length > 0).props.onPress());
    expect(onDone.mock.calls[0]![1]).toMatchObject({ backgroundColor: "#3E7BFF", effect: "soft", color: "#FFFFFF" });
  });

  it("the animation button cycles typewriter, pop, fade, bounce and off, and saves the choice", () => {
    const onDone = jest.fn();
    act(() => { tree = create(<TextToolModal visible onCancel={jest.fn()} onDone={onDone} />); });
    act(() => tree.root.findByType(TextInput).props.onChangeText("Hi"));
    const button = () => tree.root.find((n: ReactTestInstance) => typeof n.props.onPress === "function" && /^Animation: /.test(n.props.accessibilityLabel ?? ""));
    expect(button().props.accessibilityLabel).toBe("Animation: No animation");
    const seen: string[] = [];
    for (let i = 0; i < 5; i++) {
      act(() => button().props.onPress());
      seen.push(button().props.accessibilityLabel);
    }
    expect(seen).toEqual(["Animation: Typewriter", "Animation: Pop", "Animation: Fade in", "Animation: Bounce", "Animation: No animation"]);
    act(() => button().props.onPress());
    act(() => button().props.onPress());
    act(() => tree.root.find((n: ReactTestInstance) => typeof n.props.onPress === "function" && n.findAll((c) => c.props.children === "Done").length > 0).props.onPress());
    expect(onDone.mock.calls[0]![1]).toMatchObject({ animation: "pop" });
  });

  it("More colours opens a rainbow: any colour, lighter or darker", () => {
    const onDone = jest.fn();
    act(() => { tree = create(<TextToolModal visible onCancel={jest.fn()} onDone={onDone} />); });
    act(() => tree.root.findByType(TextInput).props.onChangeText("Hi"));
    press("Show colours");
    press("More colours");
    const bar = (label: string) => tree.root.find((n: ReactTestInstance) => n.props.accessibilityLabel === label && typeof n.props.onResponderGrant === "function");
    act(() => bar("Colour").props.onLayout?.({ nativeEvent: { layout: { width: 360, height: 30, x: 0, y: 0 } } }));
    act(() => bar("Colour").props.onResponderGrant({ nativeEvent: { locationX: 120, touches: [], changedTouches: [] }, touchHistory: { touchBank: [] } }));
    act(() => tree.root.find((n: ReactTestInstance) => typeof n.props.onPress === "function" && n.findAll((c) => c.props.children === "Done").length > 0).props.onPress());
    // A third of the way along the rainbow is green.
    const picked = onDone.mock.calls[0]![1].color as string;
    expect(picked).toMatch(/^#[0-9A-F]{6}$/);
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(picked.slice(i, i + 2), 16));
    expect(g!).toBeGreaterThan(r!);
    expect(g!).toBeGreaterThan(b!);
  });
});
