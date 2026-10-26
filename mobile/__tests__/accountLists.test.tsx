import React from "react";
import { Text } from "react-native";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { BlockedAccountsScreen } from "../src/screens/profile/BlockedAccountsScreen";
import { MutedAccountsScreen } from "../src/screens/profile/MutedAccountsScreen";
import { FollowRequestsScreen } from "../src/screens/profile/FollowRequestsScreen";
import * as usersApi from "../src/api/users";

// The Settings lists: a failed load offers Try again instead of a spinner that never ends.
jest.mock("../src/state/AuthContext", () => ({ useAuth: () => ({ accessToken: "token" }) }));
jest.mock("../src/components/Avatar", () => ({ Avatar: () => null }));
jest.mock("@react-navigation/native", () => ({
  ...jest.requireActual("@react-navigation/native"),
  useNavigation: () => ({ navigate: jest.fn() }),
  useFocusEffect: (effect: () => void) => require("react").useEffect(() => effect(), [effect]),
}));
jest.mock("../src/api/users", () => ({
  listBlockedUsers: jest.fn(),
  listMutedUsers: jest.fn(),
  listFollowRequests: jest.fn(),
  unblockUser: jest.fn(),
  unmuteUser: jest.fn(),
  acceptFollowRequest: jest.fn(),
  declineFollowRequest: jest.fn(),
}));
const api = usersApi as jest.Mocked<typeof usersApi>;
let tree: ReactTestRenderer;
const flush = async () => { for (let i = 0; i < 5; i++) await act(async () => { await Promise.resolve(); }); };
const texts = () => tree.root.findAllByType(Text).map((t) => [t.props.children].flat().join(""));
afterEach(async () => { await act(async () => tree?.unmount()); jest.clearAllMocks(); });

const person = { id: "u-2", username: "asha", displayName: "Asha", avatarMediaId: null };
test.each([
  ["blocked", () => <BlockedAccountsScreen />, () => api.listBlockedUsers, { blocked: [person] }, "Couldn't load your blocked accounts. Check your connection and try again."],
  ["muted", () => <MutedAccountsScreen />, () => api.listMutedUsers, { muted: [person] }, "Couldn't load your muted accounts. Check your connection and try again."],
  ["follow requests", () => <FollowRequestsScreen />, () => api.listFollowRequests, { requests: [{ ...person, requestId: "r-1", requesterId: "u-2", createdAt: "" }] }, "Couldn't load your follow requests. Check your connection and try again."],
])("%s: a failed load says so and Try again loads the list", async (_name, screen, list, page, message) => {
  (list() as jest.Mock).mockRejectedValueOnce(new TypeError("Network request failed")).mockResolvedValueOnce(page);
  await act(async () => { tree = create(screen()); });
  await flush();
  expect(texts()).toContain(message);
  await act(async () => tree.root.find((n: ReactTestInstance) => typeof n.props.onPress === "function" && n.props.accessibilityLabel === "Try again").props.onPress());
  await flush();
  expect(texts()).toContain("@asha");
});

test("follow requests: one already answered on another device, or withdrawn, leaves the list; a dropped connection keeps it to retry", async () => {
  const { ApiError } = jest.requireActual("../src/api/client");
  const request = (n: number) => ({ ...person, username: `asha${n}`, requestId: `r-${n}`, requesterId: `u-${n}`, createdAt: "" });
  api.listFollowRequests.mockResolvedValue({ requests: [request(1), request(2), request(3)], limit: 30, offset: 0 });
  api.acceptFollowRequest.mockRejectedValueOnce(new ApiError(409, "This request has already been resolved."));
  api.declineFollowRequest.mockRejectedValueOnce(new ApiError(404, "Follow request not found.")).mockRejectedValueOnce(new TypeError("Network request failed"));
  await act(async () => { tree = create(<FollowRequestsScreen />); });
  await flush();
  const pressIn = async (username: string, label: string) => {
    const row = tree.root.findAll((n: ReactTestInstance) => n.props.style !== undefined && n.findAll((t: ReactTestInstance) => t.type === Text && t.props.children?.join?.("") === `@${username}`).length > 0 && n.findAll((t: ReactTestInstance) => t.type === Text && t.props.children === label).length > 0).pop()!;
    await act(async () => row.findAll((n: ReactTestInstance) => typeof n.props.onPress === "function").find((n) => n.findAll((t: ReactTestInstance) => t.type === Text && t.props.children === label).length > 0)!.props.onPress());
    await flush();
  };
  await pressIn("asha1", "Accept");
  await pressIn("asha2", "Decline");
  await pressIn("asha3", "Decline");
  expect(texts()).not.toContain("@asha1");
  expect(texts()).not.toContain("@asha2");
  expect(texts()).toContain("@asha3");
});
