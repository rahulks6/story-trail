import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { Text } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { InAppNotificationBanner, isAboutCurrentScreen } from "../src/components/InAppNotificationBanner";
import type { ForegroundNotice } from "../src/push/pushNotifications";

// A push that arrives while the app is open shows a banner, unless it's about what's on screen.
let mockDeliver: ((notice: ForegroundNotice) => void) | null = null;
jest.mock("../src/push/pushNotifications", () => ({
  onForegroundPush: (listener: (notice: ForegroundNotice) => void) => {
    mockDeliver = listener;
    return () => { mockDeliver = null; };
  },
}));

const CONV = "11111111-2222-4333-8444-555555555555";
const OTHER = "99999999-2222-4333-8444-555555555555";
const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
const message = (id: string): ForegroundNotice => ({ title: "asha", body: "are you coming tonight?", url: `katkee://conversation/${id}` });

let tree: ReactTestRenderer;
let route: { name: string; params?: object } | undefined;
const open = jest.fn();
beforeEach(async () => {
  jest.useFakeTimers();
  route = { name: "Home" };
  open.mockReset();
  await act(async () => {
    tree = create(<SafeAreaProvider initialMetrics={metrics}><InAppNotificationBanner currentRoute={() => route} open={open} /></SafeAreaProvider>);
  });
});
afterEach(async () => {
  await act(async () => tree.unmount());
  jest.useRealTimers();
});
const texts = () => tree.root.findAllByType(Text).map((t) => [t.props.children].flat().join(""));

test("a new message while you're elsewhere in the app shows a banner that opens the chat", async () => {
  await act(async () => mockDeliver!(message(CONV)));
  expect(texts()).toEqual(["asha", "are you coming tonight?"]);
  const card = tree.root.find((n) => n.props.accessibilityLabel === "asha. are you coming tonight?" && typeof n.props.onPress === "function");
  await act(async () => card.props.onPress());
  expect(open).toHaveBeenCalledWith(`katkee://conversation/${CONV}`);
});

test("no banner for the chat you're in; another chat still shows one", async () => {
  route = { name: "Conversation", params: { conversationId: CONV } };
  await act(async () => mockDeliver!(message(CONV)));
  expect(texts()).toEqual([]);
  await act(async () => mockDeliver!(message(OTHER)));
  expect(texts()).toContain("asha");
});

test("it goes by itself after a few seconds", async () => {
  await act(async () => mockDeliver!(message(CONV)));
  expect(texts()).toContain("asha");
  await act(async () => { jest.advanceTimersByTime(5000); });
  expect(texts()).toEqual([]);
});

test("what counts as already on screen", () => {
  expect(isAboutCurrentScreen("katkee://activity", { name: "Activity" })).toBe(true);
  expect(isAboutCurrentScreen("katkee://activity", { name: "Home" })).toBe(false);
  expect(isAboutCurrentScreen(null, { name: "Home" })).toBe(false);
});

test("festival, streak and follow-request pushes open their screens when tapped", () => {
  const { notificationLink } = jest.requireActual("../src/push/pushNotifications");
  expect(notificationLink({ data: { url: "katkee://home" } })).toBe("katkee://home");
  expect(notificationLink({ data: { url: "katkee://follow-requests" } })).toBe("katkee://follow-requests");
  expect(notificationLink({ data: { url: "https://evil.example/home" } })).toBeNull();
});
