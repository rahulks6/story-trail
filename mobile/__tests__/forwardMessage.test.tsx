import React from "react";
import { Text } from "react-native";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import * as conversations from "../src/api/conversations";
import * as users from "../src/api/users";
import { ForwardScreen } from "../src/screens/dm/ForwardScreen";

// Forward: the same picker as Send to (recent chats and groups first, search for anyone else),
// one request for everyone chosen, and a toast that says how it went.
const mockAuth = { accessToken: "token", user: { id: "me", username: "rahul" } };
const mockDM = { refreshUnreadCount: jest.fn() };
jest.mock("../src/state/AuthContext", () => ({ useAuth: () => mockAuth }));
jest.mock("../src/state/DMContext", () => ({ useDM: () => mockDM }));
jest.mock("../src/hooks/useDebouncedValue", () => ({ useDebouncedValue: (value: unknown) => value }));
jest.mock("@react-navigation/elements", () => ({ useHeaderHeight: () => 0 }));
jest.mock("../src/components/Avatar", () => ({ Avatar: () => null }));

let tree: ReactTestRenderer;
const navigation = { goBack: jest.fn(), setOptions: jest.fn() };
const flush = async () => { for (let i = 0; i < 8; i++) await act(async () => { await Promise.resolve(); }); };
const row = (label: string) => tree.root.find((n: ReactTestInstance) => n.props.accessibilityRole === "checkbox" && n.props.accessibilityLabel === label && typeof n.props.onPress === "function");
const button = (label: string) => tree.root.findAll((n: ReactTestInstance) => n.props.accessibilityLabel === label && typeof n.props.onPress === "function")[0];
const texts = () => tree.root.findAllByType(Text).map((t) => [t.props.children].flat().join(""));
afterEach(async () => { await act(async () => tree?.unmount()); jest.restoreAllMocks(); navigation.goBack.mockClear(); });

async function open() {
  jest.spyOn(conversations, "listConversations").mockResolvedValue({ limit: 30, offset: 0, conversations: [
    { id: "c1", kind: "direct", otherUser: { id: "u1", username: "asha", displayName: "Asha" }, lastMessage: null, unread: false, createdAt: "" },
    { id: "g1", kind: "group", otherUser: null, group: { title: "Goa trip", memberCount: 4, members: [] }, lastMessage: null, unread: false, createdAt: "" },
  ] });
  jest.spyOn(users, "searchUsers").mockResolvedValue({ results: [{ id: "u2", username: "dev", displayName: "Dev" }] } as never);
  await act(async () => { tree = create(<ForwardScreen navigation={navigation as never} route={{ key: "k", name: "ForwardMessage", params: { conversationId: "c0", messageId: "m9" } }} />); });
  await flush();
}
async function searchAndChoose(query: string, label: string) {
  await act(async () => tree.root.findAll((n) => n.props.accessibilityLabel === "Search people")[0]!.props.onChangeText(query));
  await flush();
  await act(async () => row(label).props.onPress());
}

test("chats go by their id and people found by search by theirs, in one request; then a toast and back", async () => {
  await open();
  const forward = jest.spyOn(conversations, "forwardMessage").mockResolvedValue({ results: [
    { userId: "u2", status: "sent", conversationId: "c7", messageId: "x3" },
    { conversationId: "c1", status: "sent", messageId: "x1" },
    { conversationId: "g1", status: "sent", messageId: "x2" },
  ] });
  const toast = jest.spyOn(require("../src/components/Toast"), "showToast");
  expect(button("Send")).toBeUndefined(); // nothing chosen yet
  await act(async () => row("Asha, @asha").props.onPress());
  await act(async () => row("Goa trip, 4 people").props.onPress());
  await searchAndChoose("dev", "Dev, @dev");
  await act(async () => button("Send to 3")!.props.onPress());
  await flush();
  expect(forward).toHaveBeenCalledWith("c0", "m9", { userIds: ["u2"], conversationIds: ["c1", "g1"] }, "token");
  expect(toast).toHaveBeenCalledWith("Sent to 3 chats");
  expect(navigation.goBack).toHaveBeenCalled();
});

test("one recipient: Sent; some refused: named in the toast; all refused: stays open, saying who", async () => {
  await open();
  const forward = jest.spyOn(conversations, "forwardMessage");
  const toast = jest.spyOn(require("../src/components/Toast"), "showToast");
  forward.mockResolvedValueOnce({ results: [{ conversationId: "c1", status: "sent", messageId: "x1" }] });
  await act(async () => row("Asha, @asha").props.onPress());
  await act(async () => button("Send")!.props.onPress());
  await flush();
  expect(toast).toHaveBeenLastCalledWith("Sent");

  await act(async () => row("Goa trip, 4 people").props.onPress());
  await searchAndChoose("dev", "Dev, @dev");
  forward.mockResolvedValueOnce({ results: [{ userId: "u2", status: "not_allowed" }, { conversationId: "c1", status: "sent", messageId: "x1" }, { conversationId: "g1", status: "sent", messageId: "x2" }] });
  await act(async () => button("Send to 3")!.props.onPress());
  await flush();
  expect(toast).toHaveBeenLastCalledWith("Sent to 2 chats. Couldn't send to @dev.");

  navigation.goBack.mockClear();
  forward.mockResolvedValueOnce({ results: [{ userId: "u2", status: "not_allowed" }, { conversationId: "c1", status: "not_allowed" }, { conversationId: "g1", status: "not_allowed" }] });
  await act(async () => button("Send to 3")!.props.onPress());
  await flush();
  expect(navigation.goBack).not.toHaveBeenCalled();
  expect(texts()).toContain("Couldn't send to @asha, Goa trip, @dev.");
});

test("up to ten at a time", async () => {
  await open();
  const many = Array.from({ length: 10 }, (_, i) => ({ id: `c${i + 10}`, kind: "direct" as const, otherUser: { id: `p${i}`, username: `p${i}`, displayName: `P${i}` }, lastMessage: null, unread: false, createdAt: "" }));
  await act(async () => tree.unmount());
  jest.spyOn(conversations, "listConversations").mockResolvedValue({ limit: 30, offset: 0, conversations: many });
  await act(async () => { tree = create(<ForwardScreen navigation={navigation as never} route={{ key: "k", name: "ForwardMessage", params: { conversationId: "c0", messageId: "m9" } }} />); });
  await flush();
  for (let i = 0; i < 10; i++) await act(async () => row(`P${i}, @p${i}`).props.onPress());
  await searchAndChoose("dev", "Dev, @dev"); // an eleventh
  expect(row("Dev, @dev").props.accessibilityState).toEqual({ checked: false });
  expect(texts()).toContain("You can forward to up to 10 chats at a time.");
  expect(button("Send to 10")).toBeTruthy();
});
