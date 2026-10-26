import React from "react";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { Alert, Keyboard, KeyboardAvoidingView, Linking, PermissionsAndroid, Platform, StyleSheet, TextInput, View } from "react-native";
import { ConversationScreen } from "../src/screens/dm/ConversationScreen";

// The DM thread as the DM tab shows it, with the network, outbox and realtime replaced.
// Hooks return stable values, as the app's providers do (the thread's effects depend on them).
const mockAuth = { accessToken: "token", user: { id: "u-me", username: "me" } };
const mockDM = { refreshUnreadCount: jest.fn() };
const mockNavigation = { navigate: jest.fn(), setParams: jest.fn(), setOptions: jest.fn() };
jest.mock("../src/state/AuthContext", () => ({ useAuth: () => mockAuth }));
jest.mock("../src/state/DMContext", () => ({ useDM: () => mockDM }));
const mockRealtime: { handler: ((event: unknown) => void) | null } = { handler: null };
jest.mock("../src/state/RealtimeContext", () => ({ useRealtime: () => ({ connected: true }), useRealtimeEvents: (handler: (event: unknown) => void) => { mockRealtime.handler = handler; } }));
jest.mock("../src/utils/filterPhoto", () => ({
  filteredPhotoUri: jest.fn(async (uri: string, filter: string, edge: number) => (filter === "original" ? uri : `${uri}#${filter}@${edge}`)),
  forgetFilteredPhoto: jest.fn(),
}));
jest.mock("../src/state/dmOutbox", () => ({
  discardMessage: jest.fn(), enqueueMessage: jest.fn(async () => undefined), flushOutbox: jest.fn(async () => undefined),
  loadOutbox: jest.fn(async () => undefined), onOutboxSent: () => () => undefined, pendingMessages: () => [],
  retryMessage: jest.fn(), subscribeOutbox: () => () => undefined,
}));
jest.mock("../src/api/conversations", () => ({
  MAX_MESSAGE_LENGTH: 1000,
  MESSAGE_REACTIONS: ["❤️", "😂", "😮", "😢", "😡", "👍"],
  reactToMessage: jest.fn(async (_c: string, _m: string, emoji: string) => ({ reactions: [{ userId: "u-me", emoji }] })),
  removeMessageReaction: jest.fn(async () => ({ reactions: [] })),
  sendTyping: jest.fn(async () => undefined),
  unsendMessage: jest.fn(async () => undefined),
  setConversationMuted: jest.fn(async () => undefined),
  hideConversation: jest.fn(async () => undefined),
  newClientMessageId: () => `m_test_${Math.random().toString(36).slice(2, 12)}`,
  getConversation: jest.fn(),
  markConversationRead: jest.fn(async () => undefined),
  listPins: jest.fn(async () => ({ pins: [] })),
  pinMessage: jest.fn(async () => undefined),
  unpinMessage: jest.fn(async () => undefined),
  MAX_PINS: 3,
  messagePreview: jest.requireActual("../src/api/conversations").messagePreview,
  listMessages: jest.fn(async () => ({
    hasMore: false,
    messages: [
      { id: "m2", conversationId: "c1", senderId: "u-alice", body: "hello", sharedStoryId: null, createdAt: "2026-10-06 09:01:00+00" },
      { id: "m1", conversationId: "c1", senderId: "u-me", body: "hi", sharedStoryId: null, createdAt: "2026-10-06 09:00:00+00", status: "read" },
      { id: "m0", conversationId: "c1", senderId: "u-alice", body: null, sharedStoryId: null, createdAt: "2026-10-06 08:59:00+00", media: { id: "md1", kind: "photo", width: 1080, height: 1350, durationMs: null } },
    ],
  })),
}));
jest.mock("../src/api/users", () => ({ blockUser: jest.fn(async () => undefined) }));
jest.mock("../src/api/stories", () => ({ getStoryOwnerUsername: jest.fn(), mediaFileUrl: (id: string, v: string) => `/media/${id}/${v}` }));
jest.mock("../src/components/Avatar", () => ({ Avatar: (p: object) => require("react").createElement("Avatar", p) }));
jest.mock("../src/components/ReportSheet", () => ({ ReportSheet: (p: object) => require("react").createElement("ReportSheet", p) }));
jest.mock("@react-navigation/elements", () => ({ useHeaderHeight: () => 103 }));
jest.mock("@react-navigation/native", () => ({
  useNavigation: () => mockNavigation,
  useFocusEffect: (effect: () => void) => require("react").useEffect(() => effect(), [effect]),
}));

type Props = React.ComponentProps<typeof ConversationScreen>;
const props = { route: { params: { conversationId: "c1", otherUsername: "alice" } } } as unknown as Props;
let tree: ReactTestRenderer;
const realOS = Platform.OS;

afterEach(async () => {
  await act(async () => tree?.unmount());
  // Unsent photos and voice notes are kept between visits (that's the point): start each test clean.
  await require("../src/screens/dm/dmMediaOutbox").clearMediaOutbox("u-me");
  (Platform as { OS: string }).OS = realOS;
  jest.restoreAllMocks();
});

async function render(): Promise<void> {
  await act(async () => {
    tree = create(<ConversationScreen {...props} />);
  });
  for (let i = 0; i < 3; i++) await act(async () => { await Promise.resolve(); });
}
const bubble = (label: string) => tree.root.find((n) => typeof n.props.onLongPress === "function" && n.props.accessibilityLabel === label);

test("on Android the composer moves above the keyboard (edge-to-edge: the window is not resized)", async () => {
  (Platform as { OS: string }).OS = "android";
  const addListener = jest.spyOn(Keyboard, "addListener");
  await render();
  const avoider = tree.root.findByType(KeyboardAvoidingView);
  expect(avoider.props.behavior).toBe("padding");
  expect(avoider.props.keyboardVerticalOffset).toBe(103); // starts below the stack header

  // What Android reports once the keyboard is open: its top edge on the screen.
  const shownListeners = addListener.mock.calls.filter(([name]) => name === "keyboardDidShow").map(([, fn]) => fn as (e: unknown) => void);
  const shown = (e: unknown) => shownListeners.forEach((fn) => fn(e));
  const root = avoider.findByType(View);
  await act(async () => {
    await root.props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 390, height: 600 } }, persist: () => undefined });
  });
  await act(async () => {
    shown({ endCoordinates: { screenX: 0, screenY: 450, width: 390, height: 300 }, duration: 0, easing: "keyboard" });
    await Promise.resolve();
  });
  // The thread's bottom edge sits at 103 + 600 on screen; the keyboard starts at 450.
  expect(StyleSheet.flatten(avoider.findByType(View).props.style).paddingBottom).toBe(103 + 600 - 450);
});

test("screen readers hear who sent each message, can report the other person's, and the composer is labelled", async () => {
  await render();
  expect(tree.root.findByType(TextInput).props.accessibilityLabel).toBe("Message");
  const theirs = bubble("@alice: hello");
  const mine = bubble("You: hi");
  expect(mine.props.accessibilityActions).toEqual([{ name: "reply", label: "Reply" }, { name: "react", label: "React" }]);
  expect(theirs.props.accessibilityActions).toEqual([{ name: "reply", label: "Reply" }, { name: "react", label: "React" }, { name: "report", label: "Report message" }]);

  const sheet = () => tree.root.find((n: ReactTestInstance) => (n.type as unknown) === "ReportSheet");
  expect(sheet().props.visible).toBe(false);
  await act(async () => theirs.props.onAccessibilityAction({ nativeEvent: { actionName: "report" } }));
  expect(sheet().props).toMatchObject({ visible: true, targetType: "message", targetId: "m2", conversationId: "c1" });
});


test("the header shows who you're chatting with, and opens their profile", async () => {
  await render();
  const options = mockNavigation.setOptions.mock.calls.at(-1)![0] as { headerTitle: () => React.ReactElement };
  let header!: ReactTestRenderer;
  act(() => { header = create(options.headerTitle()); });
  expect(header.root.findAll((n) => (n.type as unknown) === "Avatar")[0]!.props.username).toBe("alice");
  act(() => header.root.find((n) => n.props.accessibilityHint === "Opens their profile" && typeof n.props.onPress === "function").props.onPress());
  expect(mockNavigation.navigate).toHaveBeenCalledWith("Main", { screen: "Search", params: { screen: "UserProfile", params: { username: "alice" }, initial: false } });
});

test("photos in the thread open full screen, and there are buttons to send photos and videos", async () => {
  await render();
  const photo = tree.root.find((n) => n.props.accessibilityLabel === "@alice: Photo" && typeof n.props.onPress === "function");
  // The bubble loads the small variant (resized on Android); the full-screen viewer the large one.
  const images = (uri: string) => tree.root.findAll((n) => (n.type as unknown) === "Image" && n.props.source?.uri === uri);
  expect(photo.findAll((n) => (n.type as unknown) === "Image" && n.props.source?.uri === "/media/md1/thumbnail")[0]!.props.resizeMethod).toBe("resize");
  expect(images("/media/md1/display")).toHaveLength(0);
  // One tap opens it, once it's clear it wasn't the first of a double tap (which hearts it).
  await act(async () => { photo.props.onPress(); await new Promise<void>((r) => setTimeout(r, 320)); });
  const { Modal } = require("react-native");
  expect(tree.root.findAllByType(Modal).some((m: ReactTestInstance) => m.props.visible)).toBe(true);
  expect(images("/media/md1/display")).not.toHaveLength(0);
  expect(tree.root.findAll((n) => n.props.accessibilityLabel === "Send a photo or video from your gallery" && typeof n.props.onPress === "function")).toHaveLength(1);
  expect(tree.root.findAll((n) => n.props.accessibilityLabel === "Take a photo or video" && typeof n.props.onPress === "function")).toHaveLength(1);
});

test("with nothing typed the microphone records a voice message; Send sends it, the bin throws it away", async () => {
  const sendMedia = require("../src/screens/dm/sendMedia");
  const sent = jest.spyOn(sendMedia, "sendPendingMedia").mockImplementation(() => new Promise(() => undefined));
  await render();
  const pressLabel = (label: string) => act(async () => tree.root.find((n) => typeof n.props.onPress === "function" && n.props.accessibilityLabel === label).props.onPress());
  await pressLabel("Record a voice message");
  const g = globalThis as unknown as { __sound: { listener: ((e: { currentPosition: number }) => void) | null } };
  await act(async () => g.__sound.listener!({ currentPosition: 3200 }));
  expect(tree.root.findAll((n) => typeof n.props.children === "string" && n.props.children === "0:03")).not.toHaveLength(0);
  await pressLabel("Send voice message");
  for (let i = 0; i < 5; i++) await act(async () => { await Promise.resolve(); });
  // Sent from a copy in app storage, so it survives the recorder's cache being cleared.
  expect(require("@dr.pogodin/react-native-fs").copyFile).toHaveBeenCalledWith("/data/voice.mp4", expect.stringMatching(/^\/documents\/katkee-dm-outbox\/m_test_\w+\.mp4$/));
  expect(sent.mock.calls[0]![1]).toMatchObject({ mediaKind: "audio", uri: expect.stringMatching(/^file:\/\/\/documents\/katkee-dm-outbox\//), durationMs: 3200 });
  // A voice bubble appears straight away.
  expect(tree.root.findAll((n) => typeof n.props.accessibilityLabel === "string" && n.props.accessibilityLabel.startsWith("You. Voice message"))).not.toHaveLength(0);

  await pressLabel("Record a voice message");
  await act(async () => g.__sound.listener!({ currentPosition: 2000 }));
  await pressLabel("Delete voice message");
  expect(sent).toHaveBeenCalledTimes(1);
});

const pressLabel = (label: string) => act(async () => tree.root.find((n) => typeof n.props.onPress === "function" && n.props.accessibilityLabel === label).props.onPress());
const settle = async () => { for (let i = 0; i < 5; i++) await act(async () => { await Promise.resolve(); }); };

test("a double tap on Send queues the message once, and the box clears straight away", async () => {
  const outbox = require("../src/state/dmOutbox");
  outbox.enqueueMessage.mockClear();
  await render();
  await act(async () => tree.root.findByType(TextInput).props.onChangeText("hello there"));
  const send = tree.root.find((n) => typeof n.props.onPress === "function" && n.props.accessibilityLabel === "Send").props.onPress;
  await act(async () => { send(); send(); });
  expect(outbox.enqueueMessage).toHaveBeenCalledTimes(1);
  expect(outbox.enqueueMessage).toHaveBeenCalledWith("u-me", "c1", { body: "hello there" });
  expect(tree.root.findByType(TextInput).props.value).toBe("");
});

test("a photo that fails to send stays in the thread with Retry, also after leaving the chat and coming back", async () => {
  const sendMedia = require("../src/screens/dm/sendMedia");
  jest.spyOn(sendMedia, "sendPendingMedia").mockRejectedValue(new Error("Upload timed out."));
  (globalThis as unknown as { __picker: { result: unknown } }).__picker.result = { assets: [{ uri: "file:///cache/p.jpg", type: "image/jpeg", width: 100, height: 100 }] };
  await render();
  await pressLabel("Send a photo or video from your gallery");
  await settle();
  const caption = () => tree.root.findAll((n) => typeof n.props.children === "string" && n.props.children === "Upload timed out. · Tap to retry");
  expect(caption()).not.toHaveLength(0);
  // Saved on the phone, not only in the screen.
  const stored = JSON.parse((globalThis as unknown as { __mockStorage: Map<string, string> }).__mockStorage.get("katkee.dmMediaOutbox.v1.u-me")!);
  expect(stored).toMatchObject([{ conversationId: "c1", mediaKind: "photo", status: "failed", error: "Upload timed out." }]);

  await act(async () => tree.unmount());
  await render();
  expect(caption()).not.toHaveLength(0);
  (globalThis as unknown as { __picker: { result: unknown } }).__picker.result = { didCancel: true };
});

test("Android: a microphone refused for good offers Settings", async () => {
  (Platform as { OS: string }).OS = "android";
  jest.spyOn(PermissionsAndroid, "check").mockResolvedValue(false);
  jest.spyOn(PermissionsAndroid, "request").mockResolvedValue(PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN);
  const alert = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
  const openSettings = jest.spyOn(Linking, "openSettings").mockResolvedValue(undefined);
  await render();
  await pressLabel("Record a voice message");
  expect(alert).toHaveBeenCalledWith("Allow microphone access", "Allow microphone access in Settings to send voice messages.", expect.any(Array));
  const buttons = alert.mock.calls[0]![2]!;
  buttons.find((b) => b.text === "Open Settings")!.onPress!();
  expect(openSettings).toHaveBeenCalled();
  expect(tree.root.findAll((n) => n.props.accessibilityLabel === "Delete voice message")).toHaveLength(0); // not recording
});

test("iOS: when the recorder is refused the microphone, Settings is offered instead of 'not available'", async () => {
  (Platform as { OS: string }).OS = "ios";
  const nitro = require("react-native-nitro-sound");
  jest.spyOn(nitro, "createSound").mockReturnValue({
    addRecordBackListener: jest.fn(), removeRecordBackListener: jest.fn(), setSubscriptionDuration: jest.fn(),
    startRecorder: jest.fn(async () => { throw new Error("Recording permission denied. Please enable microphone access in Settings."); }),
    stopRecorder: jest.fn(async () => ""),
  });
  const alert = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
  await render();
  await pressLabel("Record a voice message");
  expect(alert.mock.calls[0]![2]!.map((b) => b.text)).toEqual(["Not now", "Open Settings"]);
  expect(tree.root.findAll((n) => n.props.children === "The microphone isn't available right now.")).toHaveLength(0);
});

test("a refused camera offers Settings (Android after 'don't ask again', iOS's 'permission' error)", async () => {
  const alert = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
  (Platform as { OS: string }).OS = "android";
  jest.spyOn(PermissionsAndroid, "request").mockResolvedValue(PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN);
  await render();
  await pressLabel("Take a photo or video");
  expect(alert.mock.calls.at(-1)![0]).toBe("Allow camera access");
  expect(alert.mock.calls.at(-1)![2]!.map((b) => b.text)).toContain("Open Settings");

  (Platform as { OS: string }).OS = "ios";
  (globalThis as unknown as { __picker: { camera?: unknown } }).__picker.camera = { errorCode: "permission" };
  await pressLabel("Take a photo or video");
  expect(alert.mock.calls.at(-1)![0]).toBe("Allow camera access");
  delete (globalThis as unknown as { __picker: { camera?: unknown } }).__picker.camera;
});

test("long-press a message to react, like Instagram: the reaction shows under it, a tap on it takes it back", async () => {
  const api = require("../src/api/conversations");
  await render();
  await act(async () => bubble("@alice: hello").props.onLongPress());
  const { Modal } = require("react-native");
  const picker = () => tree.root.findAllByType(Modal).find((m: ReactTestInstance) => m.findAll((n) => n.props.accessibilityLabel === "React ❤️").length > 0)!;
  expect(picker().props.visible).toBe(true);
  // The other person's message can also be reported from here.
  expect(picker().findAll((n) => n.props.accessibilityLabel === "Report message" && typeof n.props.onPress === "function")).toHaveLength(1);
  await pressLabel("React ❤️");
  await settle();
  expect(api.reactToMessage).toHaveBeenCalledWith("c1", "m2", "❤️", "token");
  expect(tree.root.findAllByType(Modal).every((m: ReactTestInstance) => !m.props.visible)).toBe(true);
  const pill = () => tree.root.findAll((n) => typeof n.props.onPress === "function" && n.props.accessibilityLabel === "Reactions: ❤️ from you");
  expect(pill()).toHaveLength(1);

  await act(async () => pill()[0]!.props.onPress());
  await settle();
  expect(api.removeMessageReaction).toHaveBeenCalledWith("c1", "m2", "token");
  expect(pill()).toHaveLength(0);

  // Your own messages: react, but no Report.
  await act(async () => bubble("You: hi").props.onLongPress());
  expect(picker().findAll((n) => n.props.accessibilityLabel === "Report message")).toHaveLength(0);
});

test("the other person's reaction arrives live, and a failed reaction is put back", async () => {
  const alert = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
  const api = require("../src/api/conversations");
  await render();
  await act(async () => mockRealtime.handler!({ type: "reaction", conversationId: "c1", messageId: "m1", userId: "u-alice", emoji: "😂" }));
  expect(tree.root.findAll((n) => n.props.accessibilityLabel === "Reactions: 😂 from @alice" && typeof n.props.onPress === "function")).toHaveLength(1);
  await act(async () => mockRealtime.handler!({ type: "reaction", conversationId: "c1", messageId: "m1", userId: "u-alice", emoji: null }));
  expect(tree.root.findAll((n) => typeof n.props.accessibilityLabel === "string" && n.props.accessibilityLabel.startsWith("Reactions:"))).toHaveLength(0);

  api.reactToMessage.mockRejectedValueOnce(new Error("offline"));
  await act(async () => bubble("@alice: hello").props.onLongPress());
  await pressLabel("React 👍");
  await settle();
  expect(tree.root.findAll((n) => typeof n.props.accessibilityLabel === "string" && n.props.accessibilityLabel.startsWith("Reactions:"))).toHaveLength(0);
  expect(alert.mock.calls.at(-1)![0]).toBe("Couldn't react");
});

test("the DM camera shows what it took with the Story filters before sending; a photo goes with the filter baked in", async () => {
  const sendMedia = require("../src/screens/dm/sendMedia");
  const sent = jest.spyOn(sendMedia, "sendPendingMedia").mockImplementation(() => new Promise(() => undefined));
  (Platform as { OS: string }).OS = "ios";
  const picker = (globalThis as unknown as { __picker: { camera?: unknown } }).__picker;
  picker.camera = { assets: [{ uri: "file:///cache/cam.jpg", type: "image/jpeg", width: 1000, height: 1500 }] };
  await render();
  await pressLabel("Take a photo or video");
  expect(sent).not.toHaveBeenCalled();
  await pressLabel("Warm filter");
  await pressLabel("Send photo");
  await settle();
  expect(sent).toHaveBeenCalledTimes(1);
  // The outbox keeps its own copy of the filtered photo, not of the one the camera took.
  const fs = require("@dr.pogodin/react-native-fs");
  expect(fs.copyFile.mock.calls.at(-1)![0]).toContain("cam.jpg#warm@2048");

  // A video carries the filter's name for the server.
  picker.camera = { assets: [{ uri: "file:///cache/cam.mp4", type: "video/mp4", width: 1080, height: 1920, fileSize: 1000 }] };
  await pressLabel("Take a photo or video");
  await pressLabel("Cool filter");
  await pressLabel("Send video");
  await settle();
  expect(sent.mock.calls[1]![1]).toMatchObject({ mediaKind: "video", filter: "cool" });

  // Discard sends nothing.
  await pressLabel("Take a photo or video");
  await pressLabel("Discard");
  await settle();
  expect(sent).toHaveBeenCalledTimes(2);
  delete picker.camera;
});

test("swipe or choose Reply to answer a message: the box says what you're replying to, and the reply carries it", async () => {
  const outbox = require("../src/state/dmOutbox");
  outbox.enqueueMessage.mockClear();
  await render();
  await act(async () => bubble("@alice: hello").props.onLongPress());
  await pressLabel("Reply");
  const texts = () => tree.root.findAll((n) => typeof n.props.children === "string").map((n) => n.props.children as string);
  expect(texts()).toEqual(expect.arrayContaining(["hello"]));
  expect(tree.root.findAll((n) => Array.isArray(n.props.children) && n.props.children.join("") === "Replying to @alice")).not.toHaveLength(0);
  await act(async () => tree.root.findByType(TextInput).props.onChangeText("see you there"));
  await pressLabel("Send");
  expect(outbox.enqueueMessage).toHaveBeenCalledWith("u-me", "c1", { body: "see you there", replyToMessageId: "m2" });
  expect(tree.root.findAll((n) => n.props.accessibilityLabel === "Cancel reply")).toHaveLength(0);

  // Screen readers reply from the message's actions; Cancel drops the reply.
  await act(async () => bubble("You: hi").props.onAccessibilityAction({ nativeEvent: { actionName: "reply" } }));
  expect(tree.root.findAll((n) => Array.isArray(n.props.children) && n.props.children.join("") === "Replying to yourself")).not.toHaveLength(0);
  await pressLabel("Cancel reply");
  await act(async () => tree.root.findByType(TextInput).props.onChangeText("no reply"));
  await pressLabel("Send");
  expect(outbox.enqueueMessage).toHaveBeenLastCalledWith("u-me", "c1", { body: "no reply" });
});

test("a reply shows the message it quotes above it, and Seen under your last message once it's read", async () => {
  const api = require("../src/api/conversations");
  api.listMessages.mockResolvedValueOnce({
    hasMore: false,
    messages: [
      { id: "m3", conversationId: "c1", senderId: "u-me", body: "yes!", sharedStoryId: null, createdAt: "2026-10-06 09:02:00+00", status: "read",
        replyTo: { id: "m2", senderId: "u-alice", body: "hello", mediaKind: null, sharedStory: false } },
      { id: "m2", conversationId: "c1", senderId: "u-alice", body: "hello", sharedStoryId: null, createdAt: "2026-10-06 09:01:00+00",
        replyTo: { id: "m0", senderId: "u-alice", body: null, mediaKind: "photo", sharedStory: false } },
    ],
  });
  await render();
  expect(tree.root.findAll((n) => n.props.accessibilityLabel === "Replying to @alice: hello" && typeof n.props.onPress === "function")).toHaveLength(1);
  expect(tree.root.findAll((n) => n.props.accessibilityLabel === "Replying to @alice: Photo" && typeof n.props.onPress === "function")).toHaveLength(1);
  expect(tree.root.findAll((n) => typeof n.props.children === "string" && n.props.children === "Seen")).not.toHaveLength(0);
});

test("a double tap on a message hearts it, and another double tap takes the heart back", async () => {
  const api = require("../src/api/conversations");
  api.reactToMessage.mockClear();
  await render();
  await act(async () => { bubble("@alice: hello").props.onPress(); bubble("@alice: hello").props.onPress(); });
  await settle();
  expect(api.reactToMessage).toHaveBeenCalledWith("c1", "m2", "❤️", "token");
  expect(tree.root.findAll((n) => n.props.accessibilityLabel === "Reactions: ❤️ from you" && typeof n.props.onPress === "function")).toHaveLength(1);
  // A heart pops on the message (an icon, not an emoji glyph).
  expect(bubble("@alice: hello").findAll((n) => n.props.name === "liked")).not.toHaveLength(0);
  await act(async () => { bubble("@alice: hello").props.onPress(); bubble("@alice: hello").props.onPress(); });
  await settle();
  expect(api.removeMessageReaction).toHaveBeenCalledWith("c1", "m2", "token");
  // One tap on a plain message does nothing.
  await act(async () => { bubble("You: hi").props.onPress(); await new Promise<void>((r) => setTimeout(r, 320)); });
  expect(api.reactToMessage).toHaveBeenCalledTimes(1);
});

test("\"typing…\" shows while the other person types and goes when their message arrives; yours goes out at most every few seconds", async () => {
  const api = require("../src/api/conversations");
  api.sendTyping.mockClear();
  await render();
  const typing = () => tree.root.findAll((n) => typeof n.props.children === "string" && n.props.children === "@alice is typing…");
  expect(typing()).toHaveLength(0);
  await act(async () => mockRealtime.handler!({ type: "typing", conversationId: "c1", userId: "u-alice" }));
  expect(typing()).not.toHaveLength(0);
  await act(async () => mockRealtime.handler!({ type: "message", conversationId: "c1", messageId: "m9", senderId: "u-alice", createdAt: "2026-10-06 09:05:00+00" }));
  expect(typing()).toHaveLength(0);
  // Your own other phone typing, or another chat, doesn't show here.
  await act(async () => mockRealtime.handler!({ type: "typing", conversationId: "c1", userId: "u-me" }));
  await act(async () => mockRealtime.handler!({ type: "typing", conversationId: "c2", userId: "u-alice" }));
  expect(typing()).toHaveLength(0);

  await act(async () => tree.root.findByType(TextInput).props.onChangeText("h"));
  await act(async () => tree.root.findByType(TextInput).props.onChangeText("he"));
  await act(async () => tree.root.findByType(TextInput).props.onChangeText("hey"));
  expect(api.sendTyping).toHaveBeenCalledTimes(1);
  expect(api.sendTyping).toHaveBeenCalledWith("c1", "token");
});

test("a group thread: who said what, what happened, Seen by, and who is typing", async () => {
  const api = require("../src/api/conversations");
  const member = (userId: string, username: string, displayName: string, role = "member") => ({ userId, username, displayName, avatarMediaId: null, role, joinedAt: "" });
  api.getConversation.mockResolvedValue({ conversation: { id: "c1", kind: "group", createdAt: "", title: "Goa trip", otherUser: null, role: "admin",
    members: [member("u-me", "me", "Me", "admin"), member("u-alice", "alice", "Alice"), member("u-bob", "bob", "Bob")] } });
  api.groupName = (title: string | null) => title ?? "Group";
  const original = api.listMessages.getMockImplementation();
  api.listMessages.mockResolvedValue({ hasMore: false, messages: [
    { id: "g5", conversationId: "c1", senderId: "u-me", body: "8 it is", sharedStoryId: null, createdAt: "2026-10-06 09:05:00+00", status: "delivered", seenBy: ["u-alice"] },
    { id: "g4", conversationId: "c1", senderId: "u-bob", body: "8?", sharedStoryId: null, createdAt: "2026-10-06 09:04:00+00" },
    { id: "g3", conversationId: "c1", senderId: "u-alice", body: "or 9", sharedStoryId: null, createdAt: "2026-10-06 09:03:00+00" },
    { id: "g2", conversationId: "c1", senderId: "u-alice", body: "dinner at 8", sharedStoryId: null, createdAt: "2026-10-06 09:02:00+00" },
    { id: "g1", conversationId: "c1", senderId: "u-me", body: null, sharedStoryId: null, createdAt: "2026-10-06 09:01:00+00", event: { type: "added", userIds: ["u-bob"] } },
  ] });
  const groupProps = { route: { params: { conversationId: "c1", group: true, title: "Goa trip" } } } as unknown as Props;
  await act(async () => { tree = create(<ConversationScreen {...groupProps} />); });
  for (let i = 0; i < 4; i++) await act(async () => { await Promise.resolve(); });
  const texts = () => tree.root.findAll((n) => typeof n.props.children === "string").map((n) => n.props.children as string);
  expect(texts()).toEqual(expect.arrayContaining(["You added @bob", "Seen by @alice", "Alice", "Bob"]));
  const hostTexts = tree.root.findAll((n) => typeof n.type === "string" && n.props.children === "Alice");
  expect(hostTexts).toHaveLength(1); // once, above the first of her two messages
  expect(bubble("@alice: or 9")).toBeTruthy();

  const options = mockNavigation.setOptions.mock.calls.at(-1)![0] as { headerTitle: () => React.ReactElement };
  let header!: ReactTestRenderer;
  act(() => { header = create(options.headerTitle()); });
  expect(header.root.findAll((n) => n.props.accessibilityLabel === "Goa trip, 3 people")).not.toHaveLength(0);
  act(() => header.root.find((n) => n.props.accessibilityHint === "Shows the group's people and settings" && typeof n.props.onPress === "function").props.onPress());
  expect(mockNavigation.navigate).toHaveBeenCalledWith("GroupInfo", { conversationId: "c1" });

  await act(async () => mockRealtime.handler!({ type: "typing", conversationId: "c1", userId: "u-bob" }));
  expect(texts()).toContain("@bob is typing…");
  api.getConversation.mockReset();
  api.listMessages.mockImplementation(original);
});

test("long-press: Copy your text, Unsend your own message (gone for everyone), Report theirs", async () => {
  const api = require("../src/api/conversations");
  const clip = require("@react-native-clipboard/clipboard"); const Clipboard = clip.default ?? clip;
  const alert = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
  await render();
  await act(async () => bubble("You: hi").props.onLongPress());
  expect(tree.root.findAll((n) => n.props.accessibilityLabel === "Report message")).toHaveLength(0);
  await pressLabel("Copy");
  expect(Clipboard.setString).toHaveBeenCalledWith("hi");

  await act(async () => bubble("You: hi").props.onLongPress());
  await pressLabel("Unsend");
  expect(alert.mock.calls.at(-1)![0]).toBe("Unsend message?");
  await act(async () => { await (alert.mock.calls.at(-1)![2] as Array<{ text: string; onPress?: () => Promise<void> }>).find((b) => b.text === "Unsend")!.onPress!(); });
  expect(api.unsendMessage).toHaveBeenCalledWith("c1", "m1", "token");
  expect(tree.root.findAll((n) => n.props.accessibilityLabel === "You: hi")).toHaveLength(0);

  // Their message, unsent by them: gone live.
  await act(async () => mockRealtime.handler!({ type: "unsent", conversationId: "c1", messageId: "m2" }));
  expect(tree.root.findAll((n) => n.props.accessibilityLabel === "@alice: hello")).toHaveLength(0);
});

test("the chat menu mutes the chat's notifications", async () => {
  const api = require("../src/api/conversations");
  const alert = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
  api.getConversation.mockResolvedValue({ conversation: { id: "c1", kind: "direct", muted: false, createdAt: "", otherUser: { id: "u-alice", username: "alice", displayName: "Alice" } } });
  await render();
  const options = mockNavigation.setOptions.mock.calls.at(-1)![0];
  let header!: ReactTestRenderer;
  act(() => { header = create((options as { headerRight: () => React.ReactElement }).headerRight()); });
  await act(async () => header.root.find((n) => n.props.accessibilityLabel === "Chat options" && typeof n.props.onPress === "function").props.onPress());
  const { Modal } = require("react-native");
  const sheet = tree.root.findAllByType(Modal).find((m: ReactTestInstance) => m.props.visible && m.findAll((n) => n.props.accessibilityLabel === "Mute notifications").length)!;
  expect(sheet).toBeTruthy();
  await act(async () => sheet.find((n) => n.props.accessibilityLabel === "Mute notifications" && typeof n.props.onPress === "function").props.onPress());
  await act(async () => sheet.props.onDismiss?.()); // iOS runs the choice once the sheet has closed
  for (let i = 0; i < 5; i++) await act(async () => { await Promise.resolve(); });
  expect(api.setConversationMuted).toHaveBeenCalledWith("c1", true, "token");
  api.getConversation.mockReset();
  alert.mockRestore();
});

test("a shared Story is a card with its picture and owner, or says it's no longer available", async () => {
  const api = require("../src/api/conversations");
  const original = api.listMessages.getMockImplementation();
  api.listMessages.mockResolvedValue({ hasMore: false, messages: [
    { id: "s2", conversationId: "c1", senderId: "u-alice", body: null, sharedStoryId: "st2", createdAt: "2026-10-06 09:02:00+00", sharedStory: { ownerUsername: "bob", ownerAvatarMediaId: null, mediaId: null, active: false } },
    { id: "s1", conversationId: "c1", senderId: "u-alice", body: null, sharedStoryId: "st1", createdAt: "2026-10-06 09:01:00+00", sharedStory: { ownerUsername: "bob", ownerAvatarMediaId: null, mediaId: "md9", active: true } },
  ] });
  await render();
  expect(tree.root.findAll((n) => (n.type as unknown) === "Image" && n.props.source?.uri === "/media/md9/thumbnail")).not.toHaveLength(0);
  expect(bubble("@alice: @bob's Story")).toBeTruthy();
  expect(bubble("@alice: @bob's Story, no longer available")).toBeTruthy();
  api.listMessages.mockImplementation(original);
});

test("long-press: Forward opens the picker for that message; a forwarded message says Forwarded", async () => {
  const api = require("../src/api/conversations");
  const original = api.listMessages.getMockImplementation();
  api.listMessages.mockResolvedValue({ hasMore: false, messages: [
    { id: "f1", conversationId: "c1", senderId: "u-alice", body: "ferry at 7", sharedStoryId: null, createdAt: "2026-10-06 09:02:00+00", forwarded: true },
    { id: "m1", conversationId: "c1", senderId: "u-me", body: "hi", sharedStoryId: null, createdAt: "2026-10-06 09:00:00+00" },
  ] });
  await render();
  const { Text } = require("react-native");
  expect(tree.root.findAllByType(Text).filter((t: ReactTestInstance) => t.props.children === "Forwarded")).toHaveLength(1); // only on the forwarded one
  await act(async () => bubble("@alice: Forwarded. ferry at 7").props.onLongPress());
  expect(tree.root.findAll((n) => n.props.accessibilityLabel === "Pin" && typeof n.props.onPress === "function")).toHaveLength(1);
  await pressLabel("Forward");
  // iOS: the screen opens once the menu has finished closing.
  expect(mockNavigation.navigate).not.toHaveBeenCalledWith("ForwardMessage", expect.anything());
  const { Modal } = require("react-native");
  const menu = tree.root.findAllByType(Modal).find((m: ReactTestInstance) => typeof m.props.onDismiss === "function" && m.props.animationType === "fade" && m.props.transparent)!;
  await act(async () => menu.props.onDismiss());
  expect(mockNavigation.navigate).toHaveBeenCalledWith("ForwardMessage", { conversationId: "c1", messageId: "f1" });
  api.listMessages.mockImplementation(original);
  mockNavigation.navigate.mockClear();
});

test("pins: the bar shows the latest pin and how many; the list unpins; a fourth pin offers to replace the oldest", async () => {
  const api = require("../src/api/conversations");
  const { ApiError } = require("../src/api/client");
  const alert = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
  const pinOf = (id: string, message: object, at: string) => ({ messageId: id, pinnedBy: { id: "u-alice", username: "alice" }, pinnedAt: at, message: { id, conversationId: "c1", sharedStoryId: null, createdAt: at, ...message } });
  const three = [
    pinOf("m0", { senderId: "u-alice", body: null, media: { id: "md1", kind: "photo", width: 1, height: 1, durationMs: null } }, "2026-10-06 10:02:00+00"),
    pinOf("v1", { senderId: "u-me", body: null, media: { id: "md2", kind: "audio", width: null, height: null, durationMs: 3000 } }, "2026-10-06 10:01:00+00"),
    pinOf("x1", { senderId: "u-alice", body: "see you\nat the dock" }, "2026-10-06 10:00:00+00"),
  ];
  const bar = () => tree.root.find((n) => n.props.accessibilityHint === "Shows the pinned messages" && typeof n.props.onPress === "function");
  api.listPins.mockResolvedValue({ pins: three });
  await render();
  expect(bar().props.accessibilityLabel).toBe("Pinned: Photo, 3 pinned messages");
  await act(async () => bar().props.onPress());
  const rows = tree.root.findAll((n) => typeof n.props.onPress === "function" && n.props.accessibilityHint === "Shows it in the chat, if it's loaded").map((n) => n.props.accessibilityLabel);
  expect(rows).toEqual(["@alice: Photo", "You: Voice message", "@alice: see you at the dock"]);
  api.listPins.mockResolvedValue({ pins: three.slice(1) });
  await pressLabel("Unpin Photo");
  expect(api.unpinMessage).toHaveBeenCalledWith("c1", "m0", "token");
  expect(bar().props.accessibilityLabel).toBe("Pinned: Voice message, 2 pinned messages");

  // Someone else pins: the bar follows (realtime), and the menu then says Unpin.
  api.listPins.mockResolvedValue({ pins: [pinOf("m2", { senderId: "u-alice", body: "hello" }, "2026-10-06 11:00:00+00"), ...three.slice(1)] });
  await act(async () => mockRealtime.handler!({ type: "pins_changed", conversationId: "c1" }));
  expect(bar().props.accessibilityLabel).toBe("Pinned: hello, 3 pinned messages");
  await act(async () => bubble("@alice: hello").props.onLongPress());
  expect(tree.root.findAll((n) => n.props.accessibilityLabel === "Unpin" && typeof n.props.onPress === "function")).toHaveLength(1);

  // A fourth: the server says too_many_pins; Replace oldest unpins the oldest, then pins.
  api.pinMessage.mockRejectedValueOnce(new ApiError(409, "You can pin up to 3 messages.", undefined, { code: "too_many_pins" }));
  await act(async () => bubble("You: hi").props.onLongPress());
  await pressLabel("Pin");
  expect(alert.mock.calls.at(-1)![0]).toBe("Replace the oldest pin?");
  api.unpinMessage.mockClear();
  await act(async () => { await (alert.mock.calls.at(-1)![2] as Array<{ text: string; onPress?: () => Promise<void> }>).find((b) => b.text === "Replace oldest")!.onPress!(); });
  expect(api.unpinMessage).toHaveBeenCalledWith("c1", "x1", "token");
  expect(api.pinMessage).toHaveBeenLastCalledWith("c1", "m1", "token");

  // Unsent: its pin goes with it.
  await act(async () => mockRealtime.handler!({ type: "unsent", conversationId: "c1", messageId: "m2" }));
  expect(bar().props.accessibilityLabel).toBe("Pinned: Voice message, 2 pinned messages");
  api.listPins.mockResolvedValue({ pins: [] });
  alert.mockRestore();
});
