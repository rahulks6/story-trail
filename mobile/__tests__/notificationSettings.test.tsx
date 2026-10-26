import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { Switch } from "react-native";
import { NotificationSettingsScreen } from "../src/screens/profile/NotificationSettingsScreen";
import * as notificationsApi from "../src/api/notifications";

// Notification settings with the network replaced: each switch saves on its own.
jest.mock("../src/state/AuthContext", () => ({ useAuth: () => ({ accessToken: "token", user: { id: "u-me" } }) }));
jest.mock("../src/push/pushNotifications", () => ({
  pushPermission: jest.fn(async () => "granted"),
  registerForPush: jest.fn(async () => "registered"),
  requestPushPermission: jest.fn(async () => true),
}));
jest.mock("../src/api/notifications", () => ({ getNotificationPreferences: jest.fn(), updateNotificationPreferences: jest.fn() }));
const api = notificationsApi as jest.Mocked<typeof notificationsApi>;

const all = {
  likesEnabled: true, commentsEnabled: true, followsEnabled: true, mentionsEnabled: true, messagesEnabled: true, pushEnabled: true,
  storiesEnabled: true, milestonesEnabled: true, remindersEnabled: true,
};
let tree: ReactTestRenderer;
afterEach(async () => {
  await act(async () => tree?.unmount());
  jest.clearAllMocks();
});
const flush = async () => { for (let i = 0; i < 4; i++) await act(async () => { await Promise.resolve(); }); };
const switchFor = (label: string) => tree.root.findAll((n) => n.type === Switch && n.props.accessibilityLabel === label)[0];
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

test("two switches flipped quickly each keep their own state, whichever answer arrives last", async () => {
  api.getNotificationPreferences.mockResolvedValue({ preferences: all });
  const likes = deferred<{ preferences: typeof all }>(), comments = deferred<{ preferences: typeof all }>();
  api.updateNotificationPreferences.mockReturnValueOnce(likes.promise).mockReturnValueOnce(comments.promise);
  await act(async () => { tree = create(<NotificationSettingsScreen />); });
  await flush();

  await act(async () => switchFor("Likes")!.props.onValueChange(false));
  await act(async () => switchFor("Comments")!.props.onValueChange(false));
  // The server saved Likes, then Comments; the Comments answer comes back first.
  await act(async () => comments.resolve({ preferences: { ...all, likesEnabled: false, commentsEnabled: false } }));
  await act(async () => likes.resolve({ preferences: { ...all, likesEnabled: false } }));
  await flush();
  expect(switchFor("Likes")!.props.value).toBe(false);
  expect(switchFor("Comments")!.props.value).toBe(false);
});

test("a change that didn't save goes back, without undoing another that did", async () => {
  api.getNotificationPreferences.mockResolvedValue({ preferences: all });
  const likes = deferred<{ preferences: typeof all }>(), follows = deferred<{ preferences: typeof all }>();
  api.updateNotificationPreferences.mockReturnValueOnce(likes.promise).mockReturnValueOnce(follows.promise);
  await act(async () => { tree = create(<NotificationSettingsScreen />); });
  await flush();

  await act(async () => switchFor("Likes")!.props.onValueChange(false));
  await act(async () => switchFor("Follows")!.props.onValueChange(false));
  await act(async () => follows.resolve({ preferences: { ...all, followsEnabled: false } }));
  await act(async () => likes.reject(new Error("offline")));
  await flush();
  expect(switchFor("Likes")!.props.value).toBe(true);
  expect(switchFor("Follows")!.props.value).toBe(false);
});
