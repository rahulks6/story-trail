import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { InviteContestScreen } from "../src/screens/profile/InviteContestScreen";
import { ContestButton } from "../src/components/ContestButton";
import { daysLeft, resetContestCache } from "../src/state/contest";
import { deepLinkTarget, opensInApp } from "../src/navigation/profileLinks";
import * as growthApi from "../src/api/growth";
import * as invites from "../src/state/invites";
import type { Contest } from "../src/api/growth";

jest.mock("../src/state/AuthContext", () => ({ useAuth: () => ({ accessToken: "token", user: { id: "u1", username: "maya" } }) }));
jest.mock("../src/api/growth", () => ({ getContest: jest.fn() }));
jest.mock("../src/state/invites", () => ({ shareInvite: jest.fn(), myInviteUrl: jest.fn(), shareTextToWhatsApp: jest.fn(), inviteMessage: (url: string) => `Join me ${url}` }));
jest.mock("../src/components/Avatar", () => ({ Avatar: () => null }));
const growth = growthApi as jest.Mocked<typeof growthApi>;
const share = invites as jest.Mocked<typeof invites>;
const storage = (global as unknown as { __mockStorage: Map<string, string> }).__mockStorage;
const flush = async () => { for (let i = 0; i < 8; i++) await act(async () => { await Promise.resolve(); }); };
let tree: ReactTestRenderer;
const byId = (id: string) => tree.root.findAll((n) => n.props.testID === id);
// Every Text's words (the ScrollView's refresh control can't be serialised).
const text = () => tree.root.findAll((n) => (n.type as unknown) === "Text").map((n) => [n.props.children].flat(Infinity).join("")).join(" | ");

const day = 24 * 3600 * 1000;
const contest = (over: Partial<Contest> = {}): Contest => ({
  slug: "december-2026",
  prize: { amountMinor: 100000, currency: "INR", kind: "amazon_voucher" },
  startsAt: new Date(Date.now() - 2 * day).toISOString(),
  endsAt: new Date(Date.now() + 5 * day - 3600_000).toISOString(),
  countsUntil: new Date(Date.now() + 8 * day).toISOString(),
  qualifyDays: 3,
  state: "running",
  rulesUrl: "https://katkee.com/contest",
  winner: null,
  me: {
    counted: 1, pending: 1, rank: 2, toFirst: 2,
    friends: [
      { username: "riya", displayName: "Riya", activeDays: 3, counted: true },
      { username: "aman", displayName: "Aman", activeDays: 1, counted: false },
    ],
  },
  leaders: [
    { rank: 1, userId: "u2", username: "kabir", displayName: "Kabir", avatarMediaId: null, counted: 2 },
    { rank: 2, userId: "u1", username: "maya", displayName: "Maya", avatarMediaId: null, counted: 1 },
  ],
  ...over,
});

beforeEach(() => { storage.clear(); jest.clearAllMocks(); resetContestCache(); });
afterEach(async () => { await act(async () => tree?.unmount()); jest.useRealTimers(); });

describe("Invite contest screen", () => {
  const render = async () => { await act(async () => { tree = create(<InviteContestScreen />); }); await flush(); };

  test("shows the prize, days left, your place, friends' progress and the leaderboard", async () => {
    growth.getContest.mockResolvedValue({ contest: contest() });
    await render();
    expect(text()).toContain("Invite friends, win a ₹1,000 Amazon voucher");
    expect(text()).toContain("5 days left to invite");
    expect(text()).toContain("#2");
    expect(text()).toContain("2 more friends to take #1");
    expect(byId("contest-friend-riya")).not.toHaveLength(0);
    expect(text()).toContain("Counts ✓");
    expect(text()).toContain("1 of 3 days");
    expect(text()).toContain("Remind friends to open Katkee on 3 different days");
    expect(byId("contest-leader-kabir")).not.toHaveLength(0);
    expect(text()).toContain("2 friends");
  });

  test("invites on WhatsApp with your link, or the share sheet", async () => {
    growth.getContest.mockResolvedValue({ contest: contest() });
    share.myInviteUrl.mockResolvedValue("https://katkee.com/i/abcdefgh");
    share.shareTextToWhatsApp.mockResolvedValue(true);
    await render();
    await act(async () => byId("contest-whatsapp")[0]!.props.onPress());
    await flush();
    expect(share.shareTextToWhatsApp).toHaveBeenCalledWith("Join me https://katkee.com/i/abcdefgh");
    await act(async () => byId("contest-share")[0]!.props.onPress());
    expect(share.shareInvite).toHaveBeenCalledWith("contest", "token", "u1");
  });

  test("when you lead, and once invites close, and with the winner", async () => {
    growth.getContest.mockResolvedValue({ contest: contest({ me: { counted: 3, pending: 0, rank: 1, toFirst: 0, friends: [] } }) });
    await render();
    expect(text()).toContain("You're in the lead!");
    await act(async () => tree.unmount());
    resetContestCache();
    growth.getContest.mockResolvedValue({ contest: contest({ state: "counting" }) });
    await render();
    expect(text()).toContain("Invites are closed");
    expect(byId("contest-whatsapp")).toHaveLength(0);
    await act(async () => tree.unmount());
    resetContestCache();
    growth.getContest.mockResolvedValue({ contest: contest({ state: "final", winner: { username: "kabir", displayName: "Kabir" } }) });
    await render();
    expect(text()).toContain("Winner: @kabir");
  });

  test("says so when there's no contest", async () => {
    growth.getContest.mockResolvedValue({ contest: null });
    await render();
    expect(text()).toContain("There's no invite contest right now.");
  });
});

describe("Home's contest button", () => {
  test("opens the contest, and the intro shows once per contest", async () => {
    jest.useFakeTimers();
    growth.getContest.mockResolvedValue({ contest: contest() });
    const onOpen = jest.fn();
    await act(async () => { tree = create(<ContestButton style={{}} onOpen={onOpen} />); });
    await flush();
    expect(byId("contest-button")).not.toHaveLength(0);
    await act(async () => { jest.advanceTimersByTime(4100); });
    await flush();
    expect(text()).toContain("Win a ₹1,000 Amazon voucher");
    await act(async () => byId("contest-intro-later")[0]!.props.onPress());
    await flush();
    expect(byId("contest-intro")).toHaveLength(0);
    expect(await AsyncStorage.getItem("katkee.contest.intro.v1.u1.december-2026")).toBe("1");
    await act(async () => byId("contest-button")[0]!.props.onPress());
    expect(onOpen).toHaveBeenCalled();
  });

  test("isn't there without a contest", async () => {
    growth.getContest.mockResolvedValue({ contest: null });
    await act(async () => { tree = create(<ContestButton style={{}} onOpen={jest.fn()} />); });
    await flush();
    expect(tree.toJSON()).toBeNull();
  });
});

describe("Contest links and dates", () => {
  test("katkee://contest opens the screen; katkee.com/contest stays the web rules page", () => {
    expect(deepLinkTarget("contest")).toEqual({ kind: "contest" });
    expect(opensInApp("katkee://contest")).toBe(true);
    expect(opensInApp("https://katkee.com/contest")).toBe(false);
  });

  test("days left counts today, and is 0 once invites close", () => {
    const c = contest({ endsAt: new Date(Date.now() + 3600_000).toISOString() });
    expect(daysLeft(c)).toBe(1);
    expect(daysLeft(contest({ endsAt: new Date(Date.now() - 1000).toISOString() }))).toBe(0);
  });
});
