import React from "react";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { Alert, Dimensions, Modal, StyleSheet, useWindowDimensions } from "react-native";
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
  deleteHighlight: jest.fn(async () => undefined),
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
const original = Dimensions.get("window");
const setWindowWidth = (width: number) => Dimensions.set({ window: { ...original, width }, screen: { ...original, width } });
afterEach(() => setWindowWidth(original.width));
function cardBoxes() {
  return buttons().filter((l) => l.endsWith(", Highlight")).map((label) => {
    const card = tree.root.find((n: ReactTestInstance) => typeof n.type === "string" && n.props.accessibilityLabel === label);
    let slot: ReactTestInstance | null = card.parent;
    while (slot && !(typeof slot.type === "string" && StyleSheet.flatten(slot.props.style)?.position === "absolute")) slot = slot.parent;
    return StyleSheet.flatten(slot!.props.style);
  });
}

test("on a tablet more Highlights fit in a row instead of each growing", async () => {
  setWindowWidth(1280);
  await render(false);
  const cards = cardBoxes();
  expect(cards.every((c) => c.width <= 150)).toBe(true);
  expect(new Set(cards.map((c) => Math.round(c.top))).size).toBe(1); // all four in one row
});

test("Highlights are permanent portrait cards, exactly three per row on a phone", async () => {
  setWindowWidth(390);
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
    expect(c.height).toBeCloseTo(width * 1.35 + 22, 5); // a portrait cover (not a circle), its name underneath
  }
  expect(cards.map((c) => [Math.round(c.left), Math.round(c.top)])).toEqual([
    [0, 0], [Math.round(width + 8), 0], [Math.round(2 * (width + 8)), 0],
    [0, Math.round(width * 1.35 + 22 + 8)],
  ]);
  // The name is below the photo in the screen's own text colour, so it reads in light and dark mode.
  const name = tree.root.find((n: ReactTestInstance) => (n.type as unknown) === "Text" && n.props.children === "Travel");
  expect(StyleSheet.flatten(name.props.style)).toMatchObject({ textAlign: "center" });
  expect(StyleSheet.flatten(name.props.style).backgroundColor).toBeUndefined();
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

test("reports how many Highlights there are, or that they can't be shown, and reloads on refresh", async () => {
  const api = jest.requireMock("../src/api/highlights") as { listHighlightsForUser: jest.Mock };
  const counts: Array<number | null> = [];
  await act(async () => {
    tree = create(<HighlightsRow username="alice" isOwner={false} onCountChange={(n) => counts.push(n)} refreshToken={0} />);
  });
  await act(async () => { await Promise.resolve(); });
  expect(counts).toEqual([4]);
  // A private account you don't follow refuses the list: the count is unknown, not zero.
  api.listHighlightsForUser.mockRejectedValueOnce(new Error("forbidden"));
  await act(async () => tree.update(<HighlightsRow username="alice" isOwner={false} onCountChange={(n) => counts.push(n)} refreshToken={1} />));
  await act(async () => { await Promise.resolve(); });
  expect(counts).toEqual([4, null]);
});

test("pressing and holding your Highlight offers Edit and Delete; Delete asks first, then removes it", async () => {
  const { deleteHighlight } = jest.requireMock("../src/api/highlights") as { deleteHighlight: jest.Mock };
  const alert = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
  await render(true);
  const card = () => tree.root.find((n: ReactTestInstance) => typeof n.props.onLongPress === "function" && n.props.accessibilityLabel === "Food, Highlight");
  await act(async () => card().props.onLongPress());
  // iOS runs the chosen action once the sheet has finished closing.
  const choose = async (label: string) => {
    await act(async () => tree.root.find((n: ReactTestInstance) => typeof n.props.onPress === "function" && n.props.accessibilityLabel === label).props.onPress());
    await act(async () => tree.root.findAllByType(Modal).find((m) => typeof m.props.onDismiss === "function")!.props.onDismiss());
  };
  await choose("Edit Highlight");
  expect(mockNavigate).toHaveBeenCalledWith("HighlightEditor", { highlightId: "h1" });

  await act(async () => card().props.onLongPress());
  await choose("Delete Highlight");
  expect(deleteHighlight).not.toHaveBeenCalled();
  const buttonsOfAlert = alert.mock.calls[0]![2] as Array<{ text: string; onPress?: () => void }>;
  await act(async () => buttonsOfAlert.find((b) => b.text === "Delete")!.onPress!());
  expect(deleteHighlight).toHaveBeenCalledWith("h1", "token");
  expect(buttons()).not.toContain("Food, Highlight");
  alert.mockRestore();
});

test("other people's Highlights can't be held for options", async () => {
  await render(false);
  expect(tree.root.findAll((n: ReactTestInstance) => typeof n.props.onLongPress === "function")).toHaveLength(0);
});
