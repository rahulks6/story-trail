import React from "react";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { Text } from "react-native";
import * as usersApi from "../src/api/users";
import { CloseFriendsScreen } from "../src/screens/profile/CloseFriendsScreen";

const mockAuth = { accessToken: "token", user: { id: "me", username: "rahul" } };
jest.mock("../src/state/AuthContext", () => ({ useAuth: () => mockAuth }));

const asha = { id: "u1", username: "asha", displayName: "Asha", avatarMediaId: null, addedAt: "" };
const dev = { id: "u2", username: "dev", displayName: "Dev", avatarMediaId: null };
let tree: ReactTestRenderer;
const flush = async () => { for (let i = 0; i < 8; i++) await act(async () => { await Promise.resolve(); }); };
const texts = () => tree.root.findAllByType(Text).map((t) => [t.props.children].flat().join(""));
const button = (label: string) => tree.root.find((n: ReactTestInstance) => typeof n.props.onPress === "function" && n.props.accessibilityLabel === label);

beforeEach(() => {
  jest.restoreAllMocks();
  jest.spyOn(usersApi, "listCloseFriends").mockResolvedValue({ closeFriends: [asha], limit: 200, offset: 0 });
  const follower = { bio: "", isPrivate: false, followedAt: "" };
  jest.spyOn(usersApi, "getFollowers").mockResolvedValue({ followers: [{ ...asha, ...follower }, { ...dev, ...follower }], limit: 100, offset: 0 });
});

afterEach(async () => {
  await act(async () => {
    tree.unmount();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
});

describe("loading the list", () => {
  it("asks for 50 at a time, the most the server gives in one request, until it has them all", async () => {
    const page = (n: number, from: number) => Array.from({ length: n }, (_, i) => ({ id: `p${from + i}`, username: `p${from + i}`, displayName: "P", avatarMediaId: null, addedAt: "" }));
    const list = jest.spyOn(usersApi, "listCloseFriends")
      .mockResolvedValueOnce({ closeFriends: page(50, 0), limit: 50, offset: 0 })
      .mockResolvedValueOnce({ closeFriends: page(3, 50), limit: 50, offset: 50 });
    await act(async () => { tree = create(<CloseFriendsScreen />); });
    await flush();
    expect(list.mock.calls.map((c) => c[1])).toEqual([{ limit: 50, offset: 0 }, { limit: 50, offset: 50 }]);
    expect(usersApi.getFollowers).toHaveBeenCalledWith("rahul", "token", { limit: 50 });
    expect(texts()).toContain("On your list · 53");
  });
});

describe("Close Friends screen", () => {
  it("shows the list first, then followers who aren't on it", async () => {
    await act(async () => { tree = create(<CloseFriendsScreen />); });
    await flush();
    const shown = texts();
    expect(shown).toContain("On your list · 1");
    expect(shown).toContain("Your followers");
    expect(shown.filter((t) => t === "@asha")).toHaveLength(1);
    expect(shown).toContain("@dev");
  });

  it("adds and removes people, moving them on and off the list", async () => {
    const add = jest.spyOn(usersApi, "addCloseFriend").mockResolvedValue(undefined);
    const remove = jest.spyOn(usersApi, "removeCloseFriend").mockResolvedValue(undefined);
    await act(async () => { tree = create(<CloseFriendsScreen />); });
    await flush();
    await act(async () => button("Add @dev to Close Friends").props.onPress());
    await flush();
    expect(add).toHaveBeenCalledWith("dev", "token");
    expect(texts()).toContain("On your list · 2");
    await act(async () => button("Remove @asha from Close Friends").props.onPress());
    await flush();
    expect(remove).toHaveBeenCalledWith("asha", "token");
    expect(texts()).toContain("On your list · 1");
  });

  it("says so when adding fails, and keeps the list as it was", async () => {
    jest.spyOn(usersApi, "addCloseFriend").mockRejectedValue(new Error("offline"));
    await act(async () => { tree = create(<CloseFriendsScreen />); });
    await flush();
    await act(async () => button("Add @dev to Close Friends").props.onPress());
    await flush();
    expect(texts()).toContain("Couldn't add @dev. Try again.");
    expect(texts()).toContain("On your list · 1");
  });
});
