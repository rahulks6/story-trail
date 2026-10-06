import React from "react";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { Keyboard, KeyboardAvoidingView, Platform, StyleSheet, TextInput, View } from "react-native";
import { ConversationScreen } from "../src/screens/dm/ConversationScreen";

// The DM thread as the DM tab shows it, with the network, outbox and realtime replaced.
// Hooks return stable values, as the app's providers do (the thread's effects depend on them).
const mockAuth = { accessToken: "token", user: { id: "u-me", username: "me" } };
const mockDM = { refreshUnreadCount: jest.fn() };
const mockNavigation = { navigate: jest.fn(), setParams: jest.fn() };
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
  getConversation: jest.fn(),
  markConversationRead: jest.fn(async () => undefined),
  listMessages: jest.fn(async () => ({
    hasMore: false,
    messages: [
      { id: "m2", conversationId: "c1", senderId: "u-alice", body: "hello", sharedStoryId: null, createdAt: "2026-10-06 09:01:00+00" },
      { id: "m1", conversationId: "c1", senderId: "u-me", body: "hi", sharedStoryId: null, createdAt: "2026-10-06 09:00:00+00", status: "read" },
    ],
  })),
}));
jest.mock("../src/api/stories", () => ({ getStoryOwnerUsername: jest.fn() }));
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
  const shown = addListener.mock.calls.filter(([name]) => name === "keyboardDidShow").at(-1)![1] as (e: unknown) => void;
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
