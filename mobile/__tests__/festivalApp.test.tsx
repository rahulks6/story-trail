import React from "react";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { deepLinkTarget } from "../src/navigation/profileLinks";
import { StickerSheet } from "../src/components/StickerSheet";
import { StreakBadge } from "../src/components/profile/StreakBadge";
import { Text } from "react-native";

jest.mock("../src/state/AuthContext", () => ({ useAuth: () => ({ accessToken: "token" }) }));

test("festival, streak and reminder notifications open Home", () => {
  expect(deepLinkTarget("home")).toEqual({ kind: "home" });
  expect(deepLinkTarget("/home/")).toEqual({ kind: "home" });
  expect(deepLinkTarget("homes")).toBeNull();
});

test("on a festival day the sticker sheet leads with its greeting and emoji", async () => {
  const onAdd = jest.fn();
  let tree!: ReactTestRenderer;
  const sheet = (festival: { name: string; emoji: string; greeting: string } | null) => (
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}>
      <StickerSheet visible onClose={jest.fn()} onAdd={onAdd} festival={festival} />
    </SafeAreaProvider>
  );
  await act(async () => { tree = create(sheet({ name: "Diwali", emoji: "🪔", greeting: "Happy Diwali" })); });
  const press = (label: string) => tree.root.find((n: ReactTestInstance) => typeof n.props.onPress === "function" && n.props.accessibilityLabel === label).props.onPress();
  await act(async () => press("Add Happy Diwali"));
  expect(onAdd).toHaveBeenCalledWith({ type: "text", properties: expect.objectContaining({ text: "🪔 Happy Diwali", align: "center" }) });
  await act(async () => press("Add Diwali emoji"));
  expect(onAdd).toHaveBeenLastCalledWith({ type: "emoji", properties: expect.objectContaining({ emoji: "🪔" }) });

  await act(async () => tree.update(sheet(null)));
  expect(tree.root.findAll((n: ReactTestInstance) => n.props.accessibilityLabel === "Add Happy Diwali")).toHaveLength(0);
  await act(async () => tree.unmount());
});

test("the streak badge: yours reminds you to post today; others just see the count; nothing without one", async () => {
  let tree!: ReactTestRenderer;
  const texts = () => tree.root.findAllByType(Text).map((t) => [t.props.children].flat().join(""));
  await act(async () => { tree = create(<StreakBadge streak={{ days: 5, postedToday: false }} own />); });
  expect(texts()).toEqual(["🔥 5-day streak", "Post today to keep it"]);
  await act(async () => tree.update(<StreakBadge streak={{ days: 5, postedToday: false }} own={false} />));
  expect(texts()).toEqual(["🔥 5-day streak"]);
  await act(async () => tree.update(<StreakBadge streak={null} own={false} />));
  expect(tree.toJSON()).toBeNull();
  await act(async () => tree.update(<StreakBadge streak={{ days: 0, postedToday: false }} own />));
  expect(tree.toJSON()).toBeNull();
});
