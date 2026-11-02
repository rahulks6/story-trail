import type React from "react";
import type { StyleProp, ViewStyle } from "react-native";
import type { IceServer } from "../api/calls";

/**
 * The parts of react-native-webrtc (124.0.8) a call uses, loaded on first use. Typed here rather
 * than imported so the rest of the app (and its tests, which replace the native module) depend
 * only on what calls actually touch; a build without the module simply has no calls.
 */
export interface TrackLike {
  readonly kind: string;
  enabled: boolean;
  stop(): void;
  applyConstraints?(constraints: { facingMode: "user" | "environment" }): Promise<void>;
  _switchCamera?(): void;
}

export interface StreamLike {
  toURL(): string;
  getTracks(): TrackLike[];
  getAudioTracks(): TrackLike[];
  getVideoTracks(): TrackLike[];
  release?(releaseTracks?: boolean): void;
}

export interface CandidateInit {
  candidate: string;
  sdpMid: string | null;
  sdpMLineIndex: number | null;
}

export interface DescriptionInit {
  type: "offer" | "answer";
  sdp: string;
}

export interface PeerLike {
  readonly connectionState: string;
  readonly iceConnectionState: string;
  readonly remoteDescription: unknown;
  onicecandidate: ((event: { candidate: (CandidateInit & { toJSON?: () => CandidateInit }) | null }) => void) | null;
  ontrack: ((event: { streams: StreamLike[] }) => void) | null;
  onconnectionstatechange: (() => void) | null;
  addTrack(track: TrackLike, stream: StreamLike): unknown;
  createOffer(options?: { iceRestart?: boolean }): Promise<DescriptionInit>;
  createAnswer(): Promise<DescriptionInit>;
  setLocalDescription(description: DescriptionInit): Promise<void>;
  setRemoteDescription(description: DescriptionInit): Promise<void>;
  addIceCandidate(candidate: CandidateInit): Promise<void>;
  setConfiguration(configuration: { iceServers: IceServer[] }): void;
  close(): void;
}

export interface VideoViewProps {
  streamURL: string;
  objectFit?: "contain" | "cover";
  mirror?: boolean;
  zOrder?: number;
  style?: StyleProp<ViewStyle>;
}

export interface WebRtc {
  createPeerConnection(configuration: { iceServers: IceServer[] }): PeerLike;
  getUserMedia(constraints: { audio: boolean; video: false | { facingMode: "user"; width: number; height: number; frameRate: number } }): Promise<StreamLike>;
  VideoView: React.ComponentType<VideoViewProps>;
}

let loaded: WebRtc | null | undefined;

export function webRtc(): WebRtc | null {
  if (loaded !== undefined) return loaded;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require("react-native-webrtc") as {
      RTCPeerConnection: new (configuration: { iceServers: IceServer[] }) => PeerLike;
      mediaDevices: { getUserMedia(constraints: unknown): Promise<StreamLike> };
      RTCView: React.ComponentType<VideoViewProps>;
    };
    loaded = {
      createPeerConnection: (configuration) => new mod.RTCPeerConnection(configuration),
      getUserMedia: (constraints) => mod.mediaDevices.getUserMedia(constraints),
      VideoView: mod.RTCView,
    };
  } catch {
    loaded = null; // not linked in this build
  }
  return loaded;
}

/** Video sent at most at this size: sharp on a phone, light on mobile data. */
export const VIDEO_CONSTRAINTS = { facingMode: "user" as const, width: 1280, height: 720, frameRate: 30 };
