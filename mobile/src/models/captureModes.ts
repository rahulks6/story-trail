/**
 * Camera modes (like Instagram's): Normal is tap for a photo, hold to record; Hands-free is tap to
 * start recording and tap again to stop; Boomerang is one tap for a short burst that the server
 * turns into a clip that plays forward and back, looped (backend/src/modules/media/processing.ts).
 */
export type CaptureMode = "normal" | "handsfree" | "boomerang";

/** The media effect the server applies while processing the upload. */
export type MediaEffect = "none" | "boomerang";

export const CAPTURE_MODES: ReadonlyArray<{ mode: CaptureMode; label: string; hint: string }> = [
  { mode: "normal", label: "Normal", hint: "Tap for a photo, hold to record" },
  { mode: "handsfree", label: "Hands-free", hint: "Tap to start recording, tap again to stop" },
  { mode: "boomerang", label: "Boomerang", hint: "Tap for a short clip that loops back and forth" },
];

/**
 * How long the camera records for a Boomerang. The server keeps the first 1.2 seconds
 * (BOOMERANG_CLIP_SECONDS); the extra covers the moment the recorder takes to start.
 */
export const BOOMERANG_RECORD_MS = 1600;

export type CaptureAction = "photo" | "start" | "stop" | "boomerang" | "none";

/** What a quick tap on the shutter does in each mode (a hold in Normal records instead). */
export function shutterTap(mode: CaptureMode, recording: boolean): CaptureAction {
  if (mode === "handsfree") return recording ? "stop" : "start";
  if (mode === "boomerang") return recording ? "none" : "boomerang";
  return recording ? "stop" : "photo";
}

/** The shutter's name for a screen reader, in each mode and state. */
export function shutterLabel(mode: CaptureMode, recording: boolean): string {
  if (recording) return mode === "boomerang" ? "Recording Boomerang" : "Recording — activate to stop";
  if (mode === "handsfree") return "Start recording";
  if (mode === "boomerang") return "Record Boomerang";
  return "Take photo";
}
