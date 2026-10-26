import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { useVoiceRecorder, MAX_VOICE_MS } from "../src/hooks/useVoiceRecorder";

// The recorder as Android's really behaves: progress keeps coming for a moment after a stop (and
// for good when stopping a too-short recording throws), and a second stop answers with the last file.
type Progress = (e: { currentPosition: number }) => void;
interface FakeSound {
  listener: Progress | null;
  /** Reports that arrive after removeRecordBackListener, as the native timer still fires. */
  stale: Progress | null;
  startRecorder: jest.Mock;
  stopRecorder: jest.Mock;
}
let fake: FakeSound;
function makeSound(): FakeSound & Record<string, unknown> {
  const sound = {
    listener: null as Progress | null,
    stale: null as Progress | null,
    setSubscriptionDuration: jest.fn(),
    addRecordBackListener: (fn: Progress) => { sound.listener = fn; sound.stale = fn; },
    removeRecordBackListener: () => { sound.listener = null; },
    startRecorder: jest.fn(async () => "file:///data/sound_1.mp4"),
    stopRecorder: jest.fn(async () => "file:///data/sound_1.mp4"),
  };
  return sound;
}

let recorder!: ReturnType<typeof useVoiceRecorder>;
const recorded = jest.fn();
const failed = jest.fn();
function Probe(): null {
  recorder = useVoiceRecorder(recorded, failed);
  return null;
}
let tree: ReactTestRenderer;
async function mount(): Promise<void> {
  const nitro = require("react-native-nitro-sound");
  fake = makeSound();
  jest.spyOn(nitro, "createSound").mockReturnValue(fake);
  await act(async () => { tree = create(<Probe />); });
}
const settle = async () => { for (let i = 0; i < 5; i++) await act(async () => { await Promise.resolve(); }); };

beforeEach(() => { recorded.mockReset(); failed.mockReset(); });
afterEach(async () => { await act(async () => tree?.unmount()); jest.restoreAllMocks(); });

test("Android: Delete right after starting can't finish the file; the bar goes away and stays away, with no error", async () => {
  await mount();
  await act(async () => { await recorder.start(); });
  expect(recorder.state.status).toBe("recording");
  fake.stopRecorder.mockRejectedValueOnce(new Error("stop failed")); // MediaRecorder.stop() on almost no audio
  await act(async () => { await recorder.cancel(); });
  expect(recorder.state.status).toBe("idle");
  // The native timer is never stopped on that path and keeps reporting: it must not bring the bar back.
  await act(async () => fake.stale!({ currentPosition: 1500 }));
  await act(async () => fake.stale!({ currentPosition: 2500 }));
  expect(recorder.state.status).toBe("idle");
  expect(failed).not.toHaveBeenCalled();
  expect(recorded).not.toHaveBeenCalled();
});

test("the five-minute stop and a tap on Send at the same moment send the note once", async () => {
  await mount();
  await act(async () => { await recorder.start(); });
  await act(async () => fake.listener!({ currentPosition: MAX_VOICE_MS }));
  await act(async () => { void recorder.send(); fake.stale!({ currentPosition: MAX_VOICE_MS + 250 }); });
  await settle();
  expect(fake.stopRecorder).toHaveBeenCalledTimes(1);
  expect(recorded).toHaveBeenCalledTimes(1);
  expect(recorded).toHaveBeenCalledWith("file:///data/sound_1.mp4", MAX_VOICE_MS);
  expect(recorder.state.status).toBe("idle");
});

test("Delete while the recorder is still starting turns the microphone off once it has started", async () => {
  await mount();
  let started!: () => void;
  fake.startRecorder.mockImplementationOnce(() => new Promise((resolve) => { started = () => resolve("file:///data/sound_2.mp4"); }));
  await act(async () => { void recorder.start(); });
  expect(recorder.state.status).toBe("starting");
  await act(async () => { await recorder.cancel(); });
  await act(async () => { started(); });
  await settle();
  expect(fake.stopRecorder).toHaveBeenCalledTimes(1);
  expect(recorded).not.toHaveBeenCalled();
  expect(recorder.state.status).toBe("idle");
});

test("leaving the chat while the recorder starts doesn't leave it recording", async () => {
  await mount();
  let started!: () => void;
  fake.startRecorder.mockImplementationOnce(() => new Promise((resolve) => { started = () => resolve("file:///data/sound_3.mp4"); }));
  await act(async () => { void recorder.start(); });
  await act(async () => tree.unmount());
  await act(async () => { started(); });
  await settle();
  expect(fake.stopRecorder).toHaveBeenCalledTimes(1);
  expect(recorded).not.toHaveBeenCalled();
});

test("a stop that fails on a real recording says so", async () => {
  await mount();
  await act(async () => { await recorder.start(); });
  await act(async () => fake.listener!({ currentPosition: 4000 }));
  fake.stopRecorder.mockRejectedValueOnce(new Error("disk full"));
  await act(async () => { await recorder.send(); });
  expect(failed).toHaveBeenCalledWith("Couldn't save that voice message.");
});
