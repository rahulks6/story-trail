import React from "react";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { Text } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { UserProfileScreen } from "../src/screens/profile/UserProfileScreen";
import { SearchScreen } from "../src/screens/search/SearchScreen";
import { CommentsSheet } from "../src/components/CommentsSheet";
import { VerifiedName } from "../src/components/VerifiedBadge";
import * as usersApi from "../src/api/users";
import * as engagement from "../src/api/engagement";

// The verified badge after a name: on profiles (where it explains itself), in search and in
// comments; never for an account without it.
const mockAuth = { accessToken: "token", user: { id: "u-me", username: "me_now", displayName: "Me Now", avatarMediaId: null } };
const mockRootNavigation = { navigate: jest.fn() };
jest.mock("../src/state/AuthContext", () => ({ useAuth: () => mockAuth }));
jest.mock("../src/analytics/analytics", () => ({ track: jest.fn() }));
jest.mock("../src/api/users", () => ({
  ...jest.requireActual("../src/api/users"),
  getProfile: jest.fn(),
  getSuggestions: jest.fn(),
  searchUsers: jest.fn(),
  listFollowRequests: jest.fn(async () => ({ requests: [], limit: 50, offset: 0 })),
}));
jest.mock("../src/api/stories", () => ({ getUserActiveStories: jest.fn(async () => ({ stories: [] })) }));
jest.mock("../src/api/conversations", () => ({ openConversation: jest.fn() }));
jest.mock("../src/components/HighlightsRow", () => ({ HighlightsRow: () => null }));
jest.mock("../src/components/ReportSheet", () => ({ ReportSheet: () => null }));
jest.mock("@react-navigation/native", () => ({
  ...jest.requireActual("@react-navigation/native"),
  useNavigation: () => mockRootNavigation,
  useFocusEffect: (effect: () => void) => require("react").useEffect(() => effect(), [effect]),
}));

const api = usersApi as jest.Mocked<typeof usersApi>;
const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
const navigation = { navigate: jest.fn(), setOptions: jest.fn(), goBack: jest.fn(), canGoBack: jest.fn(() => true), getParent: () => ({ addListener: jest.fn(() => () => undefined) }) };
const profile = (over: Partial<usersApi.ProfileView> = {}): usersApi.ProfileView => ({
  id: "11111111-2222-4333-8444-555555555555", username: "asha_k", displayName: "Asha K", bio: "Street food in Pune.", avatarMediaId: null,
  interests: [], isPrivate: false, isSelf: false, followerCount: 10, followingCount: 5, storyCount: 2,
  viewer: { isFollowing: false, isFollowedBy: false, hasPendingRequestFromViewer: false, hasPendingRequestFromTarget: false, isMutedByViewer: false },
  ...over,
});
const relation = { isFollowing: false, isFollowedBy: false, hasPendingRequestFromViewer: false };

let tree: ReactTestRenderer;
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
const texts = () => tree.root.findAllByType(Text).map((t) => [t.props.children].flat().join(""));
/** Host elements screen readers announce as "Verified" (the badge itself). */
const badges = () => tree.root.findAll((n: ReactTestInstance) => typeof n.type === "string" && n.props.accessibilityLabel === "Verified");
const press = async (label: string) => {
  const target = tree.root.find((n: ReactTestInstance) => typeof n.props.onPress === "function" && n.props.accessibilityLabel === label);
  await act(async () => target.props.onPress());
  await flush();
};
const renderProfile = () => render(<UserProfileScreen navigation={navigation as never} route={{ key: "UserProfile", name: "UserProfile", params: { username: "asha_k" } } as never} />);

test("the name stays on one line, with the badge outside it and sized to the text", async () => {
  await render(<VerifiedName name="A very long display name indeed" verified style={{ fontSize: 20 }} />);
  const name = tree.root.findByType(Text);
  expect(name.props.numberOfLines).toBe(1);
  expect(badges()).toHaveLength(1);
  // The badge is a sibling of the name, not inside it.
  expect(name.findAll((n: ReactTestInstance) => n.props.accessibilityLabel === "Verified")).toHaveLength(0);
  expect(tree.root.findByProps({ viewBox: "0 0 24 24" }).props.width).toBe(21);
});

test("a verified profile shows the badge after the name; tapping it says what it means", async () => {
  api.getProfile.mockResolvedValue({ profile: profile({ verified: true, verifiedCategory: "public_figure" }) });
  await renderProfile();
  expect(badges()).toHaveLength(1);
  await press("Verified");
  expect(texts()).toEqual(expect.arrayContaining(["Verified", "Katkee confirmed this account belongs to the public figure it represents."]));
  expect(texts()).toContain("Done");
});

test("an account without the badge (or an older server) shows none", async () => {
  api.getProfile.mockResolvedValue({ profile: profile() });
  await renderProfile();
  expect(texts()).toContain("Asha K");
  expect(badges()).toHaveLength(0);
  api.getProfile.mockResolvedValue({ profile: profile({ verified: false, verifiedCategory: null }) });
  await act(async () => tree.unmount());
  await renderProfile();
  expect(badges()).toHaveLength(0);
});

test("search suggestions and results carry the badge only for verified people", async () => {
  jest.useFakeTimers();
  try {
    api.getSuggestions.mockResolvedValue({ suggestions: [
      { id: "1", username: "news_desk", displayName: "News Desk", avatarMediaId: null, isPrivate: false, verified: true, reason: { kind: "new" }, viewer: relation },
      { id: "2", username: "pal", displayName: "Pal", avatarMediaId: null, isPrivate: false, reason: { kind: "new" }, viewer: relation },
    ] });
    await render(<SearchScreen navigation={navigation as never} route={{ key: "SearchHome", name: "SearchHome" } as never} />);
    expect(badges()).toHaveLength(1);
    expect(tree.root.findAll((n: ReactTestInstance) => n.props.accessibilityLabel === "News Desk, verified, @news_desk").length).toBeGreaterThan(0);
    expect(tree.root.findAll((n: ReactTestInstance) => n.props.accessibilityLabel === "Pal, @pal").length).toBeGreaterThan(0);

    api.searchUsers.mockResolvedValue({ results: [
      { id: "3", username: "brand_co", displayName: "Brand Co", bio: "", verified: true, viewer: relation },
      { id: "4", username: "brandy", displayName: "Brandy", bio: "", verified: false, viewer: relation },
      { id: "5", username: "brandon", displayName: "Brandon", bio: "" },
    ], limit: 20, offset: 0 });
    const { TextInput } = require("react-native");
    await act(async () => tree.root.findByType(TextInput).props.onChangeText("brand"));
    await act(async () => { jest.advanceTimersByTime(300); });
    await flush();
    expect(texts()).toEqual(expect.arrayContaining(["Brand Co", "Brandy", "Brandon"]));
    expect(badges()).toHaveLength(1);
  } finally {
    jest.useRealTimers();
  }
});

test("a verified commenter's name has the badge", async () => {
  const comment = (id: string, username: string, verified?: boolean) => ({ id, storyId: "s1", userId: `u-${username}`, username, displayName: username, avatarMediaId: null, body: "Nice!", createdAt: new Date().toISOString(), ...(verified === undefined ? {} : { verified }) });
  jest.spyOn(engagement, "listComments").mockResolvedValue({ comments: [comment("c1", "asha", true), comment("c2", "dev", false), comment("c3", "old")], limit: 50, offset: 0 });
  await render(<CommentsSheet visible storyId="s1" storyOwnerId="owner" commentsDisabled={false} onClose={jest.fn()} onCommentCountChange={jest.fn()} />);
  expect(texts()).toEqual(expect.arrayContaining(["asha", "dev", "old"]));
  expect(badges()).toHaveLength(1);
  expect(tree.root.findAll((n: ReactTestInstance) => typeof n.type === "string" && /^@asha, verified: Nice!/.test(n.props.accessibilityLabel ?? ""))).toHaveLength(1);
});
