import React from "react";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { Modal, PermissionsAndroid, Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as growthApi from "../src/api/growth";
import * as usersApi from "../src/api/users";
import { CHECK_EVERY_MS, contactsWatchEnabled, disableContactsWatch, enableContactsWatch, newContactsOnKatkee } from "../src/state/contactsWatch";
import { ContactsJoinedSheet } from "../src/components/ContactsJoinedSheet";
import type { ContactMatch } from "../src/api/growth";

jest.mock("../src/state/AuthContext", () => ({ useAuth: () => ({ user: { id: "me" }, accessToken: "token" }) }));
jest.mock("../src/api/growth", () => ({ matchContacts: jest.fn(), getMyInvite: jest.fn() }));
jest.mock("../src/api/users", () => ({ followUser: jest.fn(), unfollowUser: jest.fn() }));
jest.mock("../src/analytics/analytics", () => ({ track: jest.fn() }));
jest.mock("../src/components/Avatar", () => ({ Avatar: () => null }));
const growth = growthApi as jest.Mocked<typeof growthApi>;
const users = usersApi as jest.Mocked<typeof usersApi>;
const contacts = (globalThis as unknown as { __contacts: { permission: string; afterRequest: string; list: unknown[] } }).__contacts;

const person = (id: string, name: string, following = false): ContactMatch => ({
  id, username: name.toLowerCase(), displayName: name, avatarMediaId: null, verified: false, isPrivate: false,
  viewer: { isFollowing: following, isFollowedBy: false, hasPendingRequestFromViewer: false },
} as ContactMatch);
const T0 = 1_800_000_000_000;

let tree: ReactTestRenderer | undefined;
beforeEach(async () => {
  await AsyncStorage.clear();
  jest.replaceProperty(Platform, "OS", "android");
  jest.spyOn(PermissionsAndroid, "check").mockResolvedValue(true);
  contacts.list = [{ emailAddresses: [{ email: "asha@example.com" }], phoneNumbers: [] }];
  growth.matchContacts.mockReset();
});
afterEach(async () => {
  await act(async () => tree?.unmount());
  tree = undefined;
  jest.restoreAllMocks();
});

test("off until switched on: nothing is read and nothing shown", async () => {
  expect(await contactsWatchEnabled("me")).toBe(false);
  expect(await newContactsOnKatkee("me", "token", T0)).toEqual([]);
  expect(growth.matchContacts).not.toHaveBeenCalled();
});

test("once on, only people who joined after it are announced, each once, and never someone you follow", async () => {
  await enableContactsWatch("me", [person("a", "Asha")], T0);
  growth.matchContacts.mockResolvedValue({ matches: [person("a", "Asha"), person("b", "Bilal"), person("c", "Chitra", true)] });
  // Too soon after the last check: nothing is read.
  expect(await newContactsOnKatkee("me", "token", T0 + 60_000)).toEqual([]);
  expect(growth.matchContacts).not.toHaveBeenCalled();
  const fresh = await newContactsOnKatkee("me", "token", T0 + CHECK_EVERY_MS + 1);
  expect(fresh.map((p) => p.displayName)).toEqual(["Bilal"]);
  expect(await newContactsOnKatkee("me", "token", T0 + CHECK_EVERY_MS * 3)).toEqual([]);
});

test("contacts turned off on the phone, or the switch turned off, stops it", async () => {
  await enableContactsWatch("me", [], T0);
  jest.spyOn(PermissionsAndroid, "check").mockResolvedValue(false);
  expect(await newContactsOnKatkee("me", "token", T0 + CHECK_EVERY_MS * 2)).toEqual([]);
  expect(growth.matchContacts).not.toHaveBeenCalled();
  await disableContactsWatch("me");
  expect(await contactsWatchEnabled("me")).toBe(false);
});

test("Home shows who joined, with Follow", async () => {
  await enableContactsWatch("me", [], Date.now() - CHECK_EVERY_MS - 1);
  growth.matchContacts.mockResolvedValue({ matches: [person("b", "Bilal"), person("d", "Diya")] });
  users.followUser.mockResolvedValue({ status: "following" } as never);
  const onFollowed = jest.fn();
  await act(async () => { tree = create(<ContactsJoinedSheet onOpenProfile={jest.fn()} onFollowed={onFollowed} />); });
  for (let i = 0; i < 6; i++) await act(async () => { await Promise.resolve(); });
  expect(tree!.root.findAllByType(Modal)).toHaveLength(1);
  const texts = tree!.root.findAll((n: ReactTestInstance) => typeof n.props.children === "string").map((n) => n.props.children);
  expect(texts).toContain("Bilal and 1 more joined Katkee!");
  const follow = tree!.root.findAll((n: ReactTestInstance) => typeof n.props.onPress === "function" && n.props.accessibilityLabel === "Follow")[0]!;
  await act(async () => follow.props.onPress());
  expect(users.followUser).toHaveBeenCalledWith("bilal", "token");
  expect(onFollowed).toHaveBeenCalled();
});

test("nothing new: no sheet", async () => {
  await enableContactsWatch("me", [person("b", "Bilal")], Date.now() - CHECK_EVERY_MS - 1);
  growth.matchContacts.mockResolvedValue({ matches: [person("b", "Bilal")] });
  await act(async () => { tree = create(<ContactsJoinedSheet onOpenProfile={jest.fn()} />); });
  for (let i = 0; i < 6; i++) await act(async () => { await Promise.resolve(); });
  expect(tree!.root.findAllByType(Modal)).toHaveLength(0);
});
