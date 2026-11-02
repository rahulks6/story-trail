import type { CallEndReason, CallMedia, CallPerson } from "../api/calls";

/**
 * What the call screen shows, as a pure reducer (tested on its own; CallController.ts feeds it):
 *
 *   outgoing ──answered──▶ connecting ──media flows──▶ active ⇄ reconnecting
 *   incoming ──you answer──▶ connecting                    │
 *   any ──hang up / declined / no answer / busy / failed──▶ ended ──(a moment)──▶ idle
 */
export type CallPhase = "idle" | "outgoing" | "incoming" | "connecting" | "active" | "reconnecting" | "ended";

/** Why the screen says the call ended: the server's reasons, plus the phone's own. */
export type EndedBecause = CallEndReason | "unavailable" | "permission" | "error";

export interface CallState {
  phase: CallPhase;
  callId: string | null;
  conversationId: string | null;
  media: CallMedia;
  outgoing: boolean;
  /** The other person. */
  peer: CallPerson | null;
  /** The other phone is ringing (the caller sees "Ringing" instead of "Calling"). */
  remoteRinging: boolean;
  /** When sound first flowed (this phone's clock): the timer counts from here. */
  connectedAt: number | null;
  endedBecause: EndedBecause | null;
  /** How long the call lasted, for the ended screen. */
  durationSeconds: number | null;
  microphoneOn: boolean;
  cameraOn: boolean;
  speakerOn: boolean;
  frontCamera: boolean;
  /** What the other person said they're sending. */
  remoteMicrophoneOn: boolean;
  remoteCameraOn: boolean;
  /** The call carries on in a pill over the app while you use it. */
  minimized: boolean;
  /** The app is in the background (video pauses: phones can't film from the background). */
  backgrounded: boolean;
}

export type CallAction =
  | { type: "outgoing"; conversationId: string; media: CallMedia; peer: CallPerson | null }
  | { type: "placed"; callId: string; peer: CallPerson | null }
  | { type: "incoming"; callId: string; conversationId: string; media: CallMedia; peer: CallPerson | null }
  | { type: "remoteRinging" }
  /** You answered, or the caller learned the other person did. */
  | { type: "answered" }
  | { type: "mediaConnected"; at: number }
  | { type: "mediaInterrupted" }
  | { type: "ended"; because: EndedBecause; at: number }
  | { type: "toggleMicrophone" }
  | { type: "toggleCamera" }
  | { type: "toggleSpeaker" }
  | { type: "flipCamera" }
  | { type: "remoteMedia"; microphone: boolean; camera: boolean }
  | { type: "minimize" }
  | { type: "restore" }
  | { type: "background"; value: boolean }
  | { type: "reset" };

export const IDLE: CallState = {
  phase: "idle",
  callId: null,
  conversationId: null,
  media: "audio",
  outgoing: false,
  peer: null,
  remoteRinging: false,
  connectedAt: null,
  endedBecause: null,
  durationSeconds: null,
  microphoneOn: true,
  cameraOn: false,
  speakerOn: false,
  frontCamera: true,
  remoteMicrophoneOn: true,
  remoteCameraOn: false,
  minimized: false,
  backgrounded: false,
};

/** A call in progress (anything but idle and ended): a second one can't start. */
export function isLive(state: CallState): boolean {
  return state.phase !== "idle" && state.phase !== "ended";
}

function fresh(media: CallMedia): Pick<CallState, "media" | "cameraOn" | "speakerOn" | "remoteCameraOn"> {
  // A video call starts on the loudspeaker with the camera on, like holding the phone out; a
  // voice call on the earpiece.
  return { media, cameraOn: media === "video", speakerOn: media === "video", remoteCameraOn: media === "video" };
}

export function callReducer(state: CallState, action: CallAction): CallState {
  switch (action.type) {
    case "outgoing":
      if (isLive(state)) return state;
      return { ...IDLE, ...fresh(action.media), phase: "outgoing", outgoing: true, conversationId: action.conversationId, peer: action.peer };
    case "placed":
      return state.phase === "outgoing" ? { ...state, callId: action.callId, peer: action.peer ?? state.peer } : state;
    case "incoming":
      // Already on a call: the server tells the caller you're busy; this phone keeps its call.
      if (isLive(state)) return state;
      return { ...IDLE, ...fresh(action.media), phase: "incoming", callId: action.callId, conversationId: action.conversationId, peer: action.peer };
    case "remoteRinging":
      return state.phase === "outgoing" ? { ...state, remoteRinging: true } : state;
    case "answered":
      return state.phase === "outgoing" || state.phase === "incoming" ? { ...state, phase: "connecting" } : state;
    case "mediaConnected":
      if (state.phase !== "connecting" && state.phase !== "reconnecting" && state.phase !== "outgoing") return state;
      return { ...state, phase: "active", connectedAt: state.connectedAt ?? action.at };
    case "mediaInterrupted":
      return state.phase === "active" ? { ...state, phase: "reconnecting" } : state;
    case "ended":
      if (state.phase === "idle" || state.phase === "ended") return state;
      return {
        ...state,
        phase: "ended",
        endedBecause: action.because,
        durationSeconds: state.connectedAt !== null ? Math.max(0, Math.floor((action.at - state.connectedAt) / 1000)) : null,
        minimized: false,
      };
    case "toggleMicrophone":
      return isLive(state) ? { ...state, microphoneOn: !state.microphoneOn } : state;
    case "toggleCamera":
      return isLive(state) && state.media === "video" ? { ...state, cameraOn: !state.cameraOn } : state;
    case "toggleSpeaker":
      return isLive(state) ? { ...state, speakerOn: !state.speakerOn } : state;
    case "flipCamera":
      return isLive(state) && state.media === "video" ? { ...state, frontCamera: !state.frontCamera } : state;
    case "remoteMedia":
      return isLive(state) ? { ...state, remoteMicrophoneOn: action.microphone, remoteCameraOn: action.camera } : state;
    case "minimize":
      // Only a call you've joined: an incoming call is answered or declined first.
      return isLive(state) && state.phase !== "incoming" ? { ...state, minimized: true } : state;
    case "restore":
      return { ...state, minimized: false };
    case "background":
      return { ...state, backgrounded: action.value };
    case "reset":
      return IDLE;
    default:
      return state;
  }
}

/** "4:12", or "1:02:09" past an hour. */
export function formatCallDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = String(s % 60).padStart(2, "0");
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}` : `${minutes}:${seconds}`;
}

const ENDED_TEXT: Record<EndedBecause, string> = {
  completed: "Call ended",
  missed: "No answer",
  cancelled: "Call ended",
  declined: "Declined",
  busy: "On another call",
  failed: "Couldn't connect",
  unavailable: "Calls aren't available",
  permission: "Microphone access needed",
  error: "Call ended",
};

/** The line under the person's name: what's happening now. */
export function callStatusText(state: CallState, now: number): string {
  switch (state.phase) {
    case "outgoing":
      return state.remoteRinging ? "Ringing…" : "Calling…";
    case "incoming":
      return state.media === "video" ? "Incoming video call" : "Incoming voice call";
    case "connecting":
      return "Connecting…";
    case "reconnecting":
      return "Reconnecting…";
    case "active":
      return formatCallDuration(state.connectedAt === null ? 0 : (now - state.connectedAt) / 1000);
    case "ended":
      if (state.endedBecause === "permission" && state.media === "video") return "Camera and microphone access needed";
      return state.endedBecause === "completed" && state.durationSeconds !== null
        ? `Call ended · ${formatCallDuration(state.durationSeconds)}`
        : ENDED_TEXT[state.endedBecause ?? "error"];
    default:
      return "";
  }
}
