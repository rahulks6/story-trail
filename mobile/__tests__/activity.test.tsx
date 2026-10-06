import React from "react";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { SectionList, Text } from "react-native";
import { ActivityScreen } from "../src/screens/activity/ActivityScreen";
import * as notificationsApi from "../src/api/notifications";

// Activity as the tab shows it, with the network replaced. Hooks return stable values, as the
// app's providers do.
const mockAuth = { accessToken: "token", user: { id: "u-me", username: "me" } };
const mockNotifications = { refreshUnreadCount: jest.fn(async () => undefined) };
const mockNavigation = { navigate: jest.fn() };
jest.mock("../src/state/AuthContext", () => ({ useAuth: () => mockAuth }));
jest.mock("../src/state/NotificationsContext", () => ({ useNotifications: () => mockNotifications }));
jest.mock("../src/state/RealtimeContext", () => ({ useRealtimeEvents: () => undefined }));
jest.mock("../src/push/usePushRegistration", () => ({ askForPushOnce: jest.fn(async () => undefined) }));
jest.mock("../src/api/stories", () => ({ getStoryOwnerUsername: jest.fn() }));
jest.mock("../src/api/notifications", () => ({
  listNotifications: jest.fn(),
  markAllNotificationsRead: jest.fn(async () => undefined),
  markNotificationRead: jest.fn(async () => undefined),
}));
jest.mock("@react-navigation/native", () => ({
  ...jest.requireActual("@react-navigation/native"),
  useNavigation: () => mockNavigation,
  useFocusEffect: (effect: () => void) => require("react").useEffect(() => effect(), [effect]),
}));

const list = notificationsApi.listNotifications as jest.Mock;
const hoursAgo = (h: number) => new Date(Date.now() - h * 3600e3).toISOString();
const follow = (id: string, user: string, h: number, read: boolean) => ({
  id, type: "follow", createdAt: hoursAgo(h), readAt: read ? hoursAgo(h) : null,
  actor: { id: `u-${user}`, username: user, displayName: user }, story: null, comment: null, followRequest: null,
});
const page = (n: number, from = 0) => Array.from({ length: n }, (_, i) => follow(`n${from + i}`, `user${from + i}`, 2 + i, i > 0));

let tree: ReactTestRenderer;
afterEach(async () => {
  await act(async () => tree?.unmount());
  list.mockReset();
});
async function render(): Promise<void> {
  await act(async () => { tree = create(<ActivityScreen />); });
  for (let i = 0; i < 3; i++) await act(async () => { await Promise.resolve(); });
}
const texts = () => tree.root.findAllByType(Text).map((t) => [t.props.children].flat().join(""));
const button = (label: string) => tree.root.find((n: ReactTestInstance) => typeof n.props.onPress === "function" && n.props.accessibilityLabel === label);

test("a failed first load offers Try again instead of spinning forever", async () => {
  list.mockRejectedValueOnce(new Error("offline")).mockResolvedValue({ notifications: page(2) });
  await render();
  expect(texts()).toContain("Couldn't load your activity. Check your connection and try again.");
  await act(async () => button("Try again").props.onPress());
  for (let i = 0; i < 3; i++) await act(async () => { await Promise.resolve(); });
  expect(texts().some((t) => t.includes("Couldn't load"))).toBe(false);
  expect(tree.root.findAllByType(SectionList)).toHaveLength(1);
});

test("rows say what happened, how long ago and whether it is unread; filters are tabs", async () => {
  list.mockResolvedValue({ notifications: page(2) });
  await render();
  const rows = tree.root.findAll((n) => n.props.accessibilityRole === "button" && typeof n.props.onPress === "function" && /started following you/.test(n.props.accessibilityLabel ?? ""));
  expect(rows.map((r) => r.props.accessibilityLabel)).toEqual([
    expect.stringMatching(/^.*user0.*started following you\. 2h ago\. Unread$/),
    expect.stringMatching(/^.*user1.*started following you\. 3h ago$/),
  ]);
  expect(texts()).toContain("2h ago");
  const tabs = tree.root.findAll((n) => typeof n.type === "string" && n.props.accessibilityRole === "tab");
  expect(tabs.map((t) => [t.props.accessibilityLabel, t.props.accessibilityState.selected])).toEqual([
    ["All", true], ["Likes", false], ["Comments", false], ["Follows", false], ["Mentions", false],
  ]);
});

test("a failed next page waits for Try again rather than retrying on every scroll", async () => {
  list.mockResolvedValueOnce({ notifications: page(20) }).mockRejectedValueOnce(new Error("offline")).mockResolvedValue({ notifications: page(3, 20) });
  await render();
  const sections = () => tree.root.findByType(SectionList);
  await act(async () => { await sections().props.onEndReached(); });
  expect(list).toHaveBeenCalledTimes(2);
  await act(async () => { await sections().props.onEndReached(); }); // scrolling again does not hammer the server
  expect(list).toHaveBeenCalledTimes(2);
  await act(async () => { await button("Couldn't load more. Try again").props.onPress(); });
  expect(list).toHaveBeenCalledTimes(3);
  expect(list).toHaveBeenLastCalledWith("token", { limit: 20, offset: 20 });
});
