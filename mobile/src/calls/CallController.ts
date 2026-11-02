import * as callsApi from "../api/calls";
import { ApiError } from "../api/client";
import type { CallMedia, CallPerson, CallView, IceServer, ReceivedSignal } from "../api/calls";
import type { CallAction, CallState, EndedBecause } from "./callMachine";
import type { PeerLike, StreamLike, WebRtc } from "./webrtc";
import { VIDEO_CONSTRAINTS } from "./webrtc";
import * as audio from "./callAudio";
import { serverTimeMs } from "../utils/serverTime";

/** How long a call keeps ringing: until the server's deadline, or 45 s when it gave none we can read. */
function ringsForMs(ringsUntil: string | null | undefined, now: number): number {
  const until = serverTimeMs(ringsUntil);
  return Number.isFinite(until) ? until - now : 45_000;
}

/** Heartbeats while a call rings or runs (the server ends a call whose phones went quiet for a minute). */
const HEARTBEAT_MS = 15_000;
/** How long the phones may try to (re)connect before giving up on the call. */
const CONNECT_TIMEOUT_MS = 30_000;
const RECONNECT_GIVE_UP_MS = 30_000;
/** A brief wobble (a network switch) often heals by itself; after this the caller restarts ICE. */
const RESTART_AFTER_MS = 3_000;

export interface Timers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

export interface CallControllerOptions {
  rtc: WebRtc;
  myUserId: string;
  token: () => string | null;
  dispatch: (action: CallAction) => void;
  getState: () => CallState;
  /** The camera/microphone stream and the other person's, for the call screen's video views. */
  onStreams: (local: StreamLike | null, remote: StreamLike | null) => void;
  api?: typeof callsApi;
  audio?: typeof audio;
  timers?: Timers;
  now?: () => number;
}

const defaultTimers: Timers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (h) => clearInterval(h as ReturnType<typeof setInterval>),
};

/** Why a request about a call failed, as the call screen says it. */
function failureReason(error: unknown): EndedBecause {
  if (error instanceof ApiError) {
    if (error.status === 404) return "unavailable";
    if (error.status === 409 && error.details?.code === "call_ended") return "cancelled";
  }
  return "error";
}

function isPermissionError(error: unknown): boolean {
  const name = (error as { name?: unknown } | null)?.name;
  return name === "NotAllowedError" || name === "PermissionDeniedError" || name === "SecurityError";
}

/**
 * One call at a time, from the first tap to the last frame: the camera and microphone, the
 * WebRTC connection, signaling through the server (sent with REST, received as realtime events
 * that say "fetch signals after n"), the ring timeout, heartbeats, reconnecting after a network
 * change (ICE restart, with fresh TURN credentials), and tidying everything up however it ends.
 * The screen's state lives in callMachine.ts; this only dispatches to it.
 *
 * Roles: the caller always makes the offers (the first, with the invite, and every restart); the
 * callee answers, and asks the caller to restart when its side notices the connection is gone.
 */
export class CallController {
  callId: string | null = null;
  private media: CallMedia = "audio";
  private outgoing = false;
  private accepted = false;
  private finished = false;
  private pc: PeerLike | null = null;
  private local: StreamLike | null = null;
  private remote: StreamLike | null = null;
  private lastSeq = 0;
  private fetching: Promise<void> | null = null;
  private fetchAgain = false;
  private pendingCandidates: callsApi.ReceivedSignal[] = [];
  private sending: Promise<unknown> = Promise.resolve();
  private ringTimer: unknown = null;
  private heartbeatTimer: unknown = null;
  private connectTimer: unknown = null;
  private restartTimer: unknown = null;
  private giveUpTimer: unknown = null;
  private everConnected = false;
  private cameraPausedForBackground = false;
  private readonly api: typeof callsApi;
  private readonly audio: typeof audio;
  private readonly timers: Timers;
  private readonly now: () => number;

  constructor(private readonly options: CallControllerOptions) {
    this.api = options.api ?? callsApi;
    this.audio = options.audio ?? audio;
    this.timers = options.timers ?? defaultTimers;
    this.now = options.now ?? Date.now;
  }

  get isFinished(): boolean {
    return this.finished;
  }

  private token(): string {
    const token = this.options.token();
    if (!token) throw new ApiError(401, "Signed out.");
    return token;
  }

  // ---- Starting --------------------------------------------------------------------------------

  /** You call someone from their chat. */
  async place(conversationId: string, media: CallMedia, peer: CallPerson | null): Promise<void> {
    this.media = media;
    this.outgoing = true;
    this.options.dispatch({ type: "outgoing", conversationId, media, peer });
    if (!(await this.openMedia())) return;
    let started: { call: CallView; iceServers: callsApi.IceServers | null };
    try {
      started = await this.api.startCall(conversationId, media, this.token());
    } catch (error) {
      this.finish(failureReason(error));
      return;
    }
    if (this.finished) {
      // Hung up while the call was being placed: end it on the server too.
      void this.api.endCall(started.call.id, "hangup", this.token()).catch(() => undefined);
      return;
    }
    this.callId = started.call.id;
    if (started.call.state === "ended" || !started.iceServers) {
      this.finish(started.call.endReason ?? "busy");
      return;
    }
    this.options.dispatch({ type: "placed", callId: started.call.id, peer: started.call.callee });
    this.audio.startCallAudio(media, true);
    this.audio.setSpeaker(media === "video");
    this.startHeartbeat();
    const ringsFor = ringsForMs(started.call.ringsUntil, this.now());
    this.ringTimer = this.timers.setTimeout(() => void this.hangUp("timeout"), Math.max(1_000, ringsFor));
    this.createPeer(started.iceServers.iceServers);
    try {
      const offer = await this.pc!.createOffer();
      await this.pc!.setLocalDescription(offer);
      this.send({ kind: "offer", payload: { sdp: offer.sdp } });
    } catch {
      void this.hangUp("failed");
    }
  }

  /**
   * Someone is calling you (a realtime event, or the push's link). The call screen rings; nothing
   * about this phone (not even its network address) reaches the caller until you answer.
   */
  async receive(callId: string): Promise<void> {
    let call: CallView;
    try {
      call = (await this.api.getCall(callId, this.token())).call;
    } catch {
      this.finished = true;
      return;
    }
    if (call.state !== "ringing" || call.outgoing || this.finished) {
      this.finished = true;
      return;
    }
    this.callId = call.id;
    this.media = call.media;
    this.options.dispatch({ type: "incoming", callId: call.id, conversationId: call.conversationId, media: call.media, peer: call.caller });
    if (this.options.getState().callId !== call.id) {
      this.finished = true; // already on another call: the caller hears "busy" from the server
      return;
    }
    const ringsFor = ringsForMs(call.ringsUntil, this.now());
    this.audio.startRinging(ringsFor / 1000);
    // The caller's ring time is the server's: past it (plus a moment for the event), it was missed.
    this.ringTimer = this.timers.setTimeout(() => this.finish("missed"), Math.max(1_000, ringsFor + 2_000));
    void this.api.reportRinging(call.id, this.token()).catch(() => undefined);
  }

  /** You answer. */
  async accept(): Promise<void> {
    if (!this.callId || this.outgoing || this.accepted || this.finished) return;
    this.accepted = true;
    this.audio.stopRinging();
    this.clearTimer("ringTimer");
    this.options.dispatch({ type: "answered" });
    if (!(await this.openMedia())) {
      void this.api.declineCall(this.callId, this.token()).catch(() => undefined);
      return;
    }
    let accepted: { call: CallView; iceServers: callsApi.IceServers };
    try {
      accepted = await this.api.acceptCall(this.callId, this.token());
    } catch (error) {
      this.finish(failureReason(error));
      return;
    }
    if (this.finished) return;
    this.audio.startCallAudio(this.media, false);
    this.audio.setSpeaker(this.media === "video");
    this.startHeartbeat();
    this.createPeer(accepted.iceServers.iceServers);
    this.armConnectTimeout();
    await this.fetchSignals();
  }

  async decline(): Promise<void> {
    if (!this.callId || this.finished) return;
    const id = this.callId;
    this.finish("declined");
    await this.api.declineCall(id, this.token()).catch(() => undefined);
  }

  /** You hang up (or the ring time ran out, or the phones couldn't connect). */
  async hangUp(reason: "hangup" | "timeout" | "failed" = "hangup"): Promise<void> {
    if (this.finished) return;
    const id = this.callId;
    const state = this.options.getState();
    this.finish(reason === "timeout" ? "missed" : reason === "failed" ? "failed" : state.phase === "outgoing" ? "cancelled" : "completed");
    if (id) await this.api.endCall(id, reason, this.token()).catch(() => undefined);
  }

  // ---- What the server says ----------------------------------------------------------------

  /** A realtime `call` event about this call. */
  onCallEvent(event: { callId: string; state: string; reason?: string | null; ringing?: boolean }): void {
    if (event.callId !== this.callId || this.finished) return;
    if (event.state === "ended") {
      this.finish((event.reason as EndedBecause | null) ?? "completed");
    } else if (event.state === "active") {
      if (this.outgoing) this.answeredRemotely();
      // Answered on another of your phones: this one stops ringing and steps aside.
      else if (!this.accepted) this.finish("completed", true);
    } else if (event.ringing && this.outgoing) {
      this.options.dispatch({ type: "remoteRinging" });
    }
  }

  /** A realtime `call_signal` event: the other phone sent something. */
  onSignalEvent(callId: string): void {
    if (callId === this.callId && !this.finished) void this.fetchSignals();
  }

  /** The realtime connection came back: events may have been missed. */
  onResync(): void {
    if (this.finished || !this.callId) return;
    void this.fetchSignals();
    void this.beat();
  }

  private answeredRemotely(): void {
    const state = this.options.getState();
    if (state.phase !== "outgoing") return;
    this.clearTimer("ringTimer");
    this.audio.stopRingback();
    this.options.dispatch({ type: "answered" });
    this.armConnectTimeout();
    void this.fetchSignals();
  }

  // ---- Signaling ------------------------------------------------------------------------------

  /** Sends signals strictly in order (an answer never overtakes its candidates). */
  private send(signal: callsApi.CallSignal): void {
    const id = this.callId;
    if (!id) return;
    this.sending = this.sending.then(() => this.api.sendCallSignal(id, signal, this.token())).catch(() => undefined);
  }

  /** Fetches the other phone's new signals; a burst of events is one request at a time. */
  async fetchSignals(): Promise<void> {
    if (this.fetching) {
      this.fetchAgain = true;
      return this.fetching;
    }
    this.fetching = (async () => {
      do {
        this.fetchAgain = false;
        const id = this.callId;
        if (!id || this.finished) return;
        let page: { call: CallView; signals: ReceivedSignal[] };
        try {
          page = await this.api.listCallSignals(id, this.lastSeq, this.token());
        } catch {
          return; // offline for a moment: the next event, resync or heartbeat tries again
        }
        if (page.call.state === "ended") {
          this.finish(page.call.endReason ?? "completed");
          return;
        }
        if (this.outgoing && page.call.state === "active") this.answeredRemotely();
        for (const signal of page.signals) {
          this.lastSeq = Math.max(this.lastSeq, signal.seq);
          await this.apply(signal).catch(() => undefined);
        }
        if (page.signals.length >= 200) this.fetchAgain = true;
      } while (this.fetchAgain);
    })().finally(() => { this.fetching = null; });
    return this.fetching;
  }

  private async apply(signal: ReceivedSignal): Promise<void> {
    const pc = this.pc;
    if (!pc || this.finished) return;
    switch (signal.kind) {
      case "offer": {
        if (this.outgoing) return;
        await pc.setRemoteDescription({ type: "offer", sdp: signal.payload.sdp });
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        this.send({ kind: "answer", payload: { sdp: answer.sdp } });
        await this.flushCandidates();
        return;
      }
      case "answer":
        if (!this.outgoing) return;
        await pc.setRemoteDescription({ type: "answer", sdp: signal.payload.sdp });
        await this.flushCandidates();
        return;
      case "candidate":
        if (!pc.remoteDescription) this.pendingCandidates.push(signal);
        else await pc.addIceCandidate(signal.payload);
        return;
      case "restart":
        if (this.outgoing) await this.restartIce();
        return;
      case "media":
        this.options.dispatch({ type: "remoteMedia", microphone: signal.payload.microphone, camera: signal.payload.camera });
        return;
    }
  }

  private async flushCandidates(): Promise<void> {
    const queued = this.pendingCandidates;
    this.pendingCandidates = [];
    for (const signal of queued) if (signal.kind === "candidate") await this.pc?.addIceCandidate(signal.payload).catch(() => undefined);
  }

  // ---- The connection ---------------------------------------------------------------------------

  /** The microphone, and for video the front camera; false (and the call ended) when refused. */
  private async openMedia(): Promise<boolean> {
    try {
      this.local = await this.options.rtc.getUserMedia({ audio: true, video: this.media === "video" ? VIDEO_CONSTRAINTS : false });
    } catch (error) {
      this.finish(isPermissionError(error) ? "permission" : "error");
      return false;
    }
    if (this.finished) {
      this.releaseLocal();
      return false;
    }
    this.options.onStreams(this.local, this.remote);
    return true;
  }

  private createPeer(iceServers: IceServer[]): void {
    const pc = this.options.rtc.createPeerConnection({ iceServers });
    this.pc = pc;
    for (const track of this.local?.getTracks() ?? []) pc.addTrack(track, this.local!);
    pc.onicecandidate = (event) => {
      const c = event.candidate;
      if (!c) return;
      const init = c.toJSON ? c.toJSON() : c;
      this.send({ kind: "candidate", payload: { candidate: init.candidate, sdpMid: init.sdpMid ?? null, sdpMLineIndex: init.sdpMLineIndex ?? null } });
    };
    pc.ontrack = (event) => {
      const stream = event.streams[0];
      if (stream && stream !== this.remote) {
        this.remote = stream;
        this.options.onStreams(this.local, this.remote);
      }
    };
    pc.onconnectionstatechange = () => this.onConnectionState(pc.connectionState);
  }

  private onConnectionState(state: string): void {
    if (this.finished) return;
    if (state === "connected") {
      this.clearTimer("connectTimer");
      this.clearTimer("restartTimer");
      this.clearTimer("giveUpTimer");
      this.audio.stopRingback();
      if (!this.everConnected) {
        this.everConnected = true;
        const peer = this.options.getState().peer;
        this.audio.startOngoingCall(peer?.displayName || (peer ? `@${peer.username}` : "Katkee"), this.media === "video");
      }
      this.options.dispatch({ type: "mediaConnected", at: this.now() });
    } else if (state === "disconnected" || state === "failed") {
      if (!this.everConnected) return; // still connecting: the connect timeout decides
      this.options.dispatch({ type: "mediaInterrupted" });
      if (!this.giveUpTimer) this.giveUpTimer = this.timers.setTimeout(() => void this.hangUp("hangup"), RECONNECT_GIVE_UP_MS);
      const restart = () => (this.outgoing ? void this.restartIce() : this.send({ kind: "restart", payload: {} }));
      this.clearTimer("restartTimer");
      if (state === "failed") restart();
      else this.restartTimer = this.timers.setTimeout(restart, RESTART_AFTER_MS);
    }
  }

  /** The caller renegotiates the network path, with fresh TURN credentials (they may have expired). */
  private async restartIce(): Promise<void> {
    const pc = this.pc;
    if (!pc || this.finished) return;
    try {
      const fresh = await this.api.getIceServers(this.token());
      pc.setConfiguration({ iceServers: fresh.iceServers });
    } catch {
      // Keep the servers it has; they may still work.
    }
    try {
      const offer = await pc.createOffer({ iceRestart: true });
      await pc.setLocalDescription(offer);
      this.send({ kind: "offer", payload: { sdp: offer.sdp } });
    } catch {
      // The give-up timer ends the call if nothing heals it.
    }
  }

  private armConnectTimeout(): void {
    this.clearTimer("connectTimer");
    this.connectTimer = this.timers.setTimeout(() => { if (!this.everConnected) void this.hangUp("failed"); }, CONNECT_TIMEOUT_MS);
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = this.timers.setInterval(() => void this.beat(), HEARTBEAT_MS);
  }

  private async beat(): Promise<void> {
    const id = this.callId;
    if (!id || this.finished) return;
    try {
      const { call } = await this.api.callHeartbeat(id, this.token());
      if (call.state === "ended") this.finish(call.endReason ?? "completed");
      else if (this.outgoing && call.state === "active") this.answeredRemotely();
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) this.finish("completed"); // blocked, or the call is gone
    }
  }

  // ---- Controls ------------------------------------------------------------------------------------

  private tellMedia(): void {
    const state = this.options.getState();
    if (this.callId && (this.accepted || this.outgoing)) {
      this.send({ kind: "media", payload: { microphone: state.microphoneOn, camera: state.cameraOn && !this.cameraPausedForBackground } });
    }
  }

  toggleMicrophone(): void {
    this.options.dispatch({ type: "toggleMicrophone" });
    const on = this.options.getState().microphoneOn;
    for (const track of this.local?.getAudioTracks() ?? []) track.enabled = on;
    this.tellMedia();
  }

  toggleCamera(): void {
    this.options.dispatch({ type: "toggleCamera" });
    const on = this.options.getState().cameraOn;
    for (const track of this.local?.getVideoTracks() ?? []) track.enabled = on && !this.cameraPausedForBackground;
    this.tellMedia();
  }

  toggleSpeaker(): void {
    this.options.dispatch({ type: "toggleSpeaker" });
    this.audio.setSpeaker(this.options.getState().speakerOn);
  }

  flipCamera(): void {
    const track = this.local?.getVideoTracks()[0];
    if (!track) return;
    this.options.dispatch({ type: "flipCamera" });
    const facing = this.options.getState().frontCamera ? "user" : "environment";
    if (track.applyConstraints) void track.applyConstraints({ facingMode: facing }).catch(() => track._switchCamera?.());
    else track._switchCamera?.();
  }

  /**
   * The app went to the background or came back. Sound carries on (a foreground service on
   * Android, the audio background mode on iOS); the camera can't film from the background, so
   * the other person sees "camera off" until you return.
   */
  setBackground(background: boolean): void {
    this.options.dispatch({ type: "background", value: background });
    if (this.media !== "video" || this.finished) return;
    const wanted = this.options.getState().cameraOn;
    this.cameraPausedForBackground = background && wanted;
    for (const track of this.local?.getVideoTracks() ?? []) track.enabled = wanted && !background;
    if (wanted) this.tellMedia();
  }

  // ---- Ending -----------------------------------------------------------------------------------------

  private clearTimer(name: "ringTimer" | "connectTimer" | "restartTimer" | "giveUpTimer"): void {
    if (this[name] !== null) this.timers.clearTimeout(this[name]);
    this[name] = null;
  }

  private releaseLocal(): void {
    for (const track of this.local?.getTracks() ?? []) {
      try { track.stop(); } catch { /* already stopped */ }
    }
    try { this.local?.release?.(); } catch { /* already released */ }
    this.local = null;
  }

  /** Tears everything down once. `silently`: answered elsewhere, so no "Call ended" screen. */
  finish(because: EndedBecause, silently = false): void {
    if (this.finished) return;
    this.finished = true;
    for (const name of ["ringTimer", "connectTimer", "restartTimer", "giveUpTimer"] as const) this.clearTimer(name);
    if (this.heartbeatTimer !== null) this.timers.clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
    if (this.pc) {
      this.pc.onicecandidate = null;
      this.pc.ontrack = null;
      this.pc.onconnectionstatechange = null;
      try { this.pc.close(); } catch { /* already closed */ }
    }
    this.pc = null;
    this.releaseLocal();
    this.remote = null;
    this.audio.stopRinging();
    this.audio.stopCallAudio();
    this.audio.stopOngoingCall();
    this.options.onStreams(null, null);
    this.options.dispatch(silently ? { type: "reset" } : { type: "ended", because, at: this.now() });
  }
}
