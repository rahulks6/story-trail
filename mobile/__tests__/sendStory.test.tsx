import React from "react";
import { TextInput } from "react-native";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import * as conversations from "../src/api/conversations";
import { SendStoryScreen } from "../src/screens/dm/SendStoryScreen";

const mockAuth = { accessToken: "token", user: { id: "me", username: "rahul" } };
const mockDM = { refreshUnreadCount: jest.fn() };
jest.mock("../src/state/AuthContext", () => ({ useAuth: () => mockAuth }));
jest.mock("../src/state/DMContext", () => ({ useDM: () => mockDM }));
jest.mock("@react-navigation/elements", () => ({ useHeaderHeight: () => 0 }));
jest.mock("../src/components/Avatar", () => ({ Avatar: () => null }));

let tree: ReactTestRenderer;
const navigation = { goBack: jest.fn(), setOptions: jest.fn() };
const flush = async () => { for (let i = 0; i < 8; i++) await act(async () => { await Promise.resolve(); }); };
const row = (label: string) => tree.root.find((n: ReactTestInstance) => n.props.accessibilityRole === "checkbox" && n.props.accessibilityLabel === label && typeof n.props.onPress === "function");
afterEach(async () => { await act(async () => tree?.unmount()); jest.restoreAllMocks(); });

test("recent chats and groups first; choose several, add a message, Send once; then back to the Story", async () => {
  jest.spyOn(conversations, "listConversations").mockResolvedValue({ limit: 30, offset: 0, conversations: [
    { id: "c1", kind: "direct", otherUser: { id: "u1", username: "asha", displayName: "Asha" }, lastMessage: null, unread: false, createdAt: "" },
    { id: "g1", kind: "group", otherUser: null, group: { title: "Goa trip", memberCount: 4, members: [] }, lastMessage: null, unread: false, createdAt: "" },
  ] });
  const sent = jest.spyOn(conversations, "sendMessage").mockResolvedValue({ message: {} as conversations.Message });
  const toast = jest.spyOn(require("../src/components/Toast"), "showToast");
  await act(async () => { tree = create(<SendStoryScreen navigation={navigation as never} route={{ key: "k", name: "SendStory", params: { storyId: "st1", ownerUsername: "dev" } }} />); });
  await flush();
  expect(tree.root.findAll((n) => n.props.accessibilityLabel === "Send to 2")).toHaveLength(0); // nothing chosen yet: no Send
  await act(async () => row("Asha, @asha").props.onPress());
  await act(async () => row("Goa trip, 4 people").props.onPress());
  await act(async () => tree.root.findAll((n) => n.props.accessibilityLabel === "Add a message, optional")[0]!.props.onChangeText("you'd love this"));
  await act(async () => tree.root.findAll((n) => n.props.accessibilityLabel === "Send to 2" && typeof n.props.onPress === "function")[0]!.props.onPress());
  await flush();
  const calls = sent.mock.calls.map((c) => [c[0], (c[1] as { storyId?: string; body?: string }).storyId ?? (c[1] as { body?: string }).body]);
  expect(calls).toEqual([["c1", "st1"], ["c1", "you'd love this"], ["g1", "st1"], ["g1", "you'd love this"]]);
  expect(toast).toHaveBeenCalledWith("Sent to 2");
  expect(navigation.goBack).toHaveBeenCalled();
  expect(tree.root.findAllByType(TextInput).length).toBeGreaterThan(0);
});
