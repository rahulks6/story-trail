import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { TODAY_INTRO_KEY, TodayIntro, todayIntroFor } from "../src/components/TodayIntro";
import { FIRST_STORY_SNOOZE_MS, FirstStoryNudge } from "../src/components/FirstStoryNudge";
import * as usersApi from "../src/api/users";

jest.mock("../src/api/users", () => ({ getProfile: jest.fn() }));
const users = usersApi as jest.Mocked<typeof usersApi>;
const storage = (global as unknown as { __mockStorage: Map<string, string> }).__mockStorage;
const flush = async () => { for (let i = 0; i < 5; i++) await act(async () => { await Promise.resolve(); }); };
let tree: ReactTestRenderer;
const byId = (id: string) => tree.root.findAll((n) => n.props.testID === id);

beforeEach(() => { storage.clear(); jest.clearAllMocks(); });
afterEach(async () => { await act(async () => tree?.unmount()); });

describe("the new-look card on Today", () => {
  const now = Date.parse("2026-11-16T10:00:00Z");
  test("someone who used Katkee before hears it has a new look; someone who just joined is welcomed", async () => {
    storage.set("katkee.onboarding.done.v1.u1", String(now - 5 * 24 * 3600_000));
    expect(await todayIntroFor({ id: "u1", interests: ["travel"] }, now)).toBe("newLook");
    storage.set("katkee.onboarding.done.v1.u2", String(now - 60_000));
    expect(await todayIntroFor({ id: "u2", interests: ["travel"] }, now)).toBe("welcome");
    // Onboarded on another phone: an account from before.
    expect(await todayIntroFor({ id: "u3", interests: ["food"] }, now)).toBe("newLook");
  });

  test("shows once: Got it puts it away for good", async () => {
    storage.set("katkee.onboarding.done.v1.u1", "1");
    await act(async () => { tree = create(<TodayIntro user={{ id: "u1", interests: ["travel"] }} bottom={16} />); });
    await flush();
    expect(byId("today-intro").length).toBeGreaterThan(0);
    expect(JSON.stringify(tree.toJSON())).toContain("Katkee has a new look");
    await act(async () => byId("today-intro-done")[0]!.props.onPress());
    await flush();
    expect(tree.toJSON()).toBeNull();
    expect(storage.has(TODAY_INTRO_KEY)).toBe(true);
    await act(async () => tree.unmount());
    await act(async () => { tree = create(<TodayIntro user={{ id: "u1", interests: ["travel"] }} bottom={16} />); });
    await flush();
    expect(tree.toJSON()).toBeNull();
  });
});

describe("the first-Story nudge", () => {
  const render = async (onPost = jest.fn()) => {
    await act(async () => { tree = create(<FirstStoryNudge userId="u1" username="maya" accessToken="token" onPost={onPost} />); });
    await flush();
    return onPost;
  };

  test("asks someone who has never posted, and goes straight to the camera", async () => {
    users.getProfile.mockResolvedValue({ profile: { storyCount: 0 } } as never);
    const onPost = await render();
    expect(JSON.stringify(tree.toJSON())).toContain("Share your first Story");
    await act(async () => byId("first-story-post")[0]!.props.onPress());
    expect(onPost).toHaveBeenCalled();
  });

  test("says nothing to someone who has posted, or when the server doesn't give a count", async () => {
    users.getProfile.mockResolvedValue({ profile: { storyCount: 4 } } as never);
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
    await flush();
    expect(tree.toJSON()).toBeNull();
    expect(Number(await AsyncStorage.getItem("katkee.firstStoryNudge.until.v1.u1"))).toBeGreaterThanOrEqual(before + FIRST_STORY_SNOOZE_MS);
    await act(async () => tree.unmount());
    await render();
    expect(tree.toJSON()).toBeNull();
  });
});
