import React from "react";
import { Modal, Text } from "react-native";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { StoryMoreMenu } from "../src/components/StoryMoreMenu";
import { YourInterestsScreen } from "../src/screens/profile/YourInterestsScreen";
import * as eventsApi from "../src/api/events";
import * as interestsApi from "../src/api/interests";
import * as toast from "../src/components/Toast";

// Home ordered by interests, in the app: "Show more like this" on someone else's public Story,
// and Settings > Your interests.
jest.mock("../src/state/AuthContext", () => ({ useAuth: () => ({ accessToken: "token" }) }));
jest.mock("../src/components/ReportSheet", () => ({ ReportSheet: () => null }));
jest.mock("@react-navigation/native", () => ({
  ...jest.requireActual("@react-navigation/native"),
  useFocusEffect: (effect: () => void) => require("react").useEffect(() => effect(), [effect]),
}));
jest.mock("../src/api/events", () => ({ recordEvent: jest.fn(async () => undefined) }));
jest.mock("../src/api/interests", () => ({ getMyInterests: jest.fn(), removeLearnedInterest: jest.fn(async () => undefined) }));

let tree: ReactTestRenderer;
const flush = async () => { for (let i = 0; i < 5; i++) await act(async () => { await Promise.resolve(); }); };
const texts = () => tree.root.findAllByType(Text).map((t) => [t.props.children].flat().join(""));
const labelled = (label: string) => tree.root.findAll((n: ReactTestInstance) => typeof n.props.onPress === "function" && n.props.accessibilityLabel === label);
/** Presses the nearest pressable around the text. */
async function pressText(text: string) {
  let node: ReactTestInstance | null = tree.root.findAllByType(Text).find((t) => [t.props.children].flat().join("") === text)!;
  while (node && typeof node.props.onPress !== "function") node = node.parent;
  await act(async () => node!.props.onPress());
}
afterEach(async () => { await act(async () => tree?.unmount()); jest.clearAllMocks(); });

describe("Show more like this", () => {
  const menu = (props: Partial<React.ComponentProps<typeof StoryMoreMenu>>) => (
    <StoryMoreMenu visible storyId="s-1" isOwnStory={false} isPublic otherUsername="asha" otherUserId="u-2" onClose={jest.fn()} onDeleted={jest.fn()} {...props} />
  );

  it("is next to Not interested on someone else's public Story, records the event and confirms with a toast", async () => {
    const shown = jest.spyOn(toast, "showToast");
    await act(async () => { tree = create(menu({})); });
    expect(labelled("Show more like this")).toHaveLength(1);
    expect(labelled("Not interested")).toHaveLength(1);
    await act(async () => labelled("Show more like this")[0]!.props.onPress());
    // The sheet runs the choice once it has closed.
    await act(async () => tree.root.findByType(Modal).props.onDismiss?.());
    await flush();
    expect(eventsApi.recordEvent).toHaveBeenCalledWith({ eventType: "more_like_this", storyId: "s-1", creatorId: "u-2" }, "token");
    expect(shown).toHaveBeenCalledWith("You'll see more Stories like this");
  });

  it("isn't offered on a followers-only or Close Friends Story, or on your own", async () => {
    await act(async () => { tree = create(menu({ isPublic: false })); });
    expect(labelled("Show more like this")).toHaveLength(0);
    expect(labelled("Not interested")).toHaveLength(1);
    await act(async () => tree.update(menu({ isOwnStory: true, otherUserId: null, otherUsername: null })));
    expect(labelled("Show more like this")).toHaveLength(0);
  });
});

describe("Your interests", () => {
  const api = interestsApi as jest.Mocked<typeof interestsApi>;
  const navigation = { navigate: jest.fn() };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const screen = () => <YourInterestsScreen navigation={navigation as any} route={{ key: "y", name: "YourInterests" } as any} />;

  it("shows what Katkee learned (as strong or some, never a number) and what you chose", async () => {
    api.getMyInterests.mockResolvedValueOnce({ chosen: ["Books", "Travel"], learned: [{ topic: "Cricket", strength: "high" }, { topic: "Food", strength: "medium" }] });
    await act(async () => { tree = create(screen()); });
    await flush();
    const shown = texts();
    expect(shown).toEqual(expect.arrayContaining(["What Katkee thinks you like", "Cricket", "Strong", "Food", "Some", "Interests you chose", "Books", "Travel"]));
    expect(shown.some((t) => /\d/.test(t) && !/30 days/.test(t))).toBe(false);
    await pressText("Edit in Edit profile");
    expect(navigation.navigate).toHaveBeenCalledWith("EditProfile");
  });

  it("removes a learned topic with its x", async () => {
    const shown = jest.spyOn(toast, "showToast");
    api.getMyInterests.mockResolvedValueOnce({ chosen: [], learned: [{ topic: "Cricket", strength: "high" }] });
    await act(async () => { tree = create(screen()); });
    await flush();
    await act(async () => labelled("Remove Cricket")[0]!.props.onPress());
    await flush();
    expect(api.removeLearnedInterest).toHaveBeenCalledWith("Cricket", "token");
    expect(texts()).not.toContain("Cricket");
    expect(texts()).toContain("Nothing yet. Topics you enjoy will show up here as you watch Stories.");
    expect(shown).toHaveBeenCalledWith("Removed Cricket");
  });

  it("offers Try again when it can't load", async () => {
    api.getMyInterests.mockRejectedValueOnce(new TypeError("Network request failed")).mockResolvedValueOnce({ chosen: [], learned: [] });
    await act(async () => { tree = create(screen()); });
    await flush();
    expect(texts()).toContain("Couldn't load your interests. Check your connection and try again.");
    await pressText("Try again");
    await flush();
    expect(texts()).toContain("You haven't chosen any interests.");
  });
});
