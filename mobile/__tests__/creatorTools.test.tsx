import React from "react";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { Alert, Text } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import * as professionalApi from "../src/api/professional";
import * as storiesApi from "../src/api/stories";
import { ProfessionalAccountScreen } from "../src/screens/profile/ProfessionalAccountScreen";
import { ProfessionalDashboardScreen, changeText } from "../src/screens/profile/ProfessionalDashboardScreen";
import { ScheduledStoriesScreen } from "../src/screens/profile/ScheduledStoriesScreen";
import { ScheduleSheet } from "../src/components/ScheduleSheet";
import { FollowerGrowthChart, growthDayText } from "../src/components/charts/FollowerGrowthChart";
import { ActiveHoursChart } from "../src/components/charts/ActiveHoursChart";
import { ProfileHeader } from "../src/components/profile/ProfileHeader";
import { MAX_SCHEDULE_AHEAD_MS, defaultScheduleTime, scheduleDays, scheduleProblem } from "../src/models/schedule";
import { ApiError } from "../src/api/client";
import { track } from "../src/analytics/analytics";
import { tapFeedback } from "../src/utils/haptics";

// Creator tools: professional accounts, their dashboard, and scheduled Stories, with the network replaced.
const mockAuth = {
  accessToken: "token",
  user: { id: "u-me", username: "me_now", email: null, displayName: "Me Now", bio: "", avatarMediaId: null, interests: [], isPrivate: false } as Record<string, unknown>,
  applyProfile: jest.fn(),
};
jest.mock("../src/state/AuthContext", () => ({ useAuth: () => mockAuth }));
jest.mock("../src/analytics/analytics", () => ({ track: jest.fn() }));
jest.mock("../src/utils/haptics", () => ({ tapFeedback: jest.fn() }));
jest.mock("../src/components/Toast", () => ({ showToast: jest.fn() }));
jest.mock("@react-navigation/native", () => ({
  ...jest.requireActual("@react-navigation/native"),
  useFocusEffect: (effect: () => void) => require("react").useEffect(() => effect(), [effect]),
}));
jest.mock("../src/api/professional", () => ({
  ...jest.requireActual("../src/api/professional"),
  getProfessionalStatus: jest.fn(),
  setProfessional: jest.fn(),
  switchToPersonal: jest.fn(),
  getDashboard: jest.fn(),
}));
jest.mock("../src/api/stories", () => ({
  ...jest.requireActual("../src/api/stories"),
  getScheduledStories: jest.fn(),
  rescheduleStory: jest.fn(),
  cancelScheduledStory: jest.fn(async () => undefined),
}));

const pro = professionalApi as jest.Mocked<typeof professionalApi>;
const stories = storiesApi as jest.Mocked<typeof storiesApi>;
const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
const navigation = { navigate: jest.fn(), replace: jest.fn(), setOptions: jest.fn(), goBack: jest.fn() };

let tree: ReactTestRenderer;
afterEach(async () => {
  await act(async () => tree?.unmount());
  jest.restoreAllMocks();
  jest.clearAllMocks();
});
const flush = async () => { for (let i = 0; i < 6; i++) await act(async () => { await Promise.resolve(); }); };
async function render(element: React.ReactElement): Promise<void> {
  await act(async () => { tree = create(<SafeAreaProvider initialMetrics={metrics}>{element}</SafeAreaProvider>); });
  await flush();
}
const texts = () => tree.root.findAllByType(Text).map((t) => [t.props.children].flat().join(""));
const hasText = (pattern: RegExp) => texts().some((t) => pattern.test(t));
const byLabel = (label: string | RegExp): ReactTestInstance =>
  tree.root.find((n) => typeof n.type !== "string" && !!n.props.onPress && (typeof label === "string" ? n.props.accessibilityLabel === label : label.test(String(n.props.accessibilityLabel ?? ""))));
const press = async (node: ReactTestInstance) => { await act(async () => { node.props.onPress(); }); await flush(); };

const dashboard = (over: Partial<professionalApi.Dashboard> = {}): professionalApi.Dashboard => ({
  days: 7, timeZone: "Asia/Kolkata", from: "2026-10-24", to: "2026-10-30",
  summary: { accountsReached: 120, reachedFollowers: 90, storyViews: 300, storiesPosted: 4, likes: 25, comments: 3, replies: 6, shares: 2, followers: 512, followersNet: 7 },
  previous: { accountsReached: 100, storyViews: 0 },
  daily: Array.from({ length: 7 }, (_, i) => ({ day: `2026-10-${24 + i}`, views: 40 + i, followersGained: i === 0 ? null : 2, followersLost: i === 0 ? null : 1 })),
  followerHistorySince: "2026-10-25",
  topStories: [{ id: "s1", mediaId: "11111111-1111-4111-8111-111111111111", createdAt: "2026-10-29T10:00:00Z", expiresAt: "2026-10-30T10:00:00Z", views: 150, likes: 12, replies: 3, shares: 1, media: null }],
  audience: { status: "ready", hours: Array.from({ length: 24 }, (_, h) => (h === 20 ? 100 : 30)), peakHour: 20, basedOnFollowers: 42, sampled: false, computedAt: "2026-10-30T00:00:00Z" },
  ...over,
});

describe("scheduling times", () => {
  it("offers today and the next 7 days, and refuses times too soon or too far ahead", () => {
    const now = new Date(2026, 9, 30, 18, 7);
    expect(scheduleDays(now)).toHaveLength(8);
    expect(scheduleDays(now)[7]!.getDate()).toBe(6);
    expect(scheduleProblem(new Date(now.getTime() + 5 * 60_000), now)).toMatch(/10 minutes/);
    expect(scheduleProblem(new Date(now.getTime() + MAX_SCHEDULE_AHEAD_MS + 60_000), now)).toMatch(/7 days/);
    expect(scheduleProblem(new Date(now.getTime() + 3 * 3600_000), now)).toBeNull();
    const suggested = defaultScheduleTime(now);
    expect(suggested.getMinutes()).toBe(0);
    expect(suggested.getTime() - now.getTime()).toBeGreaterThanOrEqual(3600_000);
  });

  it("the sheet explains a time it can't use and won't confirm it", async () => {
    const onConfirm = jest.fn();
    await render(<ScheduleSheet visible initial={new Date(Date.now() + 60_000)} onConfirm={onConfirm} onClose={jest.fn()} />);
    expect(hasText(/at least 10 minutes from now/)).toBe(true);
    expect(byLabel("Schedule").props.disabled).toBe(true);
    // Choosing tomorrow fixes it.
    await press(byLabel("Tomorrow"));
    expect(byLabel("Schedule").props.disabled).toBeFalsy();
    expect(tapFeedback).toHaveBeenCalledWith("select");
    await press(byLabel("Schedule"));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect((onConfirm.mock.calls[0]![0] as Date).getDate()).toBe(new Date(Date.now() + 86_400_000).getDate());
  });
});

describe("the professional account screen", () => {
  it("explains why a private account can't switch, and doesn't let it", async () => {
    pro.getProfessionalStatus.mockResolvedValue({ professional: null, eligibility: { eligible: false, reasons: ["Private accounts can't be professional. Make your account public first."] } });
    await render(<ProfessionalAccountScreen navigation={navigation as never} route={{ key: "p", name: "ProfessionalAccount" } as never} />);
    expect(hasText(/Your account is private/)).toBe(true);
    expect(byLabel("Switch to professional account").props.disabled).toBe(true);
    expect(byLabel(/^Creator\./).props.disabled).toBe(true);
  });

  it("switches with the chosen category and the phone's time zone, then opens the dashboard", async () => {
    pro.getProfessionalStatus.mockResolvedValue({ professional: null, eligibility: { eligible: true, reasons: [] } });
    pro.setProfessional.mockResolvedValue({ professional: { category: "artist", showCategory: true, since: "2026-10-30T00:00:00Z" }, eligibility: { eligible: true, reasons: [] } });
    await render(<ProfessionalAccountScreen navigation={navigation as never} route={{ key: "p", name: "ProfessionalAccount" } as never} />);
    expect(byLabel("Switch to professional account").props.disabled).toBe(true);
    await press(byLabel(/^Artist\./));
    await press(byLabel("Switch to professional account"));
    expect(pro.setProfessional).toHaveBeenCalledWith(expect.objectContaining({ category: "artist", showCategory: true }), "token");
    expect(mockAuth.applyProfile).toHaveBeenCalledWith(expect.objectContaining({ professionalCategory: "artist", professionalCategoryShown: true }));
    expect(tapFeedback).toHaveBeenCalledWith("success");
    expect(navigation.replace).toHaveBeenCalledWith("ProfessionalDashboard");
  });

  it("switches back after asking", async () => {
    pro.getProfessionalStatus.mockResolvedValue({ professional: { category: "creator", showCategory: true, since: "2026-10-01T00:00:00Z" }, eligibility: { eligible: true, reasons: [] } });
    pro.switchToPersonal.mockResolvedValue({ professional: null, eligibility: { eligible: true, reasons: [] } });
    const alert = jest.spyOn(Alert, "alert").mockImplementation((_t, _m, buttons) => { void buttons?.find((b) => b.text === "Switch")?.onPress?.(); });
    await render(<ProfessionalAccountScreen navigation={navigation as never} route={{ key: "p", name: "ProfessionalAccount" } as never} />);
    await press(byLabel("Switch to personal account"));
    expect(alert).toHaveBeenCalled();
    expect(pro.switchToPersonal).toHaveBeenCalledWith("token");
    expect(mockAuth.applyProfile).toHaveBeenCalledWith(expect.objectContaining({ professionalCategory: null }));
  });
});

describe("the professional dashboard", () => {
  it("shows the period's numbers, honest comparisons, top Stories and active hours", async () => {
    pro.getDashboard.mockResolvedValue({ dashboard: dashboard() });
    await render(<ProfessionalDashboardScreen navigation={navigation as never} route={{ key: "d", name: "ProfessionalDashboard" } as never} />);
    expect(pro.getDashboard).toHaveBeenCalledWith(7, "token");
    expect(track).toHaveBeenCalledWith("professional_dashboard_viewed", { range: "7d" });
    expect(hasText(/^120$/)).toBe(true);
    expect(hasText(/\+20% vs the previous 7 days/)).toBe(true);
    expect(hasText(/75% already followed you/)).toBe(true);
    expect(hasText(/512 followers · \+7 in this period/)).toBe(true);
    expect(hasText(/Most active/)).toBe(true);
    // No views before: no made-up percentage.
    expect(changeText(300, 0, 7)).toBeNull();
    await press(byLabel(/^Number 1, posted/));
    expect(navigation.navigate).toHaveBeenCalledWith("ArchivedStoryViewer", { storyId: "s1" });

    pro.getDashboard.mockResolvedValue({ dashboard: dashboard({ days: 30 }) });
    await press(byLabel("Last 30 days"));
    expect(pro.getDashboard).toHaveBeenLastCalledWith(30, "token");
    expect(track).toHaveBeenCalledWith("professional_dashboard_viewed", { range: "30d" });
  });

  it("holds back active hours below the minimum, and says so", async () => {
    pro.getDashboard.mockResolvedValue({ dashboard: dashboard({ audience: { status: "not_enough", minimumFollowers: 10 } }) });
    await render(<ProfessionalDashboardScreen navigation={navigation as never} route={{ key: "d", name: "ProfessionalDashboard" } as never} />);
    expect(hasText(/at least 10 of your followers/)).toBe(true);
  });

  it("offers the switch to a personal account that opens it", async () => {
    pro.getDashboard.mockRejectedValue(new ApiError(403, "Switch to a professional account to see your dashboard."));
    await render(<ProfessionalDashboardScreen navigation={navigation as never} route={{ key: "d", name: "ProfessionalDashboard" } as never} />);
    await press(byLabel("Switch to professional"));
    expect(navigation.replace).toHaveBeenCalledWith("ProfessionalAccount");
  });

  it("charts say what each bar means to screen readers, and never call uncounted days quiet", async () => {
    await render(<FollowerGrowthChart days={dashboard().daily} />);
    expect(growthDayText(dashboard().daily[0]!)).toMatch(/not counted yet/);
    const days = tree.root.findAll((n) => typeof n.type !== "string" && !!n.props.onPress && /2 gained, 1 lost/.test(String(n.props.accessibilityLabel ?? "")));
    expect(days).toHaveLength(6);
    expect(days[0]!.props.accessibilityRole).toBe("button");
    await act(async () => tree.unmount());
    await render(<ActiveHoursChart hours={dashboard().audience.status === "ready" ? (dashboard().audience as { hours: number[] }).hours : []} peakHour={20} />);
    expect(hasText(/busiest hour/)).toBe(true);
    await press(tree.root.findAll((n) => typeof n.type !== "string" && !!n.props.onPress && /30% as busy/.test(String(n.props.accessibilityLabel ?? "")))[0]!);
    expect(tapFeedback).toHaveBeenCalledWith("select");
  });

  it("puts the category quietly under the name on a profile", async () => {
    await render(<ProfileHeader username="asha" displayName="Asha" bio="" interests={[]} avatarMediaId={null} isPrivate={false} professionalCategory="brand" hasActiveStory={false} storyLabel="" stats={[]} />);
    expect(hasText(/^Business$/)).toBe(true);
  });
});

describe("the Scheduled list", () => {
  const item = (over: Partial<storiesApi.ScheduledStory> = {}): storiesApi.ScheduledStory => ({
    id: "sch-1", requestId: "story_abcdefghijklmnop", state: "scheduled", publishAt: new Date(Date.now() + 2 * 3600_000).toISOString(),
    createdAt: new Date().toISOString(), error: null, storyId: null, caption: "Diwali eve", audience: "followers", mediaId: "22222222-2222-4222-8222-222222222222", media: null, ...over,
  });

  it("lists what's waiting, and cancels one after asking", async () => {
    stories.getScheduledStories.mockResolvedValue({ scheduled: [item(), item({ id: "sch-2", state: "failed", error: "Your account can't post Stories right now." })] });
    jest.spyOn(Alert, "alert").mockImplementation((_t, _m, buttons) => { void buttons?.find((b) => b.style === "destructive")?.onPress?.(); });
    await render(<ScheduledStoriesScreen navigation={navigation as never} route={{ key: "s", name: "ScheduledStories" } as never} />);
    expect(hasText(/Followers · Diwali eve/)).toBe(true);
    expect(hasText(/Couldn't be posted/)).toBe(true);
    expect(hasText(/can't post Stories right now/)).toBe(true);
    await press(byLabel(/^Cancel the Story scheduled for/));
    expect(stories.cancelScheduledStory).toHaveBeenCalledWith("sch-1", "token");
    expect(hasText(/Diwali eve/)).toBe(false);
  });

  it("reschedules with the sheet", async () => {
    stories.getScheduledStories.mockResolvedValue({ scheduled: [item()] });
    const moved = item({ publishAt: new Date(Date.now() + 26 * 3600_000).toISOString() });
    stories.rescheduleStory.mockResolvedValue({ scheduled: moved });
    await render(<ScheduledStoriesScreen navigation={navigation as never} route={{ key: "s", name: "ScheduledStories" } as never} />);
    await press(byLabel(/^Reschedule the Story/));
    await press(byLabel("Tomorrow"));
    await press(byLabel("Save new time"));
    expect(stories.rescheduleStory).toHaveBeenCalledWith("sch-1", expect.any(String), "token");
  });

  it("says how to schedule when there's nothing", async () => {
    stories.getScheduledStories.mockResolvedValue({ scheduled: [] });
    await render(<ScheduledStoriesScreen navigation={navigation as never} route={{ key: "s", name: "ScheduledStories" } as never} />);
    expect(hasText(/Nothing scheduled/)).toBe(true);
  });
});
