import React from "react";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { Alert, Modal, Share, Text } from "react-native";
import Clipboard from "@react-native-clipboard/clipboard";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ProfileScreen } from "../src/screens/profile/ProfileScreen";
import { UserProfileScreen } from "../src/screens/profile/UserProfileScreen";
import { countLabel, formatCount } from "../src/utils/formatCount";
import * as usersApi from "../src/api/users";
import * as storiesApi from "../src/api/stories";

// The creator page (Phase 10): your own and other people's, with the network replaced.
const mockAuth = {
  accessToken: "token",
  user: { id: "u-me", username: "me_now", email: "me@example.com", displayName: "Me Now", bio: "Chai and cricket.", avatarMediaId: null, interests: ["Cricket"], isPrivate: false },
};
const mockRootNavigation = { navigate: jest.fn() };
const mockHighlights = { count: 3 as number | null, mounted: 0 };
jest.mock("../src/state/AuthContext", () => ({ useAuth: () => mockAuth }));
jest.mock("../src/analytics/analytics", () => ({ track: jest.fn() }));
jest.mock("../src/api/users", () => ({
  ...jest.requireActual("../src/api/users"),
  getProfile: jest.fn(),
  followUser: jest.fn(async () => ({ status: "following" })),
  unfollowUser: jest.fn(async () => undefined),
  muteUser: jest.fn(async () => undefined),
  unmuteUser: jest.fn(async () => undefined),
  blockUser: jest.fn(async () => undefined),
  listFollowRequests: jest.fn(async () => ({ requests: [], limit: 50, offset: 0 })),
  acceptFollowRequest: jest.fn(async () => undefined),
  declineFollowRequest: jest.fn(async () => undefined),
}));
jest.mock("../src/api/stories", () => ({ getUserActiveStories: jest.fn(async () => ({ stories: [] })), getMyActiveStories: jest.fn(async () => ({ stories: [] })) }));
jest.mock("../src/api/conversations", () => ({ openConversation: jest.fn() }));
jest.mock("../src/components/ReportSheet", () => ({ ReportSheet: (props: { visible: boolean }) => (props.visible ? require("react").createElement("ReportSheet") : null) }));
jest.mock("../src/components/HighlightsRow", () => ({
  HighlightsRow: (props: { onCountChange?: (n: number | null) => void }) => {
    const React = require("react");
    React.useEffect(() => {
      mockHighlights.mounted++;
      props.onCountChange?.(mockHighlights.count);
    }, []);
    return React.createElement("HighlightsGrid");
  },
}));
jest.mock("@react-navigation/native", () => ({
  ...jest.requireActual("@react-navigation/native"),
  useNavigation: () => mockRootNavigation,
  useFocusEffect: (effect: () => void) => require("react").useEffect(() => effect(), [effect]),
}));

const api = usersApi as jest.Mocked<typeof usersApi>;
const stories = storiesApi as jest.Mocked<typeof storiesApi>;
const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
const profile = (over: Partial<usersApi.ProfileView> = {}, viewer: Partial<usersApi.ProfileView["viewer"]> = {}): usersApi.ProfileView => ({
  id: "11111111-2222-4333-8444-555555555555", username: "asha_k", displayName: "Asha K", bio: "Street food in Pune.", avatarMediaId: null,
  interests: ["Food", "Travel"], isPrivate: false, isSelf: false, followerCount: 12345, followingCount: 180, storyCount: 27,
  ...over,
  viewer: { isFollowing: false, isFollowedBy: false, hasPendingRequestFromViewer: false, hasPendingRequestFromTarget: false, isMutedByViewer: false, ...viewer },
});

let tree: ReactTestRenderer;
const navigation = { navigate: jest.fn(), setOptions: jest.fn(), goBack: jest.fn(), canGoBack: jest.fn(() => true) };
beforeEach(() => {
  mockHighlights.count = 3;
  mockHighlights.mounted = 0;
});
afterEach(async () => {
  await act(async () => tree?.unmount());
  jest.restoreAllMocks();
  jest.clearAllMocks();
});
const flush = async () => { for (let i = 0; i < 5; i++) await act(async () => { await Promise.resolve(); }); };
async function render(element: React.ReactElement): Promise<void> {
  await act(async () => { tree = create(<SafeAreaProvider initialMetrics={metrics}>{element}</SafeAreaProvider>); });
  await flush();
}
const renderOther = (params: { username: string; userId?: string } = { username: "asha_k" }) =>
  render(<UserProfileScreen navigation={navigation as never} route={{ key: "UserProfile", name: "UserProfile", params } as never} />);
const texts = () => tree.root.findAllByType(Text).map((t) => [t.props.children].flat().join(""));
const labelled = (label: string) => tree.root.findAll((n: ReactTestInstance) => typeof n.type === "string" && n.props.accessibilityLabel === label);
const press = async (label: string) => {
  const target = tree.root.find((n: ReactTestInstance) => typeof n.props.onPress === "function" && n.props.accessibilityLabel === label);
  await act(async () => target.props.onPress());
  await flush();
};
const alertButton = (alert: jest.SpyInstance, text: string) => (alert.mock.calls.at(-1)![2] as Array<{ text: string; onPress?: () => void }>).find((b) => b.text === text)!;
/** The More button the page puts in the navigation header. */
async function openMore(): Promise<void> {
  const options = navigation.setOptions.mock.calls.at(-1)![0] as { headerRight?: () => React.ReactElement };
  let header!: ReactTestRenderer;
  await act(async () => { header = create(options.headerRight!()); });
  await act(async () => header.root.find((n: ReactTestInstance) => typeof n.props.onPress === "function").props.onPress());
  await flush();
}
/** Choose a row in More; it runs once the sheet has closed, as on iOS. */
async function chooseInMore(label: string): Promise<void> {
  await press(label);
  const sheet = tree.root.findAllByType(Modal).find((m) => typeof m.props.onDismiss === "function")!;
  await act(async () => sheet.props.onDismiss());
  await flush();
}

describe("counts", () => {
  test("read like a profile's: exact below 10,000, then rounded down with K and M", () => {
    expect([0, 1, 999, 9999, 10_000, 12_345, 99_999, 123_456, 999_999, 1_000_000, 1_250_000, 2_000_000_000].map(formatCount))
      .toEqual(["0", "1", "999", "9,999", "10K", "12.3K", "99.9K", "123K", "999K", "1M", "1.2M", "2B"]);
    expect(countLabel(1, "follower", "followers")).toBe("1 follower");
    expect(countLabel(12_345, "follower", "followers")).toBe("12,345 followers");
  });
});

describe("someone else's page", () => {
  test("shows who they are: photo, counts, name, username, bio, interests, and that they follow you", async () => {
    api.getProfile.mockResolvedValue({ profile: profile({}, { isFollowedBy: true }) });
    await renderOther();
    expect(navigation.setOptions).toHaveBeenLastCalledWith(expect.objectContaining({ title: "asha_k" }));
    expect(texts()).toEqual(expect.arrayContaining(["27", "Stories", "12.3K", "Followers", "180", "Following", "Asha K", "@asha_k", "Follows you", "Street food in Pune.", "Food", "Travel"]));
    expect(labelled("12,345 followers")).toHaveLength(1);
    expect(texts()).toContain("Follow back");
    expect(tree.root.findAllByType("HighlightsGrid" as never)).toHaveLength(1);
  });

  test("Follow follows at once; unfollowing and cancelling a request ask first", async () => {
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
    api.getProfile.mockResolvedValueOnce({ profile: profile() }).mockResolvedValue({ profile: profile({}, { isFollowing: true }) });
    await renderOther();
    await press("Follow");
    expect(api.followUser).toHaveBeenCalledWith("asha_k", "token");
    expect(texts()).toContain("Following");

    await press("Following");
    expect(alert.mock.calls.at(-1)![0]).toBe("Unfollow @asha_k?");
    expect(api.unfollowUser).not.toHaveBeenCalled();
    api.getProfile.mockResolvedValue({ profile: profile({ isPrivate: true }, { hasPendingRequestFromViewer: true }) });
    await act(async () => alertButton(alert, "Unfollow").onPress!());
    await flush();
    expect(api.unfollowUser).toHaveBeenCalledWith("asha_k", "token");

    await press("Requested");
    expect(alert.mock.calls.at(-1)![0]).toBe("Cancel your follow request?");
    expect(alertButton(alert, "Cancel request")).toBeTruthy();
  });

  test("a private account you don't follow shows who it is, not its Stories, Highlights or lists", async () => {
    api.getProfile.mockResolvedValue({ profile: profile({ isPrivate: true }) });
    await renderOther();
    expect(texts()).toEqual(expect.arrayContaining(["This account is private", "Follow @asha_k to see their Stories and Highlights."]));
    expect(tree.root.findAllByType("HighlightsGrid" as never)).toHaveLength(0);
    expect(labelled("Private account")).toHaveLength(1);
    // Counts still show (the lists can't be opened). How many Stories they have posted shows to everyone, like the follower count.
    expect(texts()).toEqual(expect.arrayContaining(["27", "Stories"]));
    expect(tree.root.findAll((n: ReactTestInstance) => typeof n.props.onPress === "function" && n.props.accessibilityLabel === "12,345 followers")).toHaveLength(0);
  });

  test("an account with no Highlights says so", async () => {
    mockHighlights.count = 0;
    api.getProfile.mockResolvedValue({ profile: profile() });
    await renderOther();
    expect(texts()).toEqual(expect.arrayContaining(["No Highlights yet", "When @asha_k keeps Stories in Highlights, they'll show here."]));
  });

  test("an active Story rings the photo and opens from it", async () => {
    api.getProfile.mockResolvedValue({ profile: profile() });
    stories.getUserActiveStories.mockResolvedValueOnce({ stories: [{ id: "s1" }] } as never);
    await renderOther();
    await press("Open Asha K's Story");
    expect(mockRootNavigation.navigate).toHaveBeenCalledWith("StoryViewer", { creators: ["asha_k"], startIndex: 0 });
  });

  test("More: copy the link with the account ID, mute, block after confirming, report", async () => {
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
    const toast = jest.spyOn(require("../src/components/Toast"), "showToast");
    api.getProfile.mockResolvedValue({ profile: profile() });
    await renderOther();

    await openMore();
    await press("Copy profile link");
    expect(Clipboard.setString).not.toHaveBeenCalled(); // not while the sheet is still closing (iOS)
    const sheet = tree.root.findAllByType(Modal).find((m) => typeof m.props.onDismiss === "function")!;
    expect(sheet.props.visible).toBe(false);
    await act(async () => sheet.props.onDismiss());
    expect(Clipboard.setString).toHaveBeenCalledWith("https://katkee.com/u/asha_k?id=11111111-2222-4333-8444-555555555555");

    api.getProfile.mockResolvedValue({ profile: profile({}, { isMutedByViewer: true }) });
    await openMore();
    await chooseInMore("Mute");
    expect(api.muteUser).toHaveBeenCalledWith("asha_k", "token");
    expect(toast).toHaveBeenLastCalledWith("Muted @asha_k. They won't know."); // a toast, not a dialog to dismiss
    await openMore();
    expect(labelled("Unmute")).toHaveLength(1);
    await chooseInMore("Unmute");
    expect(api.unmuteUser).toHaveBeenCalledWith("asha_k", "token");

    await openMore();
    await chooseInMore("Block");
    expect(alert.mock.calls.at(-1)![0]).toBe("Block @asha_k?");
    expect(api.blockUser).not.toHaveBeenCalled();
    await act(async () => { await (alertButton(alert, "Block").onPress as () => Promise<void>)(); });
    expect(api.blockUser).toHaveBeenCalledWith("asha_k", "token");
    expect(navigation.goBack).toHaveBeenCalled();

    await openMore();
    await chooseInMore("Report");
    expect(tree.root.findAllByType("ReportSheet" as never)).toHaveLength(1);
  });

  test("shows the page's shape while loading, and a retry when loading fails", async () => {
    let resolve!: (v: { profile: usersApi.ProfileView }) => void;
    api.getProfile.mockReturnValueOnce(new Promise((r) => { resolve = r; }));
    await renderOther();
    expect(labelled("Loading profile")).toHaveLength(1);
    await act(async () => resolve({ profile: profile() }));
    await flush();
    expect(texts()).toContain("@asha_k");

    await act(async () => tree.unmount());
    api.getProfile.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce({ profile: profile() });
    await renderOther();
    expect(texts()).toContain("Couldn't load this profile.");
    await press("Try again");
    expect(texts()).toContain("@asha_k");
  });
});

describe("someone else's page: background refreshes and taps in flight", () => {
  test("a failed refresh after Follow keeps the page and says so, instead of an error screen", async () => {
    api.getProfile.mockResolvedValueOnce({ profile: profile() }).mockRejectedValueOnce(new Error("offline"));
    await renderOther();
    await press("Follow");
    expect(api.followUser).toHaveBeenCalledTimes(1);
    expect(texts()).toContain("@asha_k");
    expect(texts()).toContain("Couldn't refresh this profile. Pull down to try again.");
    expect(texts()).not.toContain("Couldn't load this profile.");
  });

  test("a second tap on Follow while the first is on its way does nothing", async () => {
    let finish!: () => void;
    api.getProfile.mockResolvedValue({ profile: profile() });
    api.followUser.mockReturnValueOnce(new Promise((r) => { finish = () => r({ status: "following" } as never); }));
    await renderOther();
    const follow = () => tree.root.find((n: ReactTestInstance) => typeof n.props.onPress === "function" && n.props.accessibilityLabel === "Follow");
    await act(async () => { follow().props.onPress(); follow().props.onPress(); });
    expect(api.followUser).toHaveBeenCalledTimes(1);
    await act(async () => finish());
    await flush();
  });

  test("their request to follow you can be confirmed from their page", async () => {
    api.getProfile.mockResolvedValueOnce({ profile: profile({}, { hasPendingRequestFromTarget: true }) }).mockResolvedValue({ profile: profile({}, { isFollowedBy: true }) });
    api.listFollowRequests.mockResolvedValueOnce({ requests: [{ requestId: "r-1", requesterId: "11111111-2222-4333-8444-555555555555", username: "asha_k", displayName: "Asha K", createdAt: "2026-10-01T00:00:00Z" }], limit: 50, offset: 0 });
    await renderOther();
    expect(texts()).toContain("@asha_k wants to follow you");
    await press("Confirm follow request");
    expect(api.acceptFollowRequest).toHaveBeenCalledWith("r-1", "token");
    expect(texts()).not.toContain("@asha_k wants to follow you");
  });

  test("blocking from a profile opened by a link goes to Search (there's nothing to go back to)", async () => {
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
    navigation.canGoBack.mockReturnValueOnce(false);
    api.getProfile.mockResolvedValue({ profile: profile() });
    await renderOther();
    await openMore();
    await chooseInMore("Block");
    await act(async () => { await (alertButton(alert, "Block").onPress as () => Promise<void>)(); });
    expect(navigation.goBack).not.toHaveBeenCalled();
    expect(navigation.navigate).toHaveBeenCalledWith("SearchHome");
  });
});

describe("your own page", () => {
  test("username in the top bar, counts, Edit and Share profile, Insights for you alone, Archive and Settings", async () => {
    api.getProfile.mockResolvedValue({ profile: profile({ username: "me_now", isSelf: true, followerCount: 2, followingCount: 1 }) });
    const share = jest.spyOn(Share, "share").mockResolvedValue({ action: "sharedAction" } as never);
    await render(<ProfileScreen />);
    expect(texts()).toEqual(expect.arrayContaining(["me_now", "Me Now", "@me_now", "Chai and cricket.", "Cricket", "2", "Followers", "1", "Following", "27", "Stories"]));
    // Insights is a small icon button beside Edit and Share profile, not a card.
    expect(texts()).not.toContain("Insights");
    await press("Share profile");
    expect(share).toHaveBeenCalledWith({ message: "@me_now on Katkee: https://katkee.com/u/me_now?id=u-me" });
    await press("Edit profile");
    await press("Insights. See how your Stories are doing. Only you can see this.");
    await press("Archive");
    await press("Settings");
    await press("2 followers");
    expect(mockRootNavigation.navigate.mock.calls).toEqual([
      ["EditProfile"], ["SequenceInsights"], ["Archive"], ["Settings"], ["FollowList", { username: "me_now", mode: "followers" }],
    ]);
  });

  test("until the email is verified, a banner asks for it and opens Verify your email", async () => {
    api.getProfile.mockResolvedValue({ profile: profile({ username: "me_now", isSelf: true }) });
    (mockAuth.user as { emailVerified?: boolean }).emailVerified = false;
    await render(<ProfileScreen />);
    expect(texts()).toContain("Verify your email");
    await press("Verify your email");
    expect(mockRootNavigation.navigate).toHaveBeenLastCalledWith("VerifyEmail");

    await act(async () => tree.unmount());
    (mockAuth.user as { emailVerified?: boolean }).emailVerified = true;
    await render(<ProfileScreen />);
    expect(texts()).not.toContain("Verify your email");
    delete (mockAuth.user as { emailVerified?: boolean }).emailVerified;
  });

  test("no active Story: the photo offers to add one; with one, the ring opens it", async () => {
    api.getProfile.mockResolvedValue({ profile: profile({ username: "me_now", isSelf: true }) });
    await render(<ProfileScreen />);
    await press("Add to your Story");
    expect(mockRootNavigation.navigate).toHaveBeenLastCalledWith("Main", { screen: "Create" });

    await act(async () => tree.unmount());
    stories.getMyActiveStories.mockResolvedValueOnce({ stories: [{ id: "s1" }] } as never);
    await render(<ProfileScreen />);
    expect(labelled("Add to your Story")).toHaveLength(0);
    await press("Open your Story");
    expect(mockRootNavigation.navigate).toHaveBeenLastCalledWith("StoryViewer", { creators: ["me_now"], startIndex: 0 });
  });
});

describe("the cover photo", () => {
  const covers = () => tree.root.findAll((n: ReactTestInstance) => typeof n.type === "string" && n.props.testID === "profile-cover");
  const coverImage = () => covers()[0]!.findAll((n: ReactTestInstance) => typeof n.type === "string" && !!n.props.source)[0]!;

  test("someone's cover shows across the top when they have one, fetched with your sign-in; a tap does nothing", async () => {
    api.getProfile.mockResolvedValue({ profile: profile({ coverMediaId: "c-1" }) });
    await renderOther();
    expect(covers()).toHaveLength(1);
    expect(coverImage().props.source).toEqual({ uri: expect.stringMatching(/\/api\/v1\/users\/asha_k\/cover\/file\?v=c-1$/), headers: { Authorization: "Bearer token" } });
    expect(covers()[0]!.findAll((n: ReactTestInstance) => typeof n.props.onPress === "function")).toHaveLength(0);
    // Decorative: screen readers skip it; the photo, name and counts still read as before.
    expect(covers()[0]!.props.importantForAccessibility).toBe("no-hide-descendants");
    expect(texts()).toEqual(expect.arrayContaining(["Asha K", "@asha_k", "12.3K"]));
  });

  test("no cover (or a server without covers): no banner at all", async () => {
    api.getProfile.mockResolvedValue({ profile: profile({ coverMediaId: null }) });
    await renderOther();
    expect(covers()).toHaveLength(0);
    await act(async () => tree.unmount());
    api.getProfile.mockResolvedValue({ profile: profile() });
    await renderOther();
    expect(covers()).toHaveLength(0);
  });

  test("a cover that can't be loaded goes, leaving the page as it is without one", async () => {
    api.getProfile.mockResolvedValue({ profile: profile({ coverMediaId: "c-1" }) });
    await renderOther();
    await act(async () => coverImage().props.onError({ nativeEvent: { error: "404" } }));
    expect(covers()).toHaveLength(0);
  });

  test("your own page shows the cover from your account, which changes as soon as you save", async () => {
    const me = mockAuth.user as { coverMediaId?: string | null };
    try {
      api.getProfile.mockResolvedValue({ profile: profile({ username: "me_now", isSelf: true, coverMediaId: "c-old" }) });
      me.coverMediaId = "c-me";
      await render(<ProfileScreen />);
      expect(coverImage().props.source.uri).toMatch(/\/users\/me_now\/cover\/file\?v=c-me$/);

      await act(async () => tree.unmount());
      me.coverMediaId = null;
      await render(<ProfileScreen />);
      expect(covers()).toHaveLength(0);

      // An account saved before covers: the profile fetch says.
      await act(async () => tree.unmount());
      delete me.coverMediaId;
      await render(<ProfileScreen />);
      expect(coverImage().props.source.uri).toMatch(/\/cover\/file\?v=c-old$/);
    } finally {
      delete me.coverMediaId;
    }
  });
});
