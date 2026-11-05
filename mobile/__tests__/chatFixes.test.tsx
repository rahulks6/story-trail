import React from "react";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { truncateText } from "../src/screens/dm/threadState";
import { VoiceNoteBubble } from "../src/components/VoiceNote";
import * as media from "../src/api/media";
import * as conversations from "../src/api/conversations";
import { ApiError } from "../src/api/client";
import { newPendingMedia, newVoiceNote, sendPendingMedia } from "../src/screens/dm/sendMedia";

// The player with a seek the test can see.
const mockSeek = jest.fn();
jest.mock("react-native-video", () => {
  const ReactLib = require("react");
  const Video = ReactLib.forwardRef((props: object, ref: unknown) => {
    ReactLib.useImperativeHandle(ref, () => ({ seek: mockSeek }));
    return ReactLib.createElement("Video", props);
  });
  return { __esModule: true, default: Video };
});

afterEach(() => jest.restoreAllMocks());

describe("a quote's start never cuts an emoji in half", () => {
  test("counts characters as the server does, not UTF-16 units", () => {
    // 159 letters and an emoji: slice(0, 160) kept half the emoji, shown as "�".
    const text = `${"a".repeat(159)}😂 and more`;
    expect(text.slice(0, 160)).toMatch(/\uD83D$/);
    expect(truncateText(text, 160)).toBe(`${"a".repeat(159)}😂`);
    expect(truncateText("short 👍", 160)).toBe("short 👍");
  });
  test("drops a family, a skin tone or a flag it would split, rather than show the wrong one", () => {
    expect(truncateText("hi 👨‍👩‍👧 there", 5)).toBe("hi ");
    expect(truncateText("ok 👍🏽!", 4)).toBe("ok ");
    expect(truncateText("go 🇮🇳🇺🇸", 4)).toBe("go ");
    expect(truncateText("go 🇮🇳🇺🇸", 6)).toBe("go 🇮🇳");
    expect(truncateText("love ❤️ you", 6)).toBe("love ");
    expect(truncateText("love ❤️ you", 7)).toBe("love ❤️");
  });
});

describe("a voice note", () => {
  let tree: ReactTestRenderer;
  function render(playing: boolean, onStop = jest.fn()) {
    const element = <VoiceNoteBubble url="/media/a1/audio" accessToken="t" durationMs={10_000} mine playing={playing} onPlay={jest.fn()} onStop={onStop} label="You" />;
    act(() => { if (tree) tree.update(element); else tree = create(element); });
  }
  const player = () => tree.root.find((n: ReactTestInstance) => (n.type as unknown) === "Video");
  const time = () => tree.root.find((n) => typeof n.props.children === "string" && /^\d+:\d\d$/.test(n.props.children)).props.children;
  afterEach(() => { act(() => tree.unmount()); (tree as unknown) = undefined; mockSeek.mockReset(); });

  test("paused, it plays on from where it stopped (not from the start), and shows the time left", () => {
    render(true);
    act(() => player().props.onLoad({ duration: 10 }));
    expect(mockSeek).not.toHaveBeenCalled(); // first play: from the start
    act(() => player().props.onProgress({ currentTime: 4 }));
    render(false); // pause: the player goes
    expect(time()).toBe("0:06");
    render(true); // play again: a new player, moved to 4 s
    act(() => player().props.onLoad({ duration: 10 }));
    expect(mockSeek).toHaveBeenCalledWith(4);
    expect(time()).toBe("0:06");
  });

  test("played to the end, it starts over; a note that can't play says so", () => {
    const onStop = jest.fn();
    render(true, onStop);
    act(() => player().props.onLoad({ duration: 10 }));
    act(() => player().props.onEnd());
    expect(onStop).toHaveBeenCalled();
    render(false, onStop);
    expect(time()).toBe("0:10");
    const toast = jest.spyOn(require("../src/components/Toast"), "showToast").mockImplementation(() => undefined);
    render(true, onStop);
    act(() => player().props.onError({ error: {} }));
    expect(toast).toHaveBeenCalledWith("Couldn't play this voice message. Check your connection and try again.");
  });
});

test("a dropped connection while waiting for processing doesn't fail the send: it keeps checking", async () => {
  jest.useFakeTimers();
  jest.spyOn(media, "uploadAudio").mockResolvedValue({ id: "a1", kind: "audio", status: "processing" } as unknown as media.UploadedMedia);
  jest.spyOn(media, "getMedia")
    .mockRejectedValueOnce(new ApiError(0, "Network request failed"))
    .mockRejectedValueOnce(new ApiError(503, "Busy"))
    .mockResolvedValueOnce({ id: "a1", kind: "audio", status: "ready" } as unknown as media.UploadedMedia);
  const send = jest.spyOn(conversations, "sendMessage").mockResolvedValue({ message: { id: "m1" } as conversations.Message });
  const done = sendPendingMedia("c1", newVoiceNote("file:///v.mp4", 3000), () => "token");
  for (let i = 0; i < 20; i++) { await Promise.resolve(); jest.advanceTimersByTime(5000); }
  await expect(done).resolves.toMatchObject({ id: "m1" });
  expect(send).toHaveBeenCalledTimes(1);
  jest.useRealTimers();
});

test("Retry after processing failed for good uploads the photo again instead of repeating the error", async () => {
  jest.spyOn(media, "getMedia").mockResolvedValue({ id: "md1", kind: "photo", status: "failed", retryable: false, processingError: "Broken." } as unknown as media.UploadedMedia);
  const upload = jest.spyOn(media, "uploadPhoto").mockResolvedValue({ id: "md2", kind: "photo", status: "ready" } as unknown as media.UploadedMedia);
  const send = jest.spyOn(conversations, "sendMessage").mockResolvedValue({ message: { id: "m3" } as conversations.Message });
  const item = { ...newPendingMedia({ uri: "file:///p.jpg", type: "image/jpeg" }), mediaId: "md1" };
  await expect(sendPendingMedia("c1", item, () => "token")).resolves.toMatchObject({ id: "m3" });
  expect(upload).toHaveBeenCalledTimes(1);
  expect(send).toHaveBeenCalledWith("c1", { mediaId: "md2", clientMessageId: item.clientMessageId }, "token");
});
