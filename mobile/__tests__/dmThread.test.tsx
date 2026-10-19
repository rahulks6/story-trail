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
jest.mock("../src/state/RealtimeContext", () => ({ useRealtime: () => ({ connected: true }), useRealtimeEvents: () => undefined }));
jest.mock("../src/state/dmOutbox", () => ({
  discardMessage: jest.fn(), enqueueMessage: jest.fn(async () => undefined), flushOutbox: jest.fn(async () => undefined),
  loadOutbox: jest.fn(async () => undefined), onOutboxSent: () => () => undefined, pendingMessages: () => [],
  retryMessage: jest.fn(), subscribeOutbox: () => () => undefined,
}));
jest.mock("../src/api/conversations", () => ({
  MAX_MESSAGE_LENGTH: 1000,
  newClientMessageId: () => `m_test_${Math.random().toString(36).slice(2, 12)}`,
  getConversation: jest.fn(),
  markConversationRead: jest.fn(async () => undefined),
  listMessages: jest.fn(async () => ({
    hasMore: false,
    messages: [
      { id: "m2", conversationId: "c1", senderId: "u-alice", body: "hello", sharedStoryId: null, createdAt: "2026-10-06 09:01:00+00" },
      { id: "m1", conversationId: "c1", senderId: "u-me", body: "hi", sharedStoryId: null, createdAt: "2026-10-06 09:00:00+00", status: "read" },
      { id: "m0", conversationId: "c1", senderId: "u-alice", body: null, sharedStoryId: null, createdAt: "2026-10-06 08:59:00+00", media: { id: "md1", kind: "photo", width: 1080, height: 1350, durationMs: null } },
    ],
  })),
}));
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
  expect(mine.props.accessibilityActions).toBeUndefined();
  expect(theirs.props.accessibilityActions).toEqual([{ name: "report", label: "Report message" }]);

  const sheet = () => tree.root.find((n: ReactTestInstance) => (n.type as unknown) === "ReportSheet");
  expect(sheet().props.visible).toBe(false);
  await act(async () => theirs.props.onAccessibilityAction({ nativeEvent: { actionName: "report" } }));
  expect(sheet().props).toMatchObject({ visible: true, targetType: "message", targetId: "m2", conversationId: "c1" });
});

test("the emoji panel replaces the keyboard instead of stacking on it", async () => {
  const dismiss = jest.spyOn(Keyboard, "dismiss");
  await render();
  const toggle = () => tree.root.find((n) => typeof n.props.onPress === "function" && /emoji picker/.test(n.props.accessibilityLabel ?? ""));
  expect(toggle().props.accessibilityLabel).toBe("Show emoji picker");
  await act(async () => toggle().props.onPress());
  expect(dismiss).toHaveBeenCalledTimes(1);
  expect(toggle().props.accessibilityLabel).toBe("Hide emoji picker");
  await act(async () => toggle().props.onPress());
  expect(dismiss).toHaveBeenCalledTimes(1); // closing the panel leaves the keyboard alone
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
  await act(async () => photo.props.onPress());
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
