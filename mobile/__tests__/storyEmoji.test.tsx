import React from "react";
import { StyleSheet, Text, TextInput } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import * as uploadQueue from "../src/state/uploadQueue";
import * as usersApi from "../src/api/users";
import { TextToolModal } from "../src/components/TextToolModal";
import { OverlayBody } from "../src/components/OverlayBody";
import { tightTextFits } from "../src/components/textLook";
import { firstCharacter } from "../src/utils/firstCharacter";
import { createEmptyDraft, type Overlay } from "../src/models/storyDraft";
import { StoryEditorScreen } from "../src/screens/create/StoryEditorScreen";

const ME = "11111111-2222-4333-8444-555555555555";
jest.mock("../src/state/AuthContext", () => ({ useAuth: () => ({ accessToken: "token", user: { id: "11111111-2222-4333-8444-555555555555", username: "rahul" } }) }));
jest.mock("@react-navigation/native", () => ({ ...jest.requireActual("@react-navigation/native"), useNavigation: () => ({ reset: jest.fn(), navigate: jest.fn() }), useFocusEffect: (effect: () => () => void) => require("react").useEffect(effect, []), useIsFocused: () => true }));
jest.mock("../src/analytics/analytics", () => ({ track: jest.fn() }));

let tree: ReactTestRenderer;
const flush = async () => { for (let i = 0; i < 6; i++) await act(async () => { await Promise.resolve(); }); };
afterEach(async () => {
  await AsyncStorage.clear();
  await act(async () => tree?.unmount());
  jest.restoreAllMocks();
});

describe("emoji in Story text on Android", () => {
  it("keeps Latin text tight on its label, but gives an emoji or Hindi the font's full height", () => {
    expect(tightTextFits("Happy weekend! Café — 20€")).toBe(true);
    expect(tightTextFits("Happy Diwali 🪔")).toBe(false);
    expect(tightTextFits("❤️")).toBe(false);
    expect(tightTextFits("दिवाली")).toBe(false);
  });

  it("doesn't clip an emoji typed in the text tool, and stops at the length the server keeps", () => {
    act(() => { tree = create(<TextToolModal visible initialText="🎉 Party" onCancel={jest.fn()} onDone={jest.fn()} />); });
    const input = () => tree.root.findByType(TextInput);
    expect(StyleSheet.flatten(input().props.style).includeFontPadding).toBe(true);
    expect(input().props.maxLength).toBe(280);
    act(() => input().props.onChangeText("Party"));
    expect(StyleSheet.flatten(input().props.style).includeFontPadding).toBe(false);
  });

  it("doesn't clip an emoji in text on the Story", () => {
    const overlay = (text: string) => ({ id: "t", type: "text", x: 0.5, y: 0.5, scale: 1, rotation: 0, zIndex: 1, properties: { text, style: "Bold", color: "#FFFFFF", backgroundColor: null, align: "center", fontSize: 0.1 } }) as Overlay;
    act(() => { tree = create(<OverlayBody overlay={overlay("Happy Diwali 🪔")} containerWidth={400} containerHeight={800} />); });
    expect(tree.root.findAllByType(Text).map((t) => StyleSheet.flatten(t.props.style).includeFontPadding)).toEqual([true]);
    act(() => tree.update(<OverlayBody overlay={overlay("Happy Diwali")} containerWidth={400} containerHeight={800} />));
    expect(tree.root.findAllByType(Text).map((t) => StyleSheet.flatten(t.props.style).includeFontPadding)).toEqual([false]);
  });
});

describe("a Highlight's initial", () => {
  it("is a whole emoji, never half of one", () => {
    expect("🌸 Spring".charAt(0)).not.toBe("🌸"); // what it used to show: a lone surrogate, drawn as "�"
    expect(firstCharacter("🌸 Spring")).toBe("🌸");
    expect(firstCharacter("👍🏽 likes")).toBe("👍🏽");
    expect(firstCharacter("🇮🇳 India")).toBe("🇮🇳");
    expect(firstCharacter("👨‍👩‍👧 family")).toBe("👨‍👩‍👧");
    expect(firstCharacter("❤️ love")).toBe("❤️");
    expect(firstCharacter("🏴󠁧󠁢󠁥󠁮󠁧󠁿 trip")).toBe("🏴󠁧󠁢󠁥󠁮󠁧󠁿");
    expect(firstCharacter("trips")).toBe("t");
    expect(firstCharacter("")).toBe("");
  });
});

describe("a restored draft", () => {
  it("puts a new sticker in front of the objects it brought back", async () => {
    const mediaUri = "file:///p.jpg";
    const draft = createEmptyDraft({ uri: mediaUri, kind: "photo", width: 1080, height: 1920 });
    const text = (id: string, zIndex: number) => ({ id, type: "text", x: 0.5, y: 0.5, scale: 1, rotation: 0, zIndex, properties: { text: id, style: "Clean", color: "#FFFFFF", backgroundColor: null, align: "center", fontSize: 0.045 } });
    draft.overlays = [text("one", 1), text("two", 2), text("three", 3)] as Overlay[];
    await AsyncStorage.setItem(`katkee.draft.v2.${ME}.${mediaUri}`, JSON.stringify({ draft, audience: "public", mimeType: "image/jpeg", savedAt: new Date().toISOString() }));
    const enqueue = jest.spyOn(uploadQueue, "enqueueUpload").mockResolvedValue({} as never);
    jest.spyOn(usersApi, "listCloseFriends").mockResolvedValue({ closeFriends: [], limit: 1, offset: 0 });
    await act(async () => {
      tree = create(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        <StoryEditorScreen navigation={{ reset: jest.fn() } as any} route={{ key: "e", name: "StoryEditor", params: { mediaUri, kind: "photo", mimeType: "image/jpeg", width: 1080, height: 1920 } } as any} />,
      );
    });
    await flush();
    const press = (label: string) => act(async () => tree.root.find((n: ReactTestInstance) => typeof n.props.onPress === "function" && n.props.accessibilityLabel === label).props.onPress());
    await press("Add sticker, emoji, mention, location, or date and time");
    await press("Add 😀 emoji");
    await press("Share to Your story, everyone");
    const overlays = (enqueue.mock.calls[0]![4] as { overlays: Overlay[] }).overlays;
    expect(overlays.map((o) => o.type)).toEqual(["text", "text", "text", "emoji"]);
    expect(overlays[3]!.zIndex).toBeGreaterThan(3);
  });
});

describe("removing an emoji from a video Story", () => {
  it("a tap on the emoji opens its controls, and Delete takes it off the Story", async () => {
    const mediaUri = "file:///v.mp4";
    const enqueue = jest.spyOn(uploadQueue, "enqueueUpload").mockResolvedValue({} as never);
    jest.spyOn(usersApi, "listCloseFriends").mockResolvedValue({ closeFriends: [], limit: 1, offset: 0 });
    await act(async () => {
      tree = create(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        <StoryEditorScreen navigation={{ reset: jest.fn() } as any} route={{ key: "e", name: "StoryEditor", params: { mediaUri, kind: "video", mimeType: "video/mp4", width: 1080, height: 1920 } } as any} />,
      );
    });
    await flush();
    const find = (label: string) => tree.root.find((n: ReactTestInstance) => typeof n.props.onPress === "function" && n.props.accessibilityLabel === label);
    const press = (label: string) => act(async () => find(label).props.onPress());
    // The editor's canvas needs a size before objects are placed on it.
    await act(async () => tree.root.find((n: ReactTestInstance) => typeof n.props.onLayout === "function" && n.props.style && StyleSheet.flatten(n.props.style).flex === 1).props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 400, height: 800 } } }));
    await press("Add sticker, emoji, mention, location, or date and time");
    await press("Add 😀 emoji");
    const emoji = () => tree.root.findAll((n: ReactTestInstance) => typeof n.type === "string" && typeof n.props.onResponderGrant === "function" && n.props.accessibilityActions?.length);
    expect(emoji()).toHaveLength(1);
    // A tap: down and up without moving.
    const touch = (x: number, y: number) => ({ nativeEvent: { pageX: x, pageY: y, touches: [{ pageX: x, pageY: y, identifier: 0 }], changedTouches: [] }, touchHistory: { numberActiveTouches: 1, indexOfSingleActiveTouch: 0, mostRecentTimeStamp: 1, touchBank: [{ touchActive: true, startPageX: x, startPageY: y, startTimeStamp: 1, currentPageX: x, currentPageY: y, currentTimeStamp: 1, previousPageX: x, previousPageY: y, previousTimeStamp: 1 }] } });
    await act(async () => { emoji()[0]!.props.onResponderGrant(touch(200, 400)); emoji()[0]!.props.onResponderRelease(touch(200, 400)); });
    await press("Delete");
    expect(emoji()).toHaveLength(0);
    await press("Share to Your story, everyone");
    expect((enqueue.mock.calls[0]![4] as { overlays: Overlay[] }).overlays).toEqual([]);
  });
});
