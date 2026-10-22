import React from "react";
import { Alert, Text, TextInput } from "react-native";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import * as conversations from "../src/api/conversations";
import * as users from "../src/api/users";
import { DMInboxScreen } from "../src/screens/dm/DMInboxScreen";
import { NewGroupScreen } from "../src/screens/dm/NewGroupScreen";
import { GroupInfoScreen } from "../src/screens/dm/GroupInfoScreen";

const mockAuth = { accessToken: "token", user: { id: "me", username: "rahul" } };
const mockNavigation = { navigate: jest.fn(), replace: jest.fn(), goBack: jest.fn(), popToTop: jest.fn(), setOptions: jest.fn() };
jest.mock("../src/state/AuthContext", () => ({ useAuth: () => mockAuth }));
const mockDM = { refreshUnreadCount: jest.fn() };
jest.mock("../src/state/DMContext", () => ({ useDM: () => mockDM }));
jest.mock("../src/state/RealtimeContext", () => ({ useRealtimeEvents: () => undefined }));
jest.mock("../src/push/usePushRegistration", () => ({ askForPushOnce: jest.fn() }));
jest.mock("@react-navigation/elements", () => ({ useHeaderHeight: () => 0 }));
jest.mock("../src/components/Avatar", () => ({ Avatar: (p: object) => require("react").createElement("Avatar", p) }));
jest.mock("@react-navigation/native", () => ({
  ...jest.requireActual("@react-navigation/native"),
  useNavigation: () => mockNavigation,
  useFocusEffect: (effect: () => void) => require("react").useEffect(() => effect(), [effect]),
}));

let tree: ReactTestRenderer;
const flush = async () => { for (let i = 0; i < 8; i++) await act(async () => { await Promise.resolve(); }); };
const texts = () => tree.root.findAllByType(Text).map((t) => [t.props.children].flat().join(""));
const press = (label: string) => act(async () => tree.root.find((n: ReactTestInstance) => typeof n.props.onPress === "function" && n.props.accessibilityLabel === label).props.onPress());
afterEach(async () => { await act(async () => tree?.unmount()); jest.restoreAllMocks(); Object.values(mockNavigation).forEach((f) => f.mockClear()); });

const asha = { id: "u-asha", username: "asha", displayName: "Asha Rao", avatarMediaId: null };
const dev = { id: "u-dev", username: "dev", displayName: "Dev", avatarMediaId: null };
const member = (p: typeof asha, role: "admin" | "member" = "member") => ({ userId: p.id, username: p.username, displayName: p.displayName, avatarMediaId: null, role, joinedAt: "" });

test("the inbox shows a group with its name, two faces and who said what; it opens as a group", async () => {
  jest.spyOn(conversations, "listConversations").mockResolvedValue({ limit: 50, offset: 0, conversations: [
    { id: "g1", kind: "group", otherUser: null, group: { title: null, memberCount: 4, members: [asha, dev] }, unread: true, createdAt: "",
      lastMessage: { id: "m1", senderId: "u-asha", senderUsername: "asha", body: "villa booked!", sharedStoryId: null, createdAt: "" } },
    { id: "g2", kind: "group", otherUser: null, group: { title: "Goa trip", memberCount: 3, members: [asha, dev] }, unread: false, createdAt: "",
      lastMessage: { id: "m2", senderId: "me", body: null, sharedStoryId: null, event: { type: "added", userIds: ["u-dev"] }, createdAt: "" } },
  ] });
  await act(async () => { tree = create(<DMInboxScreen />); });
  await flush();
  expect(texts()).toEqual(expect.arrayContaining(["Asha, Dev and 1 other", "asha: villa booked!", "Goa trip", "You added @dev"]));
  expect(tree.root.findAll((n) => (n.type as unknown) === "Avatar").length).toBeGreaterThanOrEqual(4); // two faces each
  await press("Asha, Dev and 1 other, group of 4, unread");
  expect(mockNavigation.navigate).toHaveBeenCalledWith("Conversation", { conversationId: "g1", group: true, title: "Asha, Dev and 1 other" });
  await press("New group");
  expect(mockNavigation.navigate).toHaveBeenCalledWith("NewGroup", {});
});

test("New group: people you're connected to first; at least two; named or not; then the group opens", async () => {
  jest.spyOn(users, "getFollowing").mockResolvedValue({ following: [{ ...asha, bio: "", isPrivate: false, followedAt: "" }], limit: 50, offset: 0 });
  jest.spyOn(users, "getFollowers").mockResolvedValue({ followers: [{ ...asha, bio: "", isPrivate: false, followedAt: "" }, { ...dev, bio: "", isPrivate: false, followedAt: "" }], limit: 50, offset: 0 });
  const created = jest.spyOn(conversations, "createGroup").mockResolvedValue({ conversation: { id: "g9", kind: "group", createdAt: "", title: "Goa trip", otherUser: null, role: "admin", members: [member({ ...asha, id: "me", username: "rahul" }, "admin"), member(asha), member(dev)] } });
  await act(async () => { tree = create(<NewGroupScreen navigation={mockNavigation as never} route={{ key: "k", name: "NewGroup", params: {} }} />); });
  await flush();
  const people = () => tree.root.findAll((n) => n.props.accessibilityRole === "checkbox" && typeof n.props.onPress === "function");
  expect(people()).toHaveLength(2); // Asha once, though she's in both lists
  const createButton = () => tree.root.findAll((n) => n.props.accessibilityLabel === "Create group" && typeof n.props.onPress === "function")[0]!;
  expect(createButton().props.disabled).toBe(true);
  await act(async () => people()[0]!.props.onPress());
  await act(async () => people()[1]!.props.onPress());
  expect(createButton().props.disabled).toBe(false);
  await act(async () => tree.root.findAllByType(TextInput)[0]!.props.onChangeText("  Goa trip "));
  await act(async () => createButton().props.onPress());
  await flush();
  expect(created).toHaveBeenCalledWith(["asha", "dev"], "Goa trip", "token");
  expect(mockNavigation.replace).toHaveBeenCalledWith("Conversation", { conversationId: "g9", group: true, title: "Goa trip" });
});

test("group info: rename it, admins remove people, and anyone can leave", async () => {
  const details = { id: "g1", kind: "group" as const, createdAt: "", title: "Goa trip", otherUser: null, role: "admin" as const, members: [member({ ...asha, id: "me", username: "rahul", displayName: "Rahul" }, "admin"), member(asha), member(dev)] };
  jest.spyOn(conversations, "getConversation").mockResolvedValue({ conversation: details });
  const renamed = jest.spyOn(conversations, "renameGroup").mockResolvedValue({ conversation: { ...details, title: "Weekend" } });
  const removed = jest.spyOn(conversations, "removeGroupMember").mockResolvedValue({ conversation: { ...details, members: details.members.slice(0, 2) } });
  const left = jest.spyOn(conversations, "leaveGroup").mockResolvedValue(undefined);
  const alert = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
  await act(async () => { tree = create(<GroupInfoScreen navigation={mockNavigation as never} route={{ key: "k", name: "GroupInfo", params: { conversationId: "g1" } }} />); });
  await flush();
  expect(texts()).toEqual(expect.arrayContaining(["Rahul (you)", "@asha", "3 of up to 32 people"]));
  const name = tree.root.find((n) => n.props.accessibilityLabel === "Group name" && typeof n.props.onChangeText === "function");
  await act(async () => name.props.onChangeText("Weekend"));
  await act(async () => name.props.onEndEditing());
  expect(renamed).toHaveBeenCalledWith("g1", "Weekend", "token");

  await press("Remove @dev");
  await act(async () => (alert.mock.calls.at(-1)![2] as Array<{ text: string; onPress?: () => Promise<void> }>).find((b) => b.text === "Remove")!.onPress!());
  expect(removed).toHaveBeenCalledWith("g1", "u-dev", "token");
  expect(tree.root.findAll((n) => n.props.accessibilityLabel === "Remove @dev")).toHaveLength(0);

  await press("Add people");
  expect(mockNavigation.navigate).toHaveBeenCalledWith("NewGroup", { conversationId: "g1" });
  await press("Leave group");
  await act(async () => (alert.mock.calls.at(-1)![2] as Array<{ text: string; onPress?: () => Promise<void> }>).find((b) => b.text === "Leave")!.onPress!());
  expect(left).toHaveBeenCalledWith("g1", "token");
  expect(mockNavigation.popToTop).toHaveBeenCalled();
});

test("a member who isn't an admin sees no Remove", async () => {
  jest.spyOn(conversations, "getConversation").mockResolvedValue({ conversation: { id: "g1", kind: "group", createdAt: "", title: null, otherUser: null, role: "member", members: [member(asha, "admin"), member({ ...dev, id: "me" })] } });
  await act(async () => { tree = create(<GroupInfoScreen navigation={mockNavigation as never} route={{ key: "k", name: "GroupInfo", params: { conversationId: "g1" } }} />); });
  await flush();
  expect(tree.root.findAll((n) => typeof n.props.accessibilityLabel === "string" && n.props.accessibilityLabel.startsWith("Remove"))).toHaveLength(0);
});
