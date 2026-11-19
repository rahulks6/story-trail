import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { DailyThemeCard } from "../src/components/DailyThemeCard";
import { FoundingWelcome } from "../src/components/FoundingWelcome";
import { suggestionReasonText } from "../src/screens/search/SearchScreen";
import * as usersApi from "../src/api/users";
import * as growthApi from "../src/api/growth";
import * as invites from "../src/state/invites";

jest.mock("../src/state/AuthContext", () => ({ useAuth: () => ({ accessToken: "token", user: { id: "u1", username: "maya" } }) }));
jest.mock("../src/api/users", () => ({ getProfile: jest.fn() }));
jest.mock("../src/api/growth", () => ({ getTodayTheme: jest.fn(), getFoundingSpots: jest.fn() }));
jest.mock("../src/state/invites", () => ({ shareInvite: jest.fn() }));
const users = usersApi as jest.Mocked<typeof usersApi>;
const growth = growthApi as jest.Mocked<typeof growthApi>;
const storage = (global as unknown as { __mockStorage: Map<string, string> }).__mockStorage;
const flush = async () => { for (let i = 0; i < 6; i++) await act(async () => { await Promise.resolve(); }); };
let tree: ReactTestRenderer;
const byId = (id: string) => tree.root.findAll((n) => n.props.testID === id);
const text = () => JSON.stringify(tree.toJSON());
const theme = { date: "2026-11-20", slug: "chai", emoji: "☕", title: "Your chai or coffee moment", postedToday: false };

beforeEach(() => { storage.clear(); jest.clearAllMocks(); });
afterEach(async () => { await act(async () => tree?.unmount()); jest.useRealTimers(); });

describe("Today's theme", () => {
  const render = async (onPost = jest.fn()) => { await act(async () => { tree = create(<DailyThemeCard onPost={onPost} />); }); await flush(); return onPost; };

  test("shows today's theme to someone who posts, and goes straight to the camera", async () => {
    growth.getTodayTheme.mockResolvedValue(theme);
    users.getProfile.mockResolvedValue({ profile: { storyCount: 3 } } as never);
    const onPost = await render();
    expect(text()).toContain("Today's theme");
    expect(text()).toContain("Your chai or coffee moment");
    await act(async () => byId("daily-theme-post")[0]!.props.onPress());
    expect(onPost).toHaveBeenCalled();
  });

  test("not once they've posted today, and not before their first Story (that card asks instead)", async () => {
    growth.getTodayTheme.mockResolvedValue({ ...theme, postedToday: true });
    users.getProfile.mockResolvedValue({ profile: { storyCount: 3 } } as never);
    await render();
    expect(tree.toJSON()).toBeNull();
    await act(async () => tree.unmount());
    growth.getTodayTheme.mockResolvedValue(theme);
    users.getProfile.mockResolvedValue({ profile: { storyCount: 0 } } as never);
    await render();
    expect(tree.toJSON()).toBeNull();
  });

  test("Not today hides it until tomorrow's theme", async () => {
    growth.getTodayTheme.mockResolvedValue(theme);
    users.getProfile.mockResolvedValue({ profile: { storyCount: 3 } } as never);
    await render();
    await act(async () => byId("daily-theme-hide")[0]!.props.onPress());
    expect(tree.toJSON()).toBeNull();
    expect(await AsyncStorage.getItem("katkee.dailyTheme.hidden.v1.u1")).toBe("2026-11-20");
    await act(async () => tree.unmount());
    await render();
    expect(tree.toJSON()).toBeNull();
    await act(async () => tree.unmount());
    growth.getTodayTheme.mockResolvedValue({ ...theme, date: "2026-11-21", slug: "sky", title: "Today's sky" });
    await render();
    expect(text()).toContain("Today's sky");
  });
});

describe("Founding member welcome", () => {
  const render = async () => {
    jest.useFakeTimers();
    await act(async () => { tree = create(<FoundingWelcome />); });
    await act(async () => { jest.advanceTimersByTime(2000); });
    jest.useRealTimers();
    await flush();
  };

  test("tells a founding member their number and the spots left, once, with Invite friends", async () => {
    users.getProfile.mockResolvedValue({ profile: { foundingNumber: 60 } } as never);
    growth.getFoundingSpots.mockResolvedValue({ total: 1000, taken: 60, left: 940 });
    await render();
    expect(text()).toContain("You're Founding member #60");
    expect(text()).toContain("940 spots left");
    await act(async () => byId("founding-invite")[0]!.props.onPress());
    expect(invites.shareInvite).toHaveBeenCalledWith("home", "token", "u1");
    expect(byId("founding-welcome")).toHaveLength(0);
    await act(async () => tree.unmount());
    await render();
    expect(byId("founding-welcome")).toHaveLength(0);
  });

  test("nothing for anyone who joined after the first 1,000", async () => {
    users.getProfile.mockResolvedValue({ profile: { foundingNumber: null } } as never);
    await render();
    expect(byId("founding-welcome")).toHaveLength(0);
    expect(growth.getFoundingSpots).not.toHaveBeenCalled();
  });
});

test("Katkee's own account says so in People to follow", () => {
  expect(suggestionReasonText({ kind: "official" })).toBe("Katkee's official account");
});
