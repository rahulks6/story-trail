import * as media from "../src/api/media";
import * as conversations from "../src/api/conversations";
import { newPendingMedia, sendPendingMedia } from "../src/screens/dm/sendMedia";

afterEach(() => jest.restoreAllMocks());
const asMedia = (status: string) => ({ id: "md1", kind: "photo", status }) as unknown as media.UploadedMedia;

test("uploads, waits until the photo is ready, then sends it once with its own id", async () => {
  jest.useFakeTimers();
  const upload = jest.spyOn(media, "uploadPhoto").mockResolvedValue(asMedia("processing"));
  jest.spyOn(media, "getMedia").mockResolvedValueOnce(asMedia("processing")).mockResolvedValueOnce(asMedia("ready"));
  const send = jest.spyOn(conversations, "sendMessage").mockResolvedValue({ message: { id: "m1" } as conversations.Message });
  const item = newPendingMedia({ uri: "file:///p.jpg", type: "image/jpeg", width: 100, height: 200 });
  const done = sendPendingMedia("c1", item, () => "token");
  for (let i = 0; i < 10; i++) { await Promise.resolve(); jest.advanceTimersByTime(5000); }
  await expect(done).resolves.toMatchObject({ id: "m1" });
  expect(upload).toHaveBeenCalledWith("file:///p.jpg", "image/jpeg", "token");
  expect(send).toHaveBeenCalledWith("c1", { mediaId: "md1", clientMessageId: item.clientMessageId }, "token");
  jest.useRealTimers();
});

test("videos go up as videos, and a failed processing is reported", async () => {
  jest.spyOn(media, "uploadVideo").mockResolvedValue({ ...asMedia("failed"), processingError: "Unsupported video." } as media.UploadedMedia);
  const item = newPendingMedia({ uri: "file:///v.mp4", type: "video/mp4" });
  expect(item.mediaKind).toBe("video");
  await expect(sendPendingMedia("c1", item, () => "token")).rejects.toThrow("Unsupported video.");
});

test("a voice note goes up as audio and is sent once it's ready", async () => {
  const { newVoiceNote } = require("../src/screens/dm/sendMedia");
  const upload = jest.spyOn(media, "uploadAudio").mockResolvedValue({ id: "a1", kind: "audio", status: "ready" } as unknown as media.UploadedMedia);
  const send = jest.spyOn(conversations, "sendMessage").mockResolvedValue({ message: { id: "m9" } as conversations.Message });
  const note = newVoiceNote("file:///data/voice.mp4", 4200);
  expect(note.mediaKind).toBe("audio");
  await expect(sendPendingMedia("c1", note, () => "token")).resolves.toMatchObject({ id: "m9" });
  expect(upload).toHaveBeenCalledWith("file:///data/voice.mp4", "token");
  expect(send).toHaveBeenCalledWith("c1", { mediaId: "a1", clientMessageId: note.clientMessageId }, "token");
});
