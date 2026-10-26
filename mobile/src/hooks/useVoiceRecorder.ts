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
 *
 * One recording at a time, stopped once: the recorder keeps reporting progress for a moment
 * after a stop (and, on Android, for good when stopping a very short recording fails), and a
 * second stop answers with the previous file, so both are ignored once a stop has begun.
 */
export function useVoiceRecorder(onRecorded: (uri: string, durationMs: number) => void, onError: (message: string) => void) {
  const soundRef = useRef<ReturnType<typeof createSound> | null>(null);
  soundRef.current ??= createSound();
  const sound = soundRef.current;
  const [state, setState] = useState<RecorderState>({ status: "idle" });
  /** Where this recording is, whatever the last render shows. */
  const phase = useRef<RecorderState["status"]>("idle");
  /** Delete (or leaving the chat) while the recorder was still starting: stop it once it has. */
  const cancelWhenStarted = useRef(false);
  const mounted = useRef(true);
  const elapsed = useRef(0);
  const latest = useRef({ onRecorded, onError });
  latest.current = { onRecorded, onError };

  const set = useCallback((next: RecorderState) => {
    phase.current = next.status;
    if (mounted.current) setState(next);
  }, []);

  const stop = useCallback(async (send: boolean) => {
    if (phase.current === "starting") {
      cancelWhenStarted.current = true; // never sent: nothing was said yet
      return;
    }
    if (phase.current !== "recording") return;
    set({ status: "stopping" });
    sound.removeRecordBackListener();
    const durationMs = elapsed.current;
    const wanted = send && durationMs >= MIN_VOICE_MS;
    try {
      const path = await sound.stopRecorder();
      if (wanted && mounted.current && path && !/already stopped/i.test(path)) {
        latest.current.onRecorded(path.startsWith("file://") ? path : `file://${path}`, durationMs);
      }
    } catch {
      // Android can't finish a recording only a moment long; that's only worth saying when it was meant to go.
      if (wanted) latest.current.onError("Couldn't save that voice message.");
    } finally {
      elapsed.current = 0;
      set({ status: "idle" });
    }
  }, [set, sound]);

  const start = useCallback(async () => {
    if (phase.current !== "idle") return;
    // Taken at once (a second tap during Android's permission prompt is not a second recording);
    // the recording bar shows once the microphone is allowed.
    phase.current = "starting";
    cancelWhenStarted.current = false;
    elapsed.current = 0;
    if (Platform.OS === "android" && !(await androidMicAllowed(latest.current.onError))) {
      set({ status: "idle" });
      return;
    }
    if (!mounted.current) {
      phase.current = "idle";
      return;
    }
    set({ status: "starting" });
    try {
      // The default is every 60 ms: far more often than the timer needs.
      try { sound.setSubscriptionDuration(PROGRESS_INTERVAL_S); } catch { /* older recorder: keeps its default */ }
      sound.addRecordBackListener((e) => {
        if (phase.current !== "recording" && phase.current !== "starting") return;
        const second = Math.floor(e.currentPosition / 1000);
        const changed = second !== Math.floor(elapsed.current / 1000);
        elapsed.current = e.currentPosition;
        if (phase.current !== "recording") return;
        // Re-render once a second (when the timer changes), not on every report.
        if (changed) set({ status: "recording", elapsedMs: e.currentPosition });
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
      set({ status: "recording", elapsedMs: elapsed.current });
      // Deleted, or the chat closed, while it was starting: the microphone mustn't stay on.
      if (cancelWhenStarted.current || !mounted.current) await stop(false);
    } catch (error) {
      sound.removeRecordBackListener();
      set({ status: "idle" });
      if (cancelWhenStarted.current || !mounted.current) return;
      // iOS: the recorder rejects with "Recording permission denied…" once the microphone is refused.
      if (/permission/i.test(error instanceof Error ? error.message : String(error))) micRefused();
      else latest.current.onError("The microphone isn't available right now.");
    }
  }, [set, sound, stop]);

  // Leaving the chat mid-recording throws the recording away.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (phase.current === "starting") cancelWhenStarted.current = true;
      else if (phase.current === "recording") {
        phase.current = "stopping";
        sound.removeRecordBackListener();
        void sound.stopRecorder().catch(() => undefined);
      }
    };
  }, [sound]);

  return { state, start, send: () => stop(true), cancel: () => stop(false) };
}
