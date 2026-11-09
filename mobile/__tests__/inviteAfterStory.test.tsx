import React from "react";
import { Text } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { InviteAfterStory } from "../src/components/InviteAfterStory";
import { storyPublished } from "../src/state/storyChanges";

jest.mock("../src/state/AuthContext", () => ({ useAuth: () => ({ status: "signedIn", accessToken: "token", user: { id: "u-me" } }) }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock("../src/state/invites", () => ({ shareInvite: jest.fn(async () => undefined) }));

// Right after a Story posts, once per account: "Your Story is live", then Invite friends or Not now.
const texts = (tree: ReactTestRenderer) => tree.root.findAllByType(Text).map((t) => [t.props.children].flat().join(""));
const settle = async (ms: number) => { await act(async () => { jest.advanceTimersByTime(ms); }); for (let i = 0; i < 4; i++) await act(async () => { await Promise.resolve(); }); };

beforeEach(async () => { jest.useFakeTimers(); await AsyncStorage.clear(); });
afterEach(() => jest.useRealTimers());

test("asks once, a moment after a Story posts, and Invite friends opens the share sheet", async () => {
  const { shareInvite } = jest.requireMock("../src/state/invites");
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<InviteAfterStory />); });
  expect(texts(tree)).not.toContain("Your Story is live");
  await act(async () => storyPublished());
  await settle(2600);
  expect(texts(tree)).toContain("Your Story is live");
  const invite = tree.root.find((n) => typeof n.props.onPress === "function" && n.findAll((c) => c.props.children === "Invite friends").length > 0);
  await act(async () => invite.props.onPress());
  expect(shareInvite).toHaveBeenCalledWith("after_story", "token", "u-me");
  expect(texts(tree)).not.toContain("Your Story is live");

  // The next Story doesn't ask again.
  await act(async () => storyPublished());
  await settle(2600);
  expect(texts(tree)).not.toContain("Your Story is live");
  await act(async () => tree.unmount());
});
