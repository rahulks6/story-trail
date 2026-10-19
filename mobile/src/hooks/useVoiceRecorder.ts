import { useCallback, useEffect, useRef, useState } from "react";
import { PermissionsAndroid, Platform } from "react-native";
import { AudioEncoderAndroidType, createSound, OutputFormatAndroidType } from "react-native-nitro-sound";

/** Longest voice note (the server's limit too). */
export const MAX_VOICE_MS = 5 * 60_000;
/** Shorter than this is a mis-tap, not a message. */
export const MIN_VOICE_MS = 700;

export type RecorderState = { status: "idle" } | { status: "starting" } | { status: "recording"; elapsedMs: number } | { status: "stopping" };

/**
 * Records a voice note as M4A (AAC, mono): what the server accepts and every phone plays.
 * Asks for the microphone first on Android. Recording stops by itself at five minutes.
 */
export function useVoiceRecorder(onRecorded: (uri: string, durationMs: number) => void, onError: (message: string) => void) {
  const sound = useRef(createSound()).current;
  const [state, setState] = useState<RecorderState>({ status: "idle" });
  const elapsed = useRef(0);
  const latest = useRef({ onRecorded, onError });
  latest.current = { onRecorded, onError };

  const stop = useCallback(async (send: boolean) => {
    setState({ status: "stopping" });
    try {
      const path = await sound.stopRecorder();
      sound.removeRecordBackListener();
      const durationMs = elapsed.current;
      if (send && durationMs >= MIN_VOICE_MS && path && !/already stopped/i.test(path)) {
        latest.current.onRecorded(path.startsWith("file://") ? path : `file://${path}`, durationMs);
      }
    } catch {
      latest.current.onError("Couldn't save that voice message.");
    } finally {
      elapsed.current = 0;
      setState({ status: "idle" });
    }
  }, [sound]);

  const start = useCallback(async () => {
    if (Platform.OS === "android") {
      const granted = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
      if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
        latest.current.onError("Allow microphone access in Settings to send voice messages.");
        return;
      }
    }
    setState({ status: "starting" });
    elapsed.current = 0;
    try {
      sound.addRecordBackListener((e) => {
        elapsed.current = e.currentPosition;
        setState({ status: "recording", elapsedMs: e.currentPosition });
        if (e.currentPosition >= MAX_VOICE_MS) void stop(true);
      });
      await sound.startRecorder(undefined, {
        AudioEncoderAndroid: AudioEncoderAndroidType.AAC,
        OutputFormatAndroid: OutputFormatAndroidType.MPEG_4,
        AVFormatIDKeyIOS: "aac",
        AVModeIOS: "spokenAudio",
        AudioSamplingRate: 44100,
        AudioEncodingBitRate: 96000,
        AudioChannels: 1,
      });
      setState({ status: "recording", elapsedMs: 0 });
    } catch {
      sound.removeRecordBackListener();
      setState({ status: "idle" });
      latest.current.onError("The microphone isn't available right now.");
    }
  }, [sound, stop]);

  // Leaving the chat mid-recording throws the recording away.
  useEffect(() => () => {
    void sound.stopRecorder().catch(() => undefined);
    sound.removeRecordBackListener();
  }, [sound]);

  return { state, start, send: () => stop(true), cancel: () => stop(false) };
}
