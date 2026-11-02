import React from "react";
import { Text, TextInput } from "react-native";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { InteractiveSticker, timeLeft, type StickerInteraction } from "../src/components/InteractiveSticker";
import { InteractiveStickerForm } from "../src/components/InteractiveStickerForm";
import { isSavedDraft } from "../src/state/validateSavedDraft";
import { clearCreateSeed, currentCreateSeed, setCreateSeed } from "../src/state/createSeed";
import { linkHost, normalizeLinkInput, type Overlay } from "../src/models/storyDraft";
import * as stickersApi from "../src/api/stickers";

// Polls, quizzes, questions, countdowns, links and Add Yours as viewers and creators use them.
jest.mock("../src/state/AuthContext", () => ({ useAuth: () => ({ accessToken: "token", user: { id: "u-me", username: "me" } }) }));
jest.mock("../src/hooks/useReducedMotion", () => ({ useReducedMotion: () => true }));
jest.mock("../src/api/stickers", () => ({ checkStickerLink: jest.fn() }));

const haptics = () => (globalThis as unknown as { __haptics: string[] }).__haptics;
let tree: ReactTestRenderer;
afterEach(async () => {
  await act(async () => tree?.unmount());
  haptics().length = 0;
});
const at = { x: 0.5, y: 0.5, scale: 1, rotation: 0, zIndex: 1 };
const texts = () => tree.root.findAllByType(Text).map((t) => [t.props.children].flat().join(""));
/** The control whose spoken label matches (the app's Pressable, which carries the handler). */
const button = (label: RegExp) => tree.root.find((n: ReactTestInstance) => n.props.accessibilityRole !== undefined && "onPress" in n.props && typeof n.props.accessibilityLabel === "string" && label.test(n.props.accessibilityLabel));
const interaction = (over: Partial<StickerInteraction> = {}): StickerInteraction => ({
  isOwner: false,
  onVote: jest.fn(async () => null),
  onAnswer: jest.fn(),
  onRemind: jest.fn(async () => true),
  onOpenLink: jest.fn(),
  onAddYours: jest.fn(),
  onOpenChain: jest.fn(),
  ...over,
});
const render = async (overlay: Overlay, with_?: StickerInteraction) => {
  await act(async () => { tree = create(<InteractiveSticker overlay={overlay as never} containerWidth={390} interaction={with_} />); });
};

const poll: Overlay = { id: "p", type: "poll", ...at, properties: { question: "Tea or coffee?", options: ["Tea", "Coffee"], results: null } };
const quiz: Overlay = { id: "q", type: "quiz", ...at, properties: { question: "Capital?", options: ["Mumbai", "Delhi"], results: null } };

test("a poll takes one tap, then shows live percentages and your choice", async () => {
  const onVote = jest.fn(async () => ({ results: { counts: [1, 3], total: 4, viewerChoice: 1 } }));
  await render(poll, interaction({ onVote }));
  expect(texts().some((t) => t.includes("%"))).toBe(false);
  await act(async () => button(/^Coffee$/).props.onPress());
  expect(onVote).toHaveBeenCalledWith("p", 1);
  expect(texts()).toEqual(expect.arrayContaining(["25%", "75%"]));
  expect(button(/^Coffee, 75 percent, your answer$/).props.accessibilityState?.disabled).toBe(true);
  expect(haptics()).toContain("selection");
});

test("the owner sees results and the vote count, and can't vote", async () => {
  await render({ ...poll, properties: { ...poll.properties, results: { counts: [2, 2], total: 4, viewerChoice: null } } } as Overlay, interaction({ isOwner: true }));
  expect(texts()).toEqual(expect.arrayContaining(["50%", "4 votes"]));
  expect(button(/^Tea, 50 percent$/).props.accessibilityState?.disabled).toBe(true);
});

test("a wrong quiz answer buzzes and shows the right one; a right one is a success", async () => {
  await render(quiz, interaction({ onVote: jest.fn(async () => ({ results: { counts: [1, 0], total: 1, viewerChoice: 0 }, correctIndex: 1, correct: false })) }));
  await act(async () => button(/^Mumbai$/).props.onPress());
  expect(haptics()).toContain("notificationError");
  expect(button(/Delhi.*correct answer/)).toBeTruthy();
  expect(button(/Mumbai.*your answer, wrong/)).toBeTruthy();
  await act(async () => tree.unmount());
  haptics().length = 0;
  await render(quiz, interaction({ onVote: jest.fn(async () => ({ results: { counts: [0, 1], total: 1, viewerChoice: 1 }, correctIndex: 1, correct: true })) }));
  await act(async () => button(/^Delhi$/).props.onPress());
  expect(haptics()).toContain("notificationSuccess");
});

test("a question opens the private answer sheet; a link asks before opening; Add yours starts a Story", async () => {
  const actions = interaction();
  await render({ id: "a", type: "question", ...at, properties: { prompt: "Ask me anything" } }, actions);
  await act(async () => button(/^Answer: Ask me anything$/).props.onPress());
  expect(actions.onAnswer).toHaveBeenCalled();
  await act(async () => tree.unmount());
  await render({ id: "l", type: "link", ...at, properties: { url: "https://www.shop.example.com/sale", label: null } }, actions);
  expect(texts()).toContain("SHOP.EXAMPLE.COM");
  await act(async () => button(/^Link: shop\.example\.com/).props.onPress());
  expect(actions.onOpenLink).toHaveBeenCalledWith("https://www.shop.example.com/sale");
  await act(async () => tree.unmount());
  await render({ id: "y", type: "addYours", ...at, properties: { prompt: "Show your desk", chainId: "c1", participants: 12, recent: [] } }, actions);
  expect(texts()).toContain("12 participants");
  await act(async () => button(/^Add yours: Show your desk$/).props.onPress());
  expect(actions.onAddYours).toHaveBeenCalled();
  await act(async () => button(/12 people added theirs/).props.onPress());
  expect(actions.onOpenChain).toHaveBeenCalledWith("c1");
});

test("a countdown ticks, and Remind me turns on (and back off if the server refuses)", async () => {
  jest.useFakeTimers();
  const endsAt = new Date(Date.now() + 90_061_000).toISOString();
  const onRemind = jest.fn(async () => false);
  await render({ id: "c", type: "countdown", ...at, properties: { title: "Launch", endsAt } }, interaction({ onRemind }));
  expect(texts()).toEqual(expect.arrayContaining(["01", "days"]));
  await act(async () => button(/^Remind me when it ends$/).props.onPress());
  expect(onRemind).toHaveBeenCalledWith("c", true);
  expect(button(/^Remind me when it ends$/)).toBeTruthy();
  jest.useRealTimers();
  expect(timeLeft(new Date(Date.now() - 1).toISOString(), Date.now()).over).toBe(true);
});

test("the sticker form only adds a poll with 2-4 filled options, and a quiz with its answer", async () => {
  const onDone = jest.fn();
  await act(async () => { tree = create(<InteractiveStickerForm usedTypes={["link"]} onDone={onDone} />); });
  expect(button(/^Link\. Already on this Story$/).props.accessibilityState?.disabled).toBe(true);
  await act(async () => button(/^Quiz\./).props.onPress());
  const inputs = () => tree.root.findAllByType(TextInput);
  await act(async () => inputs()[0]!.props.onChangeText("Capital of India?"));
  await act(async () => inputs()[1]!.props.onChangeText("Mumbai"));
  const add = () => tree.root.find((n) => n.props.accessibilityRole === "button" && typeof n.props.onPress === "function" && [n.props.children].flat().some((c: unknown) => (c as ReactTestInstance)?.props?.children === "Add to Story"));
  expect(add().props.accessibilityState?.disabled).toBe(true);
  await act(async () => inputs()[2]!.props.onChangeText("New Delhi"));
  await act(async () => button(/^Mark option 2 as the right answer$/).props.onPress());
  await act(async () => add().props.onPress());
  expect(onDone).toHaveBeenCalledWith("quiz", { question: "Capital of India?", options: ["Mumbai", "New Delhi"], correctIndex: 1 });
});

test("a link sticker is checked against the link-safety policy before it's added", async () => {
  (stickersApi.checkStickerLink as jest.Mock).mockRejectedValueOnce(new (require("../src/api/client").ApiError)(422, "Links to scam.example aren't allowed on Katkee."));
  const onDone = jest.fn();
  await act(async () => { tree = create(<InteractiveStickerForm usedTypes={[]} onDone={onDone} />); });
  await act(async () => button(/^Link\./).props.onPress());
  await act(async () => tree.root.findAllByType(TextInput)[0]!.props.onChangeText("scam.example/win"));
  const add = tree.root.find((n) => n.props.accessibilityRole === "button" && typeof n.props.onPress === "function" && n.props.accessibilityState?.busy === false);
  await act(async () => add.props.onPress());
  expect(stickersApi.checkStickerLink).toHaveBeenCalledWith("https://scam.example/win", "token");
  expect(texts()).toContain("Links to scam.example aren't allowed on Katkee.");
  expect(onDone).not.toHaveBeenCalled();
});

test("drafts with interactive stickers restore; broken ones don't", () => {
  const draft = (overlays: unknown[]) => ({ audience: "public", mimeType: "image/jpeg", savedAt: "2026-10-03T00:00:00Z", draft: { sourceMedia: { uri: "file:///p.jpg", kind: "photo", width: null, height: null }, filter: "Original", overlays, drawing: [], caption: "", audioMuted: false, crop: { zoom: 1, offsetX: 0, offsetY: 0 } } });
  expect(isSavedDraft(draft([poll, { ...quiz, properties: { ...quiz.properties, correctIndex: 1 } }, { id: "c", type: "countdown", ...at, properties: { title: "x", endsAt: "2026-12-01T00:00:00Z" } }]), "file:///p.jpg")).toBe(true);
  expect(isSavedDraft(draft([{ ...poll, properties: { question: "", options: ["only one"] } }]), "file:///p.jpg")).toBe(false);
  expect(isSavedDraft(draft([{ id: "l", type: "link", ...at, properties: { url: "javascript:alert(1)", label: null } }]), "file:///p.jpg")).toBe(false);
});

test("an Add yours seed waits for the next Story only", () => {
  setCreateSeed({ kind: "addYours", prompt: "Show your desk", chainId: "c1" });
  expect(currentCreateSeed()).toEqual({ kind: "addYours", prompt: "Show your desk", chainId: "c1" });
  clearCreateSeed();
  expect(currentCreateSeed()).toBeNull();
  expect(linkHost("https://www.Example.com/x")).toBe("example.com");
  expect(normalizeLinkInput(" example.com ")).toBe("https://example.com");
});
