import React from "react";
import { Text, TextInput } from "react-native";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { CarouselScreen } from "../src/screens/create/CarouselScreen";
import * as queue from "../src/state/uploadQueue";

// Several photos shared at once, each its own Story, with one filter, song and caption.
const mockReset = jest.fn();
jest.mock("@react-navigation/native", () => ({ ...jest.requireActual("@react-navigation/native"), useNavigation: () => ({ reset: mockReset }) }));
jest.mock("../src/state/AuthContext", () => ({ useAuth: () => ({ accessToken: "token", user: { id: "u-me", username: "me" } }) }));
jest.mock("../src/state/uploadQueue", () => ({ enqueueUpload: jest.fn(async () => ({})) }));
jest.mock("../src/utils/filterPhoto", () => ({ filteredPhotoUri: jest.fn(async (uri: string) => `${uri}#filtered`) }));
jest.mock("../src/components/MusicSheet", () => ({ MusicSheet: () => null }));
jest.mock("../src/components/StorySettingsSheet", () => ({
  DEFAULT_STORY_SETTINGS: { visibility: "public", allowComments: "everyone", allowSharing: true },
  loadStorySettings: jest.fn(async () => ({ visibility: "followers", allowComments: "followers", allowSharing: false })),
}));

let tree: ReactTestRenderer;
const goBack = jest.fn();
const photo = (n: number) => ({ uri: `file:///p${n}.jpg`, mimeType: "image/jpeg", width: 1080, height: 1920 });
const texts = () => tree.root.findAllByType(Text).map((t) => [t.props.children].flat().join(""));
const button = (label: RegExp) => tree.root.find((n: ReactTestInstance) => typeof n.props.onPress === "function" && typeof n.props.accessibilityLabel === "string" && label.test(n.props.accessibilityLabel));
const settle = async () => { for (let i = 0; i < 4; i++) await act(async () => { await Promise.resolve(); }); };

beforeEach(async () => {
  jest.clearAllMocks();
  await act(async () => {
    tree = create(
      <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}>
        <CarouselScreen navigation={{ goBack } as never} route={{ key: "c", name: "Carousel", params: { photos: [photo(1), photo(2), photo(3)] } } as never} />
      </SafeAreaProvider>,
    );
  });
  await settle();
});
afterEach(async () => { await act(async () => tree.unmount()); });

test("shares each photo as its own Story, in order, with one filter and the caption on the first", async () => {
  expect(texts()).toContain("1/3");
  await act(async () => button(/^Retro$/).props.onPress());
  await act(async () => button(/^Remove photo 2$/).props.onPress());
  await act(async () => tree.root.findByType(TextInput).props.onChangeText("  Goa trip  "));
  await act(async () => button(/^Share all 2 to Your story$/).props.onPress());
  await settle();

  const calls = (queue.enqueueUpload as jest.Mock).mock.calls;
  expect(calls.map((c) => c[1])).toEqual(["file:///p1.jpg", "file:///p3.jpg"]);
  // Who sees it and who may comment come from the remembered Story settings.
  expect(calls[0][4]).toEqual(expect.objectContaining({ caption: "Goa trip", audience: "followers", filter: "retro", allowComments: "followers", allowSharing: false, overlays: [] }));
  expect(calls[1][4]).toEqual(expect.objectContaining({ caption: "", filter: "retro" }));
  expect(mockReset).toHaveBeenCalledWith({ index: 0, routes: [{ name: "Main" }] });
});

test("Close Friends shares all of them to Close Friends", async () => {
  await act(async () => button(/^Share all 3 to Close Friends$/).props.onPress());
  await settle();
  expect((queue.enqueueUpload as jest.Mock).mock.calls.map((c) => c[4].audience)).toEqual(["close_friends", "close_friends", "close_friends"]);
});

test("removing every photo leaves the screen", async () => {
  for (let i = 0; i < 3; i++) await act(async () => button(/^Remove photo 1$/).props.onPress());
  await settle();
  expect(goBack).toHaveBeenCalled();
});
