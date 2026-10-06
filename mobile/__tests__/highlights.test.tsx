import React from "react";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { StyleSheet, useWindowDimensions } from "react-native";
import { HighlightsRow } from "../src/components/HighlightsRow";

const mockNavigate = jest.fn();
jest.mock("../src/state/AuthContext", () => ({ useAuth: () => ({ accessToken: "token" }) }));
jest.mock("@react-navigation/native", () => ({
  ...jest.requireActual("@react-navigation/native"),
  useNavigation: () => ({ navigate: mockNavigate }),
  useFocusEffect: (effect: () => void) => require("react").useEffect(() => effect(), [effect]),
}));
jest.mock("../src/api/highlights", () => ({
  listHighlightsForUser: jest.fn(async () => ({
    highlights: ["Travel", "Food", "Friends", "Diwali"].map((title, i) => ({ id: `h${i}`, title, coverMediaId: `m${i}`, itemCount: 3 })),
  })),
  reorderHighlights: jest.fn(async () => undefined),
}));
jest.mock("../src/api/stories", () => ({ mediaFileUrl: (id: string) => `https://api.test/media/${id}` }));

let tree: ReactTestRenderer;
afterEach(async () => {
  await act(async () => tree?.unmount());
  mockNavigate.mockClear();
});

async function render(isOwner: boolean): Promise<void> {
  if (tree) await act(async () => tree.unmount());
  await act(async () => {
    tree = create(<HighlightsRow username="alice" isOwner={isOwner} />);
  });
  await act(async () => { await Promise.resolve(); });
}
const buttons = () =>
  tree.root.findAll((n) => typeof n.type === "string" && n.props.accessibilityRole === "button").map((n) => n.props.accessibilityLabel as string);
function Width(): React.JSX.Element {
  widthSeen = useWindowDimensions().width;
  return <></>;
}
let widthSeen = 0;

test("Highlights are permanent portrait cards, exactly three per row", async () => {
  let probe!: ReactTestRenderer;
  await act(async () => { probe = create(<Width />); });
  await act(async () => probe.unmount());
  await render(false);
  expect(buttons()).toEqual(["Travel, Highlight", "Food, Highlight", "Friends, Highlight", "Diwali, Highlight"]);
  const cards = buttons().map((label) => {
    const card = tree.root.find((n: ReactTestInstance) => typeof n.type === "string" && n.props.accessibilityLabel === label);
    // The positioned slot is the card's animated parent.
    let slot: ReactTestInstance | null = card.parent;
    while (slot && !(typeof slot.type === "string" && StyleSheet.flatten(slot.props.style)?.position === "absolute")) slot = slot.parent;
    return StyleSheet.flatten(slot!.props.style);
  });
  const width = (widthSeen - 24 * 2 - 8 * 2) / 3;
  for (const c of cards) {
    expect(c.width).toBeCloseTo(width, 5);
    expect(c.height).toBeCloseTo(width * 1.35, 5); // portrait, not circles
  }
  expect(cards.map((c) => [Math.round(c.left), Math.round(c.top)])).toEqual([
    [0, 0], [Math.round(width + 8), 0], [Math.round(2 * (width + 8)), 0],
    [0, Math.round(width * 1.35 + 8)],
  ]);
});

test("only the owner sees New and Reorder; tapping a card opens the Highlight", async () => {
  await render(true);
  expect(buttons().slice(0, 2)).toEqual(["Reorder Highlights", "New Highlight"]);
  await render(false);
  expect(buttons()).not.toContain("New Highlight");
  expect(buttons()).not.toContain("Reorder Highlights");
  await act(async () => tree.root.find((n) => typeof n.props.onPress === "function" && n.props.accessibilityLabel === "Food, Highlight").props.onPress());
  expect(mockNavigate).toHaveBeenCalledWith("HighlightViewer", { highlightId: "h1", title: "Food" });
});
