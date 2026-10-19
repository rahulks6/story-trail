import React from "react";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { SafeAreaProvider } from "react-native-safe-area-context";
import * as musicApi from "../src/api/music";
import { MusicSheet, type ChosenMusic } from "../src/components/MusicSheet";

jest.mock("../src/state/AuthContext", () => ({ useAuth: () => ({ accessToken: "token", user: { id: "me", username: "rahul" } }) }));

const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };
const track = (id: string, title: string, durationMs = 120_000): musicApi.MusicTrack => ({
  id, title, artist: "Artist", mood: "Happy", durationMs, license: "CC BY 4.0", licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
  attribution: `${title} by Artist (CC BY 4.0)`, url: `/api/v1/music/${id}/file`,
});
let tree: ReactTestRenderer;
const flush = async () => { for (let i = 0; i < 5; i++) await act(async () => { await Promise.resolve(); }); };
const byLabel = (label: string) => tree.root.find((n: ReactTestInstance) => typeof n.props.onPress === "function" && n.props.accessibilityLabel === label);
const players = () => tree.root.findAll((n: ReactTestInstance) => (n.type as unknown) === "Video");

afterEach(async () => { await act(async () => tree?.unmount()); jest.restoreAllMocks(); });

async function open(onChoose = jest.fn()) {
  await act(async () => {
    tree = create(<SafeAreaProvider initialMetrics={metrics}><MusicSheet visible onClose={jest.fn()} onChoose={onChoose} /></SafeAreaProvider>);
  });
  await flush();
  return onChoose;
}

test("lists songs by mood, plays a preview, and adds the chosen part to the Story", async () => {
  const list = jest.spyOn(musicApi, "listMusic").mockResolvedValue({ tracks: [track("t1", "Sunny Walk"), track("t2", "Night Drive")], moods: ["Chill", "Happy"] });
  const onChoose = await open();
  expect(list).toHaveBeenCalledWith("token", { q: "", mood: "" });
  await act(async () => byLabel("Chill").props.onPress());
  await flush();
  expect(list).toHaveBeenLastCalledWith("token", { q: "", mood: "Chill" });

  await act(async () => byLabel("Play Sunny Walk").props.onPress());
  expect(players()).toHaveLength(1);
  expect(players()[0]!.props.source.uri).toMatch(/\/api\/v1\/music\/t1\/file$/);

  await act(async () => byLabel("Sunny Walk by Artist, 2:00").props.onPress());
  // Choosing the part: 15 seconds from a quarter of the way in, changeable to 30.
  await act(async () => byLabel("30 seconds").props.onPress());
  await act(async () => byLabel("Add to Story").props.onPress());
  const chosen = onChoose.mock.calls[0]![0] as ChosenMusic;
  expect(chosen.track.id).toBe("t1");
  expect([chosen.startMs, chosen.durationMs]).toEqual([30_000, 30_000]);
});

test("a short song plays whole, never past its end", async () => {
  jest.spyOn(musicApi, "listMusic").mockResolvedValue({ tracks: [track("t3", "Jingle", 8_000)] });
  const onChoose = await open();
  await act(async () => byLabel("Jingle by Artist, 0:08").props.onPress());
  await act(async () => byLabel("Add to Story").props.onPress());
  const chosen = onChoose.mock.calls[0]![0] as ChosenMusic;
  expect(chosen.startMs + chosen.durationMs).toBeLessThanOrEqual(8_000);
});

test("says when the catalogue has nothing yet", async () => {
  jest.spyOn(musicApi, "listMusic").mockResolvedValue({ tracks: [] });
  await open();
  const texts = tree.root.findAll((n: ReactTestInstance) => (n.type as unknown) === "Text").map((t) => [t.props.children].flat().join(""));
  expect(texts).toContain("Songs are on their way. Check back soon.");
});
