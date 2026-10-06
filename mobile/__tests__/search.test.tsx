import React from "react";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { FlatList, Text, TextInput } from "react-native";
import { SearchScreen, SEARCH_PAGE_SIZE } from "../src/screens/search/SearchScreen";
import { UserProfileScreen } from "../src/screens/profile/UserProfileScreen";
import * as usersApi from "../src/api/users";
import { ApiError } from "../src/api/client";
import { track } from "../src/analytics/analytics";

// Search (spec section 10) and profile links by account ID, with the network replaced.
const mockAuth = { accessToken: "token", user: { id: "u-me", username: "me" } };
const mockRootNavigation = { navigate: jest.fn() };
jest.mock("../src/state/AuthContext", () => ({ useAuth: () => mockAuth }));
jest.mock("../src/analytics/analytics", () => ({ track: jest.fn() }));
jest.mock("../src/api/users", () => ({
  ...jest.requireActual("../src/api/users"),
  getSuggestions: jest.fn(),
  searchUsers: jest.fn(),
  followUser: jest.fn(),
  unfollowUser: jest.fn(),
  getProfile: jest.fn(),
}));
jest.mock("../src/api/stories", () => ({ getUserActiveStories: jest.fn(async () => ({ stories: [] })) }));
jest.mock("../src/api/conversations", () => ({ openConversation: jest.fn() }));
jest.mock("../src/components/HighlightsRow", () => ({ HighlightsRow: () => null }));
jest.mock("../src/components/ReportSheet", () => ({ ReportSheet: () => null }));
jest.mock("@react-navigation/native", () => ({
  ...jest.requireActual("@react-navigation/native"),
  useNavigation: () => mockRootNavigation,
}));

const api = usersApi as jest.Mocked<typeof usersApi>;
const tabListeners: Array<() => void> = [];
const navigation = {
  navigate: jest.fn(),
  getParent: () => ({ addListener: jest.fn((_event: string, listener: () => void) => { tabListeners.push(listener); return () => undefined; }) }),
};
const relation = (over: Partial<usersApi.ListRelationship> = {}) => ({ isFollowing: false, isFollowedBy: false, hasPendingRequestFromViewer: false, ...over });
const result = (name: string, over: Partial<usersApi.SearchResult> = {}): usersApi.SearchResult => ({
  id: `id-${name}`, username: name, displayName: name.toUpperCase(), avatarMediaId: null, bio: "", isPrivate: false, interests: [], viewer: relation(), ...over,
});
const suggestion = (name: string, reason: usersApi.SuggestionReason, over: Partial<usersApi.SuggestedPerson> = {}): usersApi.SuggestedPerson => ({
  id: `id-${name}`, username: name, displayName: name.toUpperCase(), avatarMediaId: null, isPrivate: false, reason, viewer: relation(), ...over,
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

let tree: ReactTestRenderer;
beforeEach(() => {
  jest.useFakeTimers();
  api.getSuggestions.mockResolvedValue({ suggestions: [] });
});
afterEach(async () => {
  await act(async () => tree?.unmount());
  jest.useRealTimers();
  jest.clearAllMocks();
  tabListeners.length = 0;
});

const flush = async () => { for (let i = 0; i < 4; i++) await act(async () => { await Promise.resolve(); }); };
async function renderSearch(): Promise<void> {
  await act(async () => {
    tree = create(<SearchScreen navigation={navigation as never} route={{ key: "SearchHome", name: "SearchHome" } as never} />);
  });
  await flush();
}
async function typeQuery(text: string): Promise<void> {
  await act(async () => tree.root.findByType(TextInput).props.onChangeText(text));
  await act(async () => { jest.advanceTimersByTime(300); });
  await flush();
}
const texts = () => tree.root.findAllByType(Text).map((t) => [t.props.children].flat().join(""));
const pressable = (label: string) => tree.root.find((n: ReactTestInstance) => typeof n.props.onPress === "function" && n.props.accessibilityLabel === label);
const press = async (label: string) => { await act(async () => pressable(label).props.onPress()); await flush(); };
const list = () => tree.root.findByType(FlatList);

test("before typing: the box is focused and people are suggested with the reason, each followable in place", async () => {
  api.getSuggestions.mockResolvedValue({ suggestions: [
    suggestion("fan", { kind: "follows_you" }, { viewer: relation({ isFollowedBy: true }) }),
    suggestion("pal", { kind: "followed_by", username: "alice", others: 2 }, { isPrivate: true }),
    suggestion("kin", { kind: "shared_interest", interest: "Chess" }),
    suggestion("nova", { kind: "new" }),
  ] });
  await renderSearch();
  expect(tree.root.findByType(TextInput).props.autoFocus).toBe(true);
  expect(texts()).toEqual(expect.arrayContaining(["Suggested for you", "Follows you", "Followed by @alice + 2 more", "Also into Chess", "New to Katkee"]));
  expect(api.searchUsers).not.toHaveBeenCalled();

  api.followUser.mockResolvedValueOnce({ status: "requested" });
  await press("Follow @pal");
  expect(api.followUser).toHaveBeenCalledWith("pal", "token");
  expect(pressable("Requested @pal")).toBeTruthy();
  await press("Requested @pal");
  expect(api.unfollowUser).toHaveBeenCalledWith("pal", "token");
  expect(pressable("Follow @pal")).toBeTruthy();

  api.followUser.mockResolvedValueOnce({ status: "following" });
  await press("Follow back @fan");
  expect(pressable("Following @fan")).toBeTruthy();

  // Re-selecting the Search tab puts the cursor back in the box.
  const focus = jest.fn();
  tree.root.findByType(TextInput).instance.focus = focus;
  act(() => tabListeners.forEach((listener) => listener()));
  expect(focus).toHaveBeenCalled();
});

test("a newer query cancels the older request, whose late answer never shows", async () => {
  await renderSearch();
  const first = deferred<{ results: usersApi.SearchResult[]; limit: number; offset: number }>();
  api.searchUsers.mockReturnValueOnce(first.promise).mockResolvedValueOnce({ results: [result("bob")], limit: SEARCH_PAGE_SIZE, offset: 0 });
  await typeQuery("al");
  const firstSignal = api.searchUsers.mock.calls[0]![2]!.signal!;
  expect(firstSignal.aborted).toBe(false);
  await typeQuery("alice");
  expect(firstSignal.aborted).toBe(true);
  expect(api.searchUsers).toHaveBeenLastCalledWith("alice", "token", expect.objectContaining({ following: false, limit: SEARCH_PAGE_SIZE }));
  await act(async () => first.resolve({ results: [result("carol")], limit: SEARCH_PAGE_SIZE, offset: 0 }));
  await flush();
  expect(list().props.data.map((p: usersApi.SearchResult) => p.username)).toEqual(["bob"]);
  expect(track).toHaveBeenCalledTimes(2);
});

test("leaving Search cancels a search still in flight", async () => {
  await renderSearch();
  api.searchUsers.mockReturnValueOnce(deferred<{ results: usersApi.SearchResult[]; limit: number; offset: number }>().promise);
  await typeQuery("slow");
  const signal = api.searchUsers.mock.calls[0]![2]!.signal!;
  expect(signal.aborted).toBe(false);
  await act(async () => tree.unmount());
  expect(signal.aborted).toBe(true);
});

test("results follow in place, load more at the end of the list, and the Following filter asks the server", async () => {
  await renderSearch();
  const firstPage = Array.from({ length: SEARCH_PAGE_SIZE }, (_, i) => result(`p${i}`, i === 0 ? { viewer: relation({ isFollowing: true }) } : {}));
  api.searchUsers
    .mockResolvedValueOnce({ results: firstPage, limit: SEARCH_PAGE_SIZE, offset: 0 })
    .mockResolvedValueOnce({ results: [result("p20"), result("p21")], limit: SEARCH_PAGE_SIZE, offset: SEARCH_PAGE_SIZE });
  await typeQuery("p");
  expect(pressable("Following @p0")).toBeTruthy();
  await act(async () => list().props.onEndReached());
  await flush();
  expect(api.searchUsers).toHaveBeenLastCalledWith("p", "token", expect.objectContaining({ offset: SEARCH_PAGE_SIZE }));
  expect(list().props.data).toHaveLength(SEARCH_PAGE_SIZE + 2);
  await act(async () => list().props.onEndReached());
  await flush();
  expect(api.searchUsers).toHaveBeenCalledTimes(2);

  api.searchUsers.mockResolvedValueOnce({ results: [result("p0", { viewer: relation({ isFollowing: true }) })], limit: SEARCH_PAGE_SIZE, offset: 0 });
  await act(async () => tree.root.find((n: ReactTestInstance) => typeof n.props.onPress === "function" && n.props.accessibilityState?.selected === false).props.onPress());
  await flush();
  expect(api.searchUsers).toHaveBeenLastCalledWith("p", "token", expect.objectContaining({ following: true }));
  expect(list().props.data.map((p: usersApi.SearchResult) => p.username)).toEqual(["p0"]);
});

test("a follow that fails says why and leaves the button as it was", async () => {
  await renderSearch();
  api.searchUsers.mockResolvedValueOnce({ results: [result("zed")], limit: SEARCH_PAGE_SIZE, offset: 0 });
  await typeQuery("zed");
  api.followUser.mockRejectedValueOnce(new ApiError(429, "You're following people too quickly. Try again later."));
  await press("Follow @zed");
  expect(texts()).toContain("You're following people too quickly. Try again later.");
  expect(pressable("Follow @zed")).toBeTruthy();
});

test("no suggestions, or none loading, invites a search instead of spinning", async () => {
  api.getSuggestions.mockRejectedValueOnce(new Error("offline"));
  await renderSearch();
  expect(texts()).toEqual(expect.arrayContaining(["Find people", "Search by name, username or interest."]));
});

describe("profile links", () => {
  const profile = (over: Partial<usersApi.ProfileView> = {}): usersApi.ProfileView => ({
    id: "11111111-2222-4333-8444-555555555555", username: "alice_new", displayName: "Alice", bio: "", avatarMediaId: null, interests: [],
    isPrivate: false, isSelf: false, followerCount: 1, followingCount: 2,
    viewer: { isFollowing: false, isFollowedBy: false, hasPendingRequestFromViewer: false, hasPendingRequestFromTarget: false, isMutedByViewer: false },
    ...over,
  });
  const renderProfile = async (params: { username: string; userId?: string }) => {
    await act(async () => {
      tree = create(<UserProfileScreen navigation={navigation as never} route={{ key: "UserProfile", name: "UserProfile", params } as never} />);
    });
    await flush();
  };
  const followButton = () => tree.root.find((n: ReactTestInstance) => typeof n.props.onPress === "function" && n.findAllByType(Text).some((t) => t.props.children === "Follow"));

  test("a link with the account ID opens that account after a rename, and acts on its current name", async () => {
    api.getProfile.mockResolvedValue({ profile: profile() });
    api.followUser.mockResolvedValueOnce({ status: "following" });
    await renderProfile({ username: "alice_old", userId: "11111111-2222-4333-8444-555555555555" });
    expect(api.getProfile).toHaveBeenCalledWith("11111111-2222-4333-8444-555555555555", "token");
    expect(texts()).toContain("@alice_new");
    await act(async () => followButton().props.onPress());
    await flush();
    expect(api.followUser).toHaveBeenCalledWith("alice_new", "token");
  });

  test("a link with only a name still opens by name", async () => {
    api.getProfile.mockResolvedValue({ profile: profile({ username: "bob" }) });
    await renderProfile({ username: "bob" });
    expect(api.getProfile).toHaveBeenCalledWith("bob", "token");
  });
});
