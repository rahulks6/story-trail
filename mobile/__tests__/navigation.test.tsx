import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { NavigationContainer } from "@react-navigation/native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { MainTabs } from "../src/navigation/MainTabs";

// Each tab's content is irrelevant here: the rule under test is the tab bar itself.
jest.mock("../src/screens/home/HomeScreen", () => ({ HomeScreen: () => null }));
jest.mock("../src/navigation/SearchStack", () => ({ SearchStack: () => null }));
jest.mock("../src/navigation/CreateStack", () => ({ CreateStack: () => null }));
jest.mock("../src/screens/activity/ActivityScreen", () => ({ ActivityScreen: () => null }));
jest.mock("../src/navigation/DMStack", () => ({ DMStack: () => null }));
jest.mock("../src/screens/profile/ProfileScreen", () => ({ ProfileScreen: () => null }));
jest.mock("../src/state/NotificationsContext", () => ({ useNotifications: () => ({ unreadCount: 3 }) }));
jest.mock("../src/state/DMContext", () => ({ useDM: () => ({ unreadCount: 120 }) }));

async function renderTabs(): Promise<ReactTestRenderer> {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(
      <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } }}>
        <NavigationContainer>
          <MainTabs />
        </NavigationContainer>
      </SafeAreaProvider>,
    );
  });
  return tree;
}

const tabs = (tree: ReactTestRenderer) =>
  tree.root.findAll((n) => typeof n.type === "string" && n.props.accessibilityRole === "tab").map((n) => n.props.accessibilityLabel as string);

let mounted: ReactTestRenderer | null = null;
afterEach(async () => {
  await act(async () => mounted?.unmount());
  mounted = null;
});

test("the tab bar is exactly Home | Search | Create | Activity | DM | Profile, with unread counts", async () => {
  const tree = (mounted = await renderTabs());
  expect(tabs(tree)).toEqual(["Home", "Search", "Create a Story", "Activity, 3 unread", "DM, 120 unread", "Profile"]);
  expect(JSON.stringify(tree.toJSON())).not.toMatch(/Discover|Reels|Admin|Ads Manager/);
});

test("screen readers get a tab list with the current tab selected, above the home indicator", async () => {
  const tree = (mounted = await renderTabs());
  const list = tree.root.find((n) => typeof n.type === "string" && n.props.accessibilityRole === "tablist");
  const selected = tree.root.findAll((n) => typeof n.type === "string" && n.props.accessibilityRole === "tab" && n.props.accessibilityState?.selected);
  expect(selected.map((n) => n.props.accessibilityLabel)).toEqual(["Home"]);
  const style = Object.assign({}, ...[list.props.style].flat(Infinity).filter(Boolean));
  expect(style.paddingBottom).toBe(34);
});
