import AsyncStorage from "@react-native-async-storage/async-storage";
import * as RNFS from "@dr.pogodin/react-native-fs";
import * as crash from "../src/crashReporting";
import { enqueueUpload, listUploads, PrepareTimeoutError, PREPARE_STEP_MS } from "../src/state/uploadQueue";

// Tapping Your Story copies the Story into the outbox first. A copy (or storage call) that hangs
// must end with a message and Retry, be reported with its timings, and not hold up the next share.
jest.mock("../src/analytics/analytics", () => ({ track: jest.fn() }));
const owner = "44444444-4444-4444-4444-444444444444";
const payload = { caption: "", audience: "public" } as never;

// The app reads the outbox with getMany; the test storage has getItem only.
const storage = AsyncStorage as unknown as { getMany?: (keys: string[]) => Promise<Record<string, string | null>> };
storage.getMany ??= async (keys) => Object.fromEntries(await Promise.all(keys.map(async (k) => [k, await AsyncStorage.getItem(k)] as const)));

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.restoreAllMocks();
});
afterEach(() => jest.useRealTimers());

it("a copy that never finishes ends the share with a clear message, reported with its step and timings", async () => {
  jest.useFakeTimers();
  const report = jest.spyOn(crash, "reportHandledError").mockImplementation(() => undefined);
  jest.spyOn(RNFS, "stat").mockResolvedValue({ size: 8_000_000 } as never);
  jest.spyOn(RNFS, "copyFile").mockReturnValue(new Promise<void>(() => undefined));
  const share = enqueueUpload(owner, "file:///data/cache/clip.mp4", "video", "video/mp4", payload);
  const outcome = share.then(() => "posted", (e: unknown) => e);
  // Its time: 15 s plus 2 s for 8 MB.
  await jest.advanceTimersByTimeAsync(PREPARE_STEP_MS + 2_000 + 100);
  const error = await outcome;
  expect(error).toBeInstanceOf(PrepareTimeoutError);
  expect((error as PrepareTimeoutError).step).toBe("copy");
  expect((error as Error).message).toBe("Your Story took too long to get ready on this phone. Try again.");
  const detail = String((report.mock.calls[0]![0] as Error).message);
  expect(detail).toMatch(/^share_prepare timeout step=copy kind=video scheme=file bytes=8000000 /);
  expect(detail).toMatch(/copy=\d+ms/);
  // Never the file's name or path.
  expect(detail).not.toMatch(/clip|cache/);
  expect(await listUploads(owner)).toEqual([]);
});

it("the next share isn't held up behind the stuck one", async () => {
  jest.useFakeTimers();
  jest.spyOn(crash, "reportHandledError").mockImplementation(() => undefined);
  jest.spyOn(RNFS, "stat").mockResolvedValue({ size: 1000 } as never);
  const copy = jest.spyOn(RNFS, "copyFile").mockReturnValueOnce(new Promise<void>(() => undefined)).mockResolvedValue(undefined);
  const first = enqueueUpload(owner, "file:///a.jpg", "photo", "image/jpeg", payload).catch((e: unknown) => e);
  await jest.advanceTimersByTimeAsync(PREPARE_STEP_MS + 1_000);
  expect(await first).toBeInstanceOf(PrepareTimeoutError);
  const second = await enqueueUpload(owner, "file:///b.jpg", "photo", "image/jpeg", payload);
  expect(second.status).toBe("queued");
  // (The file-system stand-in keeps calls from earlier tests: count this test's files only.)
  expect(copy.mock.calls.map((c) => c[0]).filter((from) => from === "/a.jpg" || from === "/b.jpg")).toEqual(["/a.jpg", "/b.jpg"]);
  expect((await listUploads(owner)).map((j) => j.id)).toEqual([second.id]);
});

it("a normal share isn't reported", async () => {
  const report = jest.spyOn(crash, "reportHandledError").mockImplementation(() => undefined);
  jest.spyOn(RNFS, "stat").mockResolvedValue({ size: 1000 } as never);
  jest.spyOn(RNFS, "copyFile").mockResolvedValue(undefined);
  const job = await enqueueUpload(owner, "file:///c.jpg", "photo", "image/jpeg", payload);
  expect(job.status).toBe("queued");
  expect(report).not.toHaveBeenCalled();
});
