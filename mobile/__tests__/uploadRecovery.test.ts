import AsyncStorage from "@react-native-async-storage/async-storage";
import * as media from "../src/api/media";
import * as stories from "../src/api/stories";
import { autoResumeDue, AUTO_RETRY_LIMIT, runUpload, type UploadJob } from "../src/state/uploadQueue";

// A dropped connection must not fail a Story the server already has, or strand one mid-upload.
jest.mock("../src/analytics/analytics", () => ({ track: jest.fn() }));
const owner = "33333333-3333-3333-3333-333333333333";
const storageKey = (id: string) => `katkee.upload.v1.${owner}.${id}`;
const saved = async (id: string) => JSON.parse((await AsyncStorage.getItem(storageKey(id))) ?? "null") as UploadJob;
const save = (id: string, status: string, extra: object = {}) =>
  AsyncStorage.setItem(storageKey(id), JSON.stringify({ id, ownerId: owner, kind: "photo", mimeType: "image/jpeg", payload: {}, createdAt: "2026-10-15T06:00:00.000Z", status, uploadVersion: 2, mediaId: "m-1", ...extra }));
const session = () => ({ ownerId: owner, token: "token" });

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.restoreAllMocks();
});
afterEach(() => jest.useRealTimers());

it("keeps checking a processing Story through a network error, and it posts", async () => {
  jest.useFakeTimers();
  await save("story_processingnetwork", "processing");
  const poll = jest.spyOn(stories, "getPublishRequest")
    .mockRejectedValueOnce(new TypeError("Network request failed"))
    .mockResolvedValueOnce({ publish: { state: "published", storyId: "s-1" } } as never);
  const run = runUpload(owner, "story_processingnetwork", session);
  await jest.advanceTimersByTimeAsync(10_000);
  await run;
  expect(poll).toHaveBeenCalledTimes(2);
  expect(await saved("story_processingnetwork")).toMatchObject({ status: "published", storyId: "s-1" });
});

it("a processing Story whose checks fail on the network stays processing, never failed", async () => {
  jest.useFakeTimers();
  await save("story_processingoffline", "processing");
  jest.spyOn(stories, "getPublishRequest").mockRejectedValue(new TypeError("Network request failed"));
  const run = runUpload(owner, "story_processingoffline", session);
  await jest.advanceTimersByTimeAsync(11 * 60 * 1000);
  await run;
  expect((await saved("story_processingoffline")).status).toBe("processing");
});

it("an upload that fails on the network is tried again by itself, with backoff and a limit", async () => {
  jest.spyOn(media, "createUploadSession").mockRejectedValue(new TypeError("Network request failed"));
  await save("story_uploadnetworkfail", "uploading");
  await expect(runUpload(owner, "story_uploadnetworkfail", session)).rejects.toThrow("Network request failed");
  const job = await saved("story_uploadnetworkfail");
  expect(job).toMatchObject({ status: "failed", networkFailure: true, autoRetries: 0 });
  expect(autoResumeDue(job)).toBe(false); // not straight away
  expect(autoResumeDue(job, Date.now() + 60_000)).toBe(true);
  expect(autoResumeDue(job, Date.now(), true)).toBe(true); // back in the app / connection back
  expect(autoResumeDue({ ...job, autoRetries: AUTO_RETRY_LIMIT }, Date.now() + 3_600_000, true)).toBe(false);

  // A refusal from the server is not retried by itself.
  const { ApiError } = require("../src/api/client");
  jest.spyOn(media, "createUploadSession").mockRejectedValue(new ApiError(422, "Unsupported file."));
  await expect(runUpload(owner, "story_uploadnetworkfail", session)).rejects.toThrow("Unsupported file.");
  expect(autoResumeDue(await saved("story_uploadnetworkfail"), Date.now() + 3_600_000, true)).toBe(false);
});
