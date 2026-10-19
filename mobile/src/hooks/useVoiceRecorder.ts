import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Linking, PermissionsAndroid, Platform } from "react-native";
import { AudioEncoderAndroidType, createSound, OutputFormatAndroidType } from "react-native-nitro-sound";

/** Longest voice note (the server's limit too). */
export const MAX_VOICE_MS = 5 * 60_000;
/** Shorter than this is a mis-tap, not a message. */
export const MIN_VOICE_MS = 700;
/** How often the recorder reports progress (seconds); the timer only shows whole seconds. */
const PROGRESS_INTERVAL_S = 0.25;

export const MIC_REFUSED_MESSAGE = "Allow microphone access in Settings to send voice messages.";

export type RecorderState = { status: "idle" } | { status: "starting" } | { status: "recording"; elapsedMs: number } | { status: "stopping" };

/** The microphone was refused for good: only Settings can turn it back on. */
function micRefused(): void {
  Alert.alert("Allow microphone access", MIC_REFUSED_MESSAGE, [
    { text: "Not now", style: "cancel" },
    { text: "Open Settings", onPress: () => void Linking.openSettings().catch(() => undefined) },
  ]);
}

/** Android: asks for the microphone when needed. False when refused (and says what to do). */
async function androidMicAllowed(onError: (message: string) => void): Promise<boolean> {
  const permission = PermissionsAndroid.PERMISSIONS.RECORD_AUDIO;
  if (await PermissionsAndroid.check(permission)) return true;
  const result = await PermissionsAndroid.request(permission);
  if (result === PermissionsAndroid.RESULTS.GRANTED) return true;
  // "Don't ask again": the system won't show its prompt any more.
  if (result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) micRefused();
  else onError(MIC_REFUSED_MESSAGE);
  return false;
}

/**
 * Records a voice note as M4A (AAC, mono): what the server accepts and every phone plays.
 * Asks for the microphone first on Android; iOS asks when recording starts, and a refusal
 * there offers Settings too. Recording stops by itself at five minutes.
 */
export function useVoiceRecorder(onRecorded: (uri: string, durationMs: number) => void, onError: (message: string) => void) {
  const soundRef = useRef<ReturnType<typeof createSound> | null>(null);
  soundRef.current ??= createSound();
  const sound = soundRef.current;
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
    if (Platform.OS === "android" && !(await androidMicAllowed(latest.current.onError))) return;
    setState({ status: "starting" });
    elapsed.current = 0;
    try {
      // The default is every 60 ms: far more often than the timer needs.
      try { sound.setSubscriptionDuration(PROGRESS_INTERVAL_S); } catch { /* older recorder: keeps its default */ }
      sound.addRecordBackListener((e) => {
        const second = Math.floor(e.currentPosition / 1000);
        const changed = second !== Math.floor(elapsed.current / 1000);
        elapsed.current = e.currentPosition;
        // Re-render once a second (when the timer changes), not on every report.
        if (changed) setState({ status: "recording", elapsedMs: e.currentPosition });
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
      setState({ status: "recording", elapsedMs: elapsed.current });
    } catch (error) {
      sound.removeRecordBackListener();
      setState({ status: "idle" });
      // iOS: the recorder rejects with "Recording permission denied…" once the microphone is refused.
      if (/permission/i.test(error instanceof Error ? error.message : String(error))) micRefused();
      else latest.current.onError("The microphone isn't available right now.");
    }
  }, [sound, stop]);

  // Leaving the chat mid-recording throws the recording away.
  useEffect(() => () => {
    void sound.stopRecorder().catch(() => undefined);
    sound.removeRecordBackListener();
  }, [sound]);

  return { state, start, send: () => stop(true), cancel: () => stop(false) };
}
