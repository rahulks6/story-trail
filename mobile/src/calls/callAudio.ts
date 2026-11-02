import { NativeModules, Platform } from "react-native";
import type { CallMedia } from "../api/calls";

/**
 * The phone side of a call that isn't WebRTC itself:
 *  - react-native-incall-manager (4.3.0): the ringtone for an incoming call, the ringback tone a
 *    caller hears, earpiece or loudspeaker, the proximity sensor that darkens the screen at your
 *    ear on a voice call, and the screen kept on;
 *  - on Android, KatkeeOngoingCall (OngoingCallService.kt): a foreground service with an "Ongoing
 *    call" notification, so the microphone (and camera) keep working when you switch apps.
 * Every call here is best effort: a phone without one of them still calls, just without it.
 */
interface InCallManagerLike {
  start(setup?: { auto?: boolean; media?: CallMedia | "video"; ringback?: string }): void;
  stop(setup?: { busytone?: string }): void;
  startRingtone(ringtone: string, vibratePattern: number | number[], iosCategory: string, seconds: number): void;
  stopRingtone(): void;
  stopRingback(): void;
  setForceSpeakerphoneOn(flag: boolean): void;
  setKeepScreenOn(enable: boolean): void;
}

interface OngoingCallModule {
  start(title: string, video: boolean): void;
  stop(): void;
}

let manager: InCallManagerLike | null | undefined;

function inCall(): InCallManagerLike | null {
  if (manager !== undefined) return manager;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require("react-native-incall-manager") as { default?: InCallManagerLike } & InCallManagerLike;
    manager = mod.default ?? mod;
  } catch {
    manager = null;
  }
  return manager;
}

function quietly(work: () => void): void {
  try {
    work();
  } catch {
    // A phone without this capability carries on without it.
  }
}

/** Rings for an incoming call (the phone's own ringtone, and vibration) until answered or gone. */
export function startRinging(seconds: number): void {
  quietly(() => inCall()?.startRingtone("_DEFAULT_", [0, 1000, 1000], "playback", Math.max(1, Math.ceil(seconds))));
}

export function stopRinging(): void {
  quietly(() => inCall()?.stopRingtone());
}

/** Takes the phone's audio for a call; a caller hears the ringback tone until it's answered. */
export function startCallAudio(media: CallMedia, ringback: boolean): void {
  quietly(() => {
    const m = inCall();
    m?.start({ media, auto: true, ringback: ringback ? "_DTMF_" : "" });
    m?.setKeepScreenOn(true);
  });
}

export function stopRingback(): void {
  quietly(() => inCall()?.stopRingback());
}

export function setSpeaker(on: boolean): void {
  quietly(() => inCall()?.setForceSpeakerphoneOn(on));
}

export function stopCallAudio(): void {
  quietly(() => {
    const m = inCall();
    m?.setKeepScreenOn(false);
    m?.stop();
  });
}

const ongoing = (NativeModules as { KatkeeOngoingCall?: OngoingCallModule }).KatkeeOngoingCall;

/** Android: keeps the call's microphone (and camera) working while the app is in the background. */
export function startOngoingCall(name: string, video: boolean): void {
  if (Platform.OS === "android") quietly(() => ongoing?.start(name, video));
}

export function stopOngoingCall(): void {
  if (Platform.OS === "android") quietly(() => ongoing?.stop());
}
