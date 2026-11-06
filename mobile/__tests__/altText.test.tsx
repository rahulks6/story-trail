import React from "react";
import { TextInput } from "react-native";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { StoryEditorScreen } from "../src/screens/create/StoryEditorScreen";
import * as uploadQueue from "../src/state/uploadQueue";

jest.mock("../src/state/AuthContext", () => ({ useAuth: () => ({ accessToken: "token", user: { id: "me", username: "rahul" } }) }));
jest.mock("@react-navigation/native", () => ({ ...jest.requireActual("@react-navigation/native"), useNavigation: () => ({ reset: jest.fn(), navigate: jest.fn() }), useFocusEffect: (effect: () => () => void) => require("react").useEffect(effect, []), useIsFocused: () => true }));
jest.mock("../src/analytics/analytics", () => ({ track: jest.fn() }));

let tree: ReactTestRenderer;
const flush = async () => { for (let i = 0; i < 6; i++) await act(async () => { await Promise.resolve(); }); };
const press = (label: string) => act(async () => tree.root.find((n: ReactTestInstance) => typeof n.props.onPress === "function" && n.props.accessibilityLabel === label).props.onPress());
afterEach(async () => { await act(async () => tree?.unmount()); jest.restoreAllMocks(); });

test("Story settings asks for no picture description: the server writes one", async () => {
  jest.spyOn(uploadQueue, "enqueueUpload").mockResolvedValue({} as never);
  await act(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tree = create(<StoryEditorScreen navigation={{ goBack: jest.fn(), replace: jest.fn(), reset: jest.fn() } as any} route={{ key: "e", name: "StoryEditor", params: { mediaUri: "file:///p.jpg", kind: "photo", mimeType: "image/jpeg", width: 1080, height: 1920 } } as any} />);
  });
  const media = tree.root.findAll((n: ReactTestInstance) => typeof n.type === "string" && typeof n.props.onLayout === "function")[0]!;
  await act(async () => media.props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 400, height: 800 } } }));
  await flush();
  await press("Story settings: Everyone · Comments on");
  expect(tree.root.findAll((n: ReactTestInstance) => n.type === TextInput && n.props.accessibilityLabel === "Picture description")).toHaveLength(0);
});

test("no description sends none", async () => {
  const enqueue = jest.spyOn(uploadQueue, "enqueueUpload").mockResolvedValue({} as never);
  await act(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tree = create(<StoryEditorScreen navigation={{ goBack: jest.fn(), replace: jest.fn(), reset: jest.fn() } as any} route={{ key: "e", name: "StoryEditor", params: { mediaUri: "file:///p.jpg", kind: "photo", mimeType: "image/jpeg", width: 1080, height: 1920 } } as any} />);
  });
  const media = tree.root.findAll((n: ReactTestInstance) => typeof n.type === "string" && typeof n.props.onLayout === "function")[0]!;
  await act(async () => media.props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 400, height: 800 } } }));
  await flush();
  await press("Share to Your story, everyone");
  expect(enqueue.mock.calls[0]![4]).not.toHaveProperty("altText");
});
