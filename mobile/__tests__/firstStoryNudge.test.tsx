import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { FIRST_STORY_SNOOZE_MS, FirstStoryNudge } from "../src/components/FirstStoryNudge";
import * as usersApi from "../src/api/users";

jest.mock("../src/state/AuthContext", () => ({ useAuth: () => ({ accessToken: "token", user: { id: "u1", username: "maya" } }) }));
jest.mock("../src/api/users", () => ({ getProfile: jest.fn() }));
const users = usersApi as jest.Mocked<typeof usersApi>;
const storage = (global as unknown as { __mockStorage: Map<string, string> }).__mockStorage;
const flush = async () => { for (let i = 0; i < 5; i++) await act(async () => { await Promise.resolve(); }); };
let tree: ReactTestRenderer;
const byId = (id: string) => tree.root.findAll((n) => n.props.testID === id);
const render = async (onPost = jest.fn()) => { await act(async () => { tree = create(<FirstStoryNudge onPost={onPost} />); }); await flush(); return onPost; };

beforeEach(() => { storage.clear(); jest.clearAllMocks(); });
afterEach(async () => { await act(async () => tree?.unmount()); });

test("asks someone who has never posted, and goes straight to the camera", async () => {
  users.getProfile.mockResolvedValue({ profile: { storyCount: 0 } } as never);
  const onPost = await render();
  expect(JSON.stringify(tree.toJSON())).toContain("Your turn!");
  await act(async () => byId("first-story-post")[0]!.props.onPress());
  expect(onPost).toHaveBeenCalled();
});

test("says nothing to someone who has posted, or when the server doesn't say", async () => {
  users.getProfile.mockResolvedValue({ profile: { storyCount: 2 } } as never);
  await render();
  expect(tree.toJSON()).toBeNull();
  await act(async () => tree.unmount());
  users.getProfile.mockResolvedValue({ profile: {} } as never);
  await render();
  expect(tree.toJSON()).toBeNull();
});

test("Not now keeps it away for a few days", async () => {
  users.getProfile.mockResolvedValue({ profile: { storyCount: 0 } } as never);
  await render();
  const before = Date.now();
  await act(async () => byId("first-story-later")[0]!.props.onPress());
  expect(tree.toJSON()).toBeNull();
  expect(Number(await AsyncStorage.getItem("katkee.firstStoryNudge.until.v1.u1"))).toBeGreaterThanOrEqual(before + FIRST_STORY_SNOOZE_MS);
  await act(async () => tree.unmount());
  await render();
  expect(tree.toJSON()).toBeNull();
});
