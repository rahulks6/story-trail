import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { Alert, Text } from "react-native";
import * as storiesApi from "../src/api/stories";
import { pillLabel, SHARED_NOTICE_MS, UploadStatusPill } from "../src/components/UploadStatusPill";
import { UploadRunner } from "../src/state/UploadRunner";
import * as queue from "../src/state/uploadQueue";
import type { UploadJob } from "../src/state/uploadQueue";

jest.mock("../src/state/AuthContext", () => ({ useAuth: () => ({ accessToken: "token", user: { id: "11111111-1111-1111-1111-111111111111" } }) }));
const mockNavigate = jest.fn();
jest.mock("@react-navigation/native", () => ({ ...jest.requireActual("@react-navigation/native"), useNavigation: () => ({ navigate: mockNavigate }) }));

const owner = "11111111-1111-1111-1111-111111111111";
const job = (status: UploadJob["status"], id = "story_abcdefghijklmnop", createdAt = "2026-10-15T06:00:00.000Z"): UploadJob =>
  ({ id, ownerId: owner, kind: "photo", mimeType: "image/jpeg", payload: { caption: "Hey" }, createdAt, status }) as unknown as UploadJob;

let tree: ReactTestRenderer;
const flush = async () => { for (let i = 0; i < 6; i++) await act(async () => { await Promise.resolve(); }); };
const texts = () => tree.root.findAllByType(Text).map((t) => [t.props.children].flat().join(""));

beforeEach(() => {
  jest.restoreAllMocks();
  mockNavigate.mockClear();
});
afterEach(async () => {
  await act(async () => tree?.unmount());
  jest.useRealTimers();
});

describe("the sharing status on Home", () => {
  it("says what is happening in a few words", () => {
    expect(pillLabel(job("uploading"), 0.42, true)).toBe("Sharing… 42%");
    expect(pillLabel(job("processing"), undefined, true)).toBe("Finishing up…");
    expect(pillLabel(job("queued"), undefined, false)).toBe("Sharing…");
    expect(pillLabel(job("published"), undefined, false)).toBe("Shared to your Story");
    expect(pillLabel(job("failed"), undefined, false)).toBe("Couldn't share · Tap to retry");
    expect(pillLabel(job("uploading"), undefined, false)).toBe("Paused · Tap to continue");
  });

  it("shows the newest Story, opens the details on tap, and clears itself after it shares", async () => {
    jest.useFakeTimers();
    jest.spyOn(queue, "listUploads").mockResolvedValue([job("failed", "story_olderolderolder", "2026-10-15T05:00:00.000Z"), job("published")]);
    const remove = jest.spyOn(queue, "removeUpload").mockResolvedValue();
    await act(async () => { tree = create(<UploadStatusPill top={40} />); });
    await flush();
    expect(texts()).toEqual(["Shared to your Story", "Undo"]);
    await act(async () => tree.root.findByProps({ accessibilityHint: "Opens your Story uploads" }).props.onPress());
    expect(mockNavigate).toHaveBeenCalledWith("UploadQueue");
    await act(async () => { jest.advanceTimersByTime(SHARED_NOTICE_MS); });
    expect(remove).toHaveBeenCalledWith(owner, "story_abcdefghijklmnop");
  });

  it("stops a Story still on its way, and takes back one that has just posted", async () => {
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
    const confirm = async (button: string) => {
      const buttons = alert.mock.calls.at(-1)![2] as Array<{ text: string; onPress?: () => unknown }>;
      await act(async () => { await buttons.find((b) => b.text === button)!.onPress?.(); });
    };
    const cancel = jest.spyOn(queue, "cancelUpload").mockResolvedValue(true);
    jest.spyOn(queue, "listUploads").mockResolvedValue([job("uploading")]);
    await act(async () => { tree = create(<UploadStatusPill top={40} />); });
    await flush();
    await act(async () => tree.root.findByProps({ accessibilityLabel: "Stop sharing" }).props.onPress());
    expect(alert.mock.calls.at(-1)![0]).toBe("Stop sharing?");
    await confirm("Stop");
    expect(cancel).toHaveBeenCalledWith(owner, "story_abcdefghijklmnop", "token");

    const del = jest.spyOn(storiesApi, "deleteStory").mockResolvedValue(undefined as never);
    jest.spyOn(queue, "removeUpload").mockResolvedValue();
    jest.spyOn(queue, "listUploads").mockResolvedValue([{ ...job("published"), storyId: "s-9" } as UploadJob]);
    await act(async () => tree.unmount());
    await act(async () => { tree = create(<UploadStatusPill top={40} />); });
    await flush();
    await act(async () => tree.root.findByProps({ accessibilityLabel: "Undo, delete this Story" }).props.onPress());
    await confirm("Delete");
    expect(del).toHaveBeenCalledWith("s-9", "token");
  });

  it("shows nothing when nothing is sharing", async () => {
    jest.spyOn(queue, "listUploads").mockResolvedValue([]);
    await act(async () => { tree = create(<UploadStatusPill top={40} />); });
    await flush();
    expect(tree.toJSON()).toBeNull();
  });
});

describe("uploads in the background", () => {
  it("starts the next waiting Story and checks on ones the server is processing, without any page open", async () => {
    jest.spyOn(queue, "listUploads").mockResolvedValue([job("processing", "story_processingprocess"), job("queued", "story_queuedqueuedqueued")]);
    jest.spyOn(queue, "uploadRunning").mockReturnValue(false);
    const run = jest.spyOn(queue, "runUpload").mockResolvedValue();
    await act(async () => { tree = create(<UploadRunner />); });
    await flush();
    expect(run.mock.calls.map((c) => c[1])).toEqual(["story_processingprocess", "story_queuedqueuedqueued"]);
  });
});
