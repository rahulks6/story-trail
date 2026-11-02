import { apiGet, apiPost } from "./client";

/** Mirrors backend/src/modules/calls (calls.service.ts CallView, ice-servers.ts). */
export type CallMedia = "audio" | "video";
export type CallEndReason = "completed" | "missed" | "cancelled" | "declined" | "busy" | "failed";

export interface CallPerson {
  id: string;
  username: string;
  displayName: string;
  avatarMediaId: string | null;
  verified: boolean;
}

export interface CallView {
  id: string;
  conversationId: string;
  media: CallMedia;
  state: "ringing" | "active" | "ended";
  endReason: CallEndReason | null;
  /** You placed the call. */
  outgoing: boolean;
  caller: CallPerson | null;
  callee: CallPerson | null;
  createdAt: string;
  /** The other phone is ringing. */
  ringing: boolean;
  answeredAt: string | null;
  endedAt: string | null;
  ringsUntil: string | null;
  durationSeconds: number | null;
}

export interface IceServer {
  urls: string[];
  username?: string;
  credential?: string;
}

export interface IceServers {
  iceServers: IceServer[];
  ttlSeconds: number;
}

export type CallSignal =
  | { kind: "offer" | "answer"; payload: { sdp: string } }
  | { kind: "candidate"; payload: { candidate: string; sdpMid: string | null; sdpMLineIndex: number | null } }
  | { kind: "restart"; payload: Record<string, never> }
  | { kind: "media"; payload: { microphone: boolean; camera: boolean } };

export type ReceivedSignal = CallSignal & { seq: number };

/** Places a call; `iceServers` is null when it ended at once (they're on another call). */
export function startCall(conversationId: string, media: CallMedia, accessToken: string): Promise<{ call: CallView; iceServers: IceServers | null }> {
  return apiPost(`/api/v1/conversations/${conversationId}/calls`, { media }, accessToken);
}

export function getCall(callId: string, accessToken: string): Promise<{ call: CallView }> {
  return apiGet(`/api/v1/calls/${callId}`, accessToken);
}

/** Tells the caller this phone is ringing. */
export function reportRinging(callId: string, accessToken: string): Promise<{ call: CallView }> {
  return apiPost(`/api/v1/calls/${callId}/ringing`, undefined, accessToken);
}

export function acceptCall(callId: string, accessToken: string): Promise<{ call: CallView; iceServers: IceServers }> {
  return apiPost(`/api/v1/calls/${callId}/accept`, undefined, accessToken);
}

export function declineCall(callId: string, accessToken: string): Promise<{ call: CallView }> {
  return apiPost(`/api/v1/calls/${callId}/decline`, undefined, accessToken);
}

/** Hangs up; "timeout" when the ring time ran out, "failed" when the call never connected. */
export function endCall(callId: string, reason: "hangup" | "timeout" | "failed", accessToken: string): Promise<{ call: CallView }> {
  return apiPost(`/api/v1/calls/${callId}/end`, { reason }, accessToken);
}

export function callHeartbeat(callId: string, accessToken: string): Promise<{ call: CallView }> {
  return apiPost(`/api/v1/calls/${callId}/heartbeat`, undefined, accessToken);
}

export function sendCallSignal(callId: string, signal: CallSignal, accessToken: string): Promise<{ seq: number }> {
  return apiPost(`/api/v1/calls/${callId}/signals`, signal, accessToken);
}

/** The other phone's signals after `after` (the last one handled), oldest first. */
export function listCallSignals(callId: string, after: number, accessToken: string): Promise<{ call: CallView; signals: ReceivedSignal[] }> {
  return apiGet(`/api/v1/calls/${callId}/signals?after=${after}`, accessToken);
}

/** Fresh STUN/TURN servers, e.g. to reconnect a long call after its credentials expired. */
export function getIceServers(accessToken: string): Promise<IceServers> {
  return apiGet("/api/v1/calls/ice-servers", accessToken);
}
