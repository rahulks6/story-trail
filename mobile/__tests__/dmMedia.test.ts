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

test("videos go up part by part (resumable, keyed by the message id), and a failed processing is reported", async () => {
  const plan = { partSize: 1024, partCount: 1, parts: [{ partNumber: 1, byteLength: 3, uploaded: false, url: "/upload/1" }], urlsExpireAt: "", sessionExpiresAt: "" };
  const session = jest.spyOn(media, "createUploadSession").mockResolvedValue({ media: asMedia("uploading"), upload: plan });
  const part = jest.spyOn(media, "uploadPart").mockResolvedValue(undefined);
  jest.spyOn(media, "completeUploadSession").mockResolvedValue({ media: { ...asMedia("failed"), processingError: "Unsupported video." } as media.UploadedMedia });
  const RNFS = require("@dr.pogodin/react-native-fs");
  RNFS.read.mockResolvedValueOnce("YWJj"); // "abc"
  const item = newPendingMedia({ uri: "file:///v.mp4", type: "video/mp4" });
  expect(item.mediaKind).toBe("video");
  const uploaded = jest.fn();
  await expect(sendPendingMedia("c1", item, () => "token", uploaded)).rejects.toThrow("Unsupported video.");
  expect(session).toHaveBeenCalledWith({ clientUploadId: item.clientMessageId, kind: "video", mimeType: "video/mp4", byteSize: 1024 }, "token");
  expect(part).toHaveBeenCalledTimes(1);
  expect(uploaded).toHaveBeenCalledWith("md1");
});

test("a retry of something already uploaded only waits for it and sends: no second upload", async () => {
  const photo = jest.spyOn(media, "uploadPhoto");
  jest.spyOn(media, "getMedia").mockResolvedValue(asMedia("ready"));
  const send = jest.spyOn(conversations, "sendMessage").mockResolvedValue({ message: { id: "m2" } as conversations.Message });
  const item = { ...newPendingMedia({ uri: "file:///p.jpg", type: "image/jpeg" }), mediaId: "md1" };
  await expect(sendPendingMedia("c1", item, () => "token")).resolves.toMatchObject({ id: "m2" });
  expect(photo).not.toHaveBeenCalled();
  expect(send).toHaveBeenCalledWith("c1", { mediaId: "md1", clientMessageId: item.clientMessageId }, "token");
});

test("the media outbox is saved on the phone, survives a restart, and Retry keeps the uploaded file", async () => {
  const userId = "u-outbox";
  const storage = (globalThis as unknown as { __mockStorage: Map<string, string> }).__mockStorage;
  const sendMedia = require("../src/screens/dm/sendMedia");
  const first = jest.spyOn(sendMedia, "sendPendingMedia").mockImplementation(async (...args: unknown[]) => {
    (args[3] as (id: string) => void)("md7"); // the upload finished...
    throw new Error("Processing is slow."); // ...then waiting for it failed
  });
  const outbox = require("../src/screens/dm/dmMediaOutbox");
  const item = newPendingMedia({ uri: "file:///cache/p.jpg", type: "image/jpeg" });
  await outbox.enqueueMedia(userId, "c1", item, () => "token");
  for (let i = 0; i < 5; i++) await Promise.resolve();
  expect(first).toHaveBeenCalledTimes(1);
  expect(JSON.parse(storage.get(`katkee.dmMediaOutbox.v1.${userId}`)!)).toMatchObject([{ clientMessageId: item.clientMessageId, status: "failed", mediaId: "md7", uri: expect.stringContaining("/documents/katkee-dm-outbox/") }]);

  // The app is opened again: a fresh copy of the module reads it back.
  await jest.isolateModulesAsync(async () => {
    const restarted = require("../src/screens/dm/dmMediaOutbox");
    const again = jest.spyOn(require("../src/screens/dm/sendMedia"), "sendPendingMedia").mockResolvedValue({ id: "m5", conversationId: "c1" });
    await restarted.loadMediaOutbox(userId);
    expect(restarted.pendingMedia(userId, "c1")).toMatchObject([{ status: "failed", mediaId: "md7" }]);
    const sent = jest.fn();
    restarted.onMediaSent(sent);
    await restarted.retryMedia(userId, item.clientMessageId, () => "token");
    expect(again.mock.calls[0]![1]).toMatchObject({ clientMessageId: item.clientMessageId, mediaId: "md7" });
    expect(sent).toHaveBeenCalledWith(userId, { id: "m5", conversationId: "c1" });
    expect(restarted.pendingMedia(userId, "c1")).toEqual([]);
  });
  await outbox.clearMediaOutbox(userId);
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
