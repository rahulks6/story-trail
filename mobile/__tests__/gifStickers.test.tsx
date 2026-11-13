import React from "react";
import { Image } from "react-native";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import * as gifsApi from "../src/api/gifs";
import { GifPicker } from "../src/components/GifPicker";
import { OverlayBody } from "../src/components/OverlayBody";
import { isSavedDraft } from "../src/state/validateSavedDraft";
import type { Overlay } from "../src/models/storyDraft";

jest.mock("../src/state/AuthContext", () => ({ useAuth: () => ({ accessToken: "token", user: { id: "me", username: "rahul" } }) }));

const katkee = (id: string, category: string, tags: string[]): gifsApi.KatkeeSticker => ({ id, category, tags, url: `/stickers/${id}.webp`, size: 320 });
const PACK = { categories: ["birthday", "festivals"], stickers: [katkee("cake", "birthday", ["cake"]), katkee("balloons", "birthday", ["balloons"]), katkee("diya", "festivals", ["diya"])], giphy: true };
const GIF = { id: "3o7abKhOpu0NwenH3O", url: "https://media2.giphy.com/media/x/200w.webp", previewUrl: "https://media2.giphy.com/media/x/100w.webp", width: 200, height: 150, title: "Party" };

let tree: ReactTestRenderer;
const flush = async () => { for (let i = 0; i < 6; i++) await act(async () => { await Promise.resolve(); }); };
const byTestId = (id: string) => tree.root.find((n: ReactTestInstance) => n.props.testID === id && typeof n.props.onPress === "function");
const images = () => tree.root.findAllByType(Image).map((i) => (i.props.source as { uri: string }).uri);

beforeEach(() => jest.useFakeTimers());
afterEach(async () => { await act(async () => tree?.unmount()); jest.useRealTimers(); jest.restoreAllMocks(); });

test("shows Katkee's stickers by category, then GIPHY's trending, and adds the one tapped", async () => {
  jest.spyOn(gifsApi, "getStickerPack").mockResolvedValue(PACK);
  const search = jest.spyOn(gifsApi, "searchGifs").mockResolvedValue({ katkee: [], giphy: [GIF], nextOffset: null, giphyEnabled: true });
  const onPick = jest.fn();
  await act(async () => { tree = create(<GifPicker onPick={onPick} />); });
  await flush();
  expect(search).toHaveBeenCalledWith("token", "", 0, "en");
  expect(images().filter((u) => u.includes("/stickers/"))).toEqual([expect.stringMatching(/\/stickers\/cake\.webp$/), expect.stringMatching(/\/stickers\/balloons\.webp$/)]);
  expect(images()).toContain(GIF.previewUrl);
  expect(tree.root.findAll((n: ReactTestInstance) => n.props.children === "Powered by GIPHY").length).toBeGreaterThan(0);

  await act(async () => byTestId("gif-category-festivals").props.onPress());
  expect(images().filter((u) => u.includes("/stickers/"))).toEqual([expect.stringMatching(/\/stickers\/diya\.webp$/)]);
  await act(async () => byTestId("gif-k-diya").props.onPress());
  expect(onPick).toHaveBeenLastCalledWith({ source: "katkee", id: "diya", url: "/stickers/diya.webp", width: 320, height: 320 });
  await act(async () => byTestId(`gif-g-${GIF.id}`).props.onPress());
  expect(onPick).toHaveBeenLastCalledWith({ source: "giphy", id: GIF.id, url: GIF.url, width: 200, height: 150 });
});

test("searches after a pause in typing, and without GIPHY shows Katkee's alone", async () => {
  jest.spyOn(gifsApi, "getStickerPack").mockResolvedValue({ ...PACK, giphy: false });
  const search = jest.spyOn(gifsApi, "searchGifs").mockResolvedValue({ katkee: [], giphy: [], nextOffset: null, giphyEnabled: false });
  await act(async () => { tree = create(<GifPicker onPick={jest.fn()} />); });
  await flush();
  search.mockResolvedValue({ katkee: [PACK.stickers[2]!], giphy: [], nextOffset: null, giphyEnabled: false });
  await act(async () => tree.root.findByProps({ testID: "gif-search" }).props.onChangeText("diwali"));
  await act(async () => { jest.advanceTimersByTime(400); });
  await flush();
  expect(search).toHaveBeenLastCalledWith("token", "diwali", 0, "en");
  expect(images()).toEqual([expect.stringMatching(/\/stickers\/diya\.webp$/)]);
  expect(tree.root.findAll((n: ReactTestInstance) => n.props.children === "Powered by GIPHY")).toHaveLength(0);
});

test("a moving sticker shows 40% of the Story's width at its own shape, and saves with the draft", async () => {
  const overlay: Overlay = { id: "g", type: "gif", x: 0.5, y: 0.5, scale: 1, rotation: 0, zIndex: 1, properties: { source: "giphy", id: GIF.id, url: GIF.url, width: 200, height: 150 } };
  await act(async () => { tree = create(<OverlayBody overlay={overlay} containerWidth={400} containerHeight={700} />); });
  const img = tree.root.findByProps({ testID: "gif-sticker" });
  expect(img.props.style).toEqual({ width: 160, height: 120 });
  expect(img.props.source.uri).toBe(GIF.url);
  const draft = (overlays: unknown[]) => ({ audience: "public", mimeType: "image/jpeg", savedAt: "2026-11-13T00:00:00Z", draft: { sourceMedia: { uri: "file:///a.jpg", kind: "photo", width: null, height: null }, filter: "Original", overlays, drawing: [], caption: "", audioMuted: false, crop: { zoom: 1, offsetX: 0, offsetY: 0 } } });
  expect(isSavedDraft(draft([overlay]), "file:///a.jpg")).toBe(true);
  expect(isSavedDraft(draft([{ ...overlay, properties: { ...overlay.properties, url: "javascript:alert(1)" } }]), "file:///a.jpg")).toBe(false);
});
