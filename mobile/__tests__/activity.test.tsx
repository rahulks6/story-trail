import React from "react";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { SectionList, Text } from "react-native";
import { ActivityScreen } from "../src/screens/activity/ActivityScreen";
import * as notificationsApi from "../src/api/notifications";

// Activity as the tab shows it, with the network replaced. Hooks return stable values, as the
// app's providers do.
const mockAuth = { accessToken: "token", user: { id: "u-me", username: "me" } };
const mockNotifications = { refreshUnreadCount: jest.fn(async () => undefined) };
const mockNavigation = { navigate: jest.fn(), goBack: jest.fn(), canGoBack: () => true };
jest.mock("../src/state/AuthContext", () => ({ useAuth: () => mockAuth }));
jest.mock("../src/state/NotificationsContext", () => ({ useNotifications: () => mockNotifications }));
jest.mock("../src/state/RealtimeContext", () => ({ useRealtimeEvents: () => undefined }));
jest.mock("../src/push/usePushRegistration", () => ({ askForPushOnce: jest.fn(async () => undefined) }));
jest.mock("../src/api/stories", () => ({ getStoryOwnerUsername: jest.fn(), mediaFileUrl: (id: string, v: string) => `/media/${id}/${v}` }));
jest.mock("../src/api/users", () => ({
  ...jest.requireActual("../src/api/users"),
  followUser: jest.fn(async () => ({ status: "following" })),
  acceptFollowRequest: jest.fn(async () => undefined),
  declineFollowRequest: jest.fn(async () => undefined),
}));
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
    ["All", true], ["Follows", false], ["Comments", false],
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

test("an accepted request and a Story mention say so; a request opens Follow requests; a profile keeps Search underneath", async () => {
  const actor = (user: string) => ({ id: `u-${user}`, username: user, displayName: user });
  list.mockResolvedValue({
    notifications: [
      { ...follow("a", "carol", 1, false), type: "follow_accepted", actor: actor("carol") },
      { ...follow("m", "dan", 2, false), type: "mention", actor: actor("dan"), story: null, comment: null },
      { ...follow("r", "erin", 3, false), type: "follow_request", actor: actor("erin") },
    ],
  });
  await render();
  const row = (re: RegExp) => tree.root.find((n) => n.props.accessibilityRole === "button" && typeof n.props.onPress === "function" && re.test(n.props.accessibilityLabel ?? ""));
  expect(row(/carol.*accepted your follow request/)).toBeTruthy();
  expect(row(/dan.*mentioned you in their Story/)).toBeTruthy();

  await act(async () => row(/erin.*requested to follow you/).props.onPress());
  expect(mockNavigation.navigate).toHaveBeenCalledWith("FollowRequests");

  await act(async () => row(/carol.*accepted/).props.onPress());
  expect(mockNavigation.navigate).toHaveBeenCalledWith("Main", { screen: "Search", params: { screen: "UserProfile", params: { username: "carol" }, initial: false } });
});

test("rows end with what you'd do next: Follow back, Confirm or Delete a request, or the Story's picture", async () => {
  const users = require("../src/api/users");
  const actor = (u: string, followedByYou = false) => ({ id: `u-${u}`, username: u, displayName: u, followedByYou });
  list.mockResolvedValue({ notifications: [
    { ...follow("f1", "ana", 1, false), actor: actor("ana") },
    { ...follow("f2", "ben", 2, false), actor: actor("ben", true) },
    { ...follow("r1", "cy", 3, false), type: "follow_request", actor: actor("cy"), followRequest: { id: "req1", status: "pending" } },
    { ...follow("l1", "dee", 4, false), type: "like", actor: actor("dee"), story: { id: "st1", mediaId: "md1" } },
  ] });
  await render();
  expect(tree.root.findAll((n) => n.props.accessibilityLabel === "Follow @ben back")).toHaveLength(0); // already following
  await act(async () => button("Follow @ana back").props.onPress());
  expect(users.followUser).toHaveBeenCalledWith("ana", "token");
  expect(texts()).toContain("Following");
  await act(async () => button("Confirm @cy").props.onPress());
  expect(users.acceptFollowRequest).toHaveBeenCalledWith("req1", "token");
  expect(texts()).toContain("Accepted");
  expect(tree.root.findAll((n) => (n.type as unknown) === "Image" && n.props.source?.uri === "/media/md1/thumbnail")).not.toHaveLength(0);
});

test("verification updates have no actor: the badge instead of a photo, and they open Request verification", async () => {
  const about = (id: string, status: string, h: number) => ({ ...follow(id, "x", h, false), type: "verification", actor: null, verification: { status, reason: null } });
  list.mockResolvedValue({ notifications: [
    about("v1", "approved", 1), about("v2", "denied", 2), about("v3", "removed", 3), about("v4", "restored", 4),
    { ...follow("f1", "news_desk", 5, true), actor: { id: "u-n", username: "news_desk", displayName: "News Desk", verified: true } },
  ] });
  await render();
  expect(texts()).toEqual(expect.arrayContaining([
    "You're verified. Your badge now shows on your profile.",
    "Your verification request wasn't approved.",
    "Your verified badge was removed.",
    "Your verified badge is showing again.",
  ]));
  expect(tree.root.findAll((n) => n.props.username === "" && n.props.displayName === "?")).toHaveLength(0);
  // A verified actor's name carries the badge, inside the sentence.
  expect(tree.root.findAll((n) => typeof n.type === "string" && n.props.accessibilityLabel === "Verified")).toHaveLength(1);
  const labels = tree.root.findAll((n) => n.props.accessibilityRole === "button" && typeof n.props.onPress === "function").map((n) => n.props.accessibilityLabel);
  expect(labels).toContainEqual(expect.stringMatching(/^News Desk started following you\. News Desk is verified\./));
  const row = tree.root.find((n) => n.props.accessibilityRole === "button" && typeof n.props.onPress === "function" && /^Your verified badge was removed/.test(n.props.accessibilityLabel ?? ""));
  await act(async () => row.props.onPress());
  expect(mockNavigation.navigate).toHaveBeenCalledWith("Verification");
});
