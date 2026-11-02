import React from "react";
import { act, create } from "react-test-renderer";
import type { CallView, ReceivedSignal } from "../src/api/calls";
import { ApiError } from "../src/api/client";
import { CallController, type Timers } from "../src/calls/CallController";
import { callReducer, callStatusText, formatCallDuration, IDLE, type CallAction, type CallState } from "../src/calls/callMachine";
import { CallScreen } from "../src/calls/CallScreen";
import type { CallControls } from "../src/calls/CallContext";
import { webRtc } from "../src/calls/webrtc";
import { callLineText, isMissedCall } from "../src/models/callLines";
import { callIdFromLink } from "../src/navigation/profileLinks";

jest.mock("../src/state/AuthContext", () => ({ useAuth: () => ({ accessToken: "token" }) }));

const peer = { id: "u2", username: "asha", displayName: "Asha", avatarMediaId: null, verified: false };
const me = { id: "u1", username: "dev", displayName: "Dev", avatarMediaId: null, verified: false };

function view(overrides: Partial<CallView> = {}): CallView {
  return {
    id: "call-1", conversationId: "conv-1", media: "audio", state: "ringing", endReason: null, outgoing: true,
    caller: me, callee: peer, createdAt: new Date(0).toISOString(), ringing: false, answeredAt: null, endedAt: null,
    ringsUntil: new Date(45_000).toISOString(), durationSeconds: null, ...overrides,
  };
}

const run = (actions: CallAction[], from: CallState = IDLE) => actions.reduce(callReducer, from);

describe("the call state machine", () => {
  it("goes from calling to ringing to connected to ended with the call's length", () => {
    let s = run([{ type: "outgoing", conversationId: "c", media: "audio", peer }]);
    expect(callStatusText(s, 0)).toBe("Calling…");
    s = run([{ type: "placed", callId: "x", peer }, { type: "remoteRinging" }], s);
    expect(callStatusText(s, 0)).toBe("Ringing…");
    s = run([{ type: "answered" }], s);
    expect(callStatusText(s, 0)).toBe("Connecting…");
    s = run([{ type: "mediaConnected", at: 1_000 }], s);
    expect(callStatusText(s, 1_000 + 252_000)).toBe("4:12");
    s = run([{ type: "mediaInterrupted" }], s);
    expect(callStatusText(s, 0)).toBe("Reconnecting…");
    s = run([{ type: "mediaConnected", at: 99_000 }], s);
    expect(s.connectedAt).toBe(1_000); // the timer keeps counting from the first connection
    s = run([{ type: "ended", because: "completed", at: 1_000 + 3_725_000 }], s);
    expect(callStatusText(s, 0)).toBe("Call ended · 1:02:05");
  });

  it("a video call starts with the camera and loudspeaker on; a voice call on the earpiece", () => {
    const videoCall = run([{ type: "incoming", callId: "x", conversationId: "c", media: "video", peer }]);
    expect([videoCall.cameraOn, videoCall.speakerOn, callStatusText(videoCall, 0)]).toEqual([true, true, "Incoming video call"]);
    const voice = run([{ type: "outgoing", conversationId: "c", media: "audio", peer }]);
    expect([voice.cameraOn, voice.speakerOn]).toEqual([false, false]);
    expect(run([{ type: "toggleCamera" }], voice).cameraOn).toBe(false); // no camera on a voice call
  });

  it("never lets a second call replace the one in progress", () => {
    const onCall = run([{ type: "outgoing", conversationId: "c", media: "audio", peer }, { type: "placed", callId: "first", peer }]);
    expect(run([{ type: "incoming", callId: "second", conversationId: "d", media: "video", peer: me }], onCall).callId).toBe("first");
  });

  it("says why a call ended", () => {
    const placed = run([{ type: "outgoing", conversationId: "c", media: "audio", peer }]);
    const said = (because: Parameters<typeof callReducer>[1] & { type: "ended" }) => callStatusText(callReducer(placed, because), 0);
    expect(said({ type: "ended", because: "declined", at: 0 })).toBe("Declined");
    expect(said({ type: "ended", because: "busy", at: 0 })).toBe("On another call");
    expect(said({ type: "ended", because: "missed", at: 0 })).toBe("No answer");
    expect(said({ type: "ended", because: "failed", at: 0 })).toBe("Couldn't connect");
    expect(said({ type: "ended", because: "permission", at: 0 })).toBe("Microphone access needed");
  });

  it("an incoming call can't be minimized before it's answered", () => {
    const ringing = run([{ type: "incoming", callId: "x", conversationId: "c", media: "audio", peer }]);
    expect(run([{ type: "minimize" }], ringing).minimized).toBe(false);
    expect(run([{ type: "answered" }, { type: "minimize" }], ringing).minimized).toBe(true);
  });

  it("formats durations", () => {
    expect([formatCallDuration(0), formatCallDuration(59), formatCallDuration(252), formatCallDuration(3600)]).toEqual(["0:00", "0:59", "4:12", "1:00:00"]);
  });
});

describe("call lines in the chat", () => {
  const line = (outcome: "completed" | "missed" | "cancelled" | "declined" | "busy" | "failed", media: "audio" | "video" = "audio", durationSeconds: number | null = null) =>
    ({ type: "call" as const, callId: "x", media, outcome, durationSeconds });
  it("read like WhatsApp's, from each side", () => {
    expect(callLineText(line("completed", "video", 252), true)).toBe("Video call · 4:12");
    expect(callLineText(line("completed", "audio", 61), false)).toBe("Voice call · 1:01");
    expect(callLineText(line("missed"), false)).toBe("Missed voice call");
    expect(callLineText(line("missed", "video"), true)).toBe("Video call · No answer");
    expect(callLineText(line("cancelled"), false)).toBe("Missed voice call");
    expect(callLineText(line("declined"), true)).toBe("Voice call · Declined");
    expect(callLineText(line("busy"), true)).toBe("Voice call · On another call");
    expect(isMissedCall(line("missed"), false)).toBe(true);
    expect(isMissedCall(line("missed"), true)).toBe(false);
  });

  it("only a well-formed call link opens the call screen", () => {
    expect(callIdFromLink("katkee://call/0E6A1C1B-1111-4222-8333-444455556666")).toBe("0e6a1c1b-1111-4222-8333-444455556666");
    expect(callIdFromLink("katkee://conversation/0e6a1c1b-1111-4222-8333-444455556666")).toBeNull();
    expect(callIdFromLink("https://evil.example/call/0e6a1c1b-1111-4222-8333-444455556666")).toBeNull();
  });
});

/** A fake clock: timers run when the test says so. */
function fakeTimers(): Timers & { advance: (ms: number) => void } {
  let now = 0;
  let next = 1;
  const pending = new Map<number, { at: number; fn: () => void; every: number | null }>();
  return {
    setTimeout: (fn, ms) => { const id = next++; pending.set(id, { at: now + ms, fn, every: null }); return id; },
    clearTimeout: (id) => { pending.delete(id as number); },
    setInterval: (fn, ms) => { const id = next++; pending.set(id, { at: now + ms, fn, every: ms }); return id; },
    clearInterval: (id) => { pending.delete(id as number); },
    advance(ms) {
      const until = now + ms;
      for (;;) {
        const due = [...pending.entries()].filter(([, t]) => t.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        const [id, t] = due;
        now = t.at;
        if (t.every) t.at += t.every; else pending.delete(id);
        t.fn();
      }
      now = until;
    },
  };
}

const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

function harness() {
  let state: CallState = IDLE;
  const sent: Array<{ kind: string; payload: unknown }> = [];
  const inbox: ReceivedSignal[] = [];
  let serverCall = view();
  const api = {
    startCall: jest.fn(async () => ({ call: serverCall, iceServers: { iceServers: [{ urls: ["stun:stun.example:3478"] }], ttlSeconds: 3600 } })),
    getCall: jest.fn(async () => ({ call: serverCall })),
    reportRinging: jest.fn(async () => ({ call: serverCall })),
    acceptCall: jest.fn(async () => ({ call: { ...serverCall, state: "active" as const }, iceServers: { iceServers: [{ urls: ["turn:turn.example"], username: "u", credential: "p" }], ttlSeconds: 3600 } })),
    declineCall: jest.fn(async () => ({ call: serverCall })),
    endCall: jest.fn(async () => ({ call: serverCall })),
    callHeartbeat: jest.fn(async () => ({ call: serverCall })),
    sendCallSignal: jest.fn(async (_id: string, signal: { kind: string; payload: unknown }) => { sent.push(signal); return { seq: sent.length }; }),
    listCallSignals: jest.fn(async (_id: string, after: number) => ({ call: serverCall, signals: inbox.filter((s) => s.seq > after) })),
    getIceServers: jest.fn(async () => ({ iceServers: [{ urls: ["turn:fresh.example"], username: "f", credential: "g" }], ttlSeconds: 3600 })),
  };
  const audio = {
    startRinging: jest.fn(), stopRinging: jest.fn(), startCallAudio: jest.fn(), stopRingback: jest.fn(), setSpeaker: jest.fn(),
    stopCallAudio: jest.fn(), startOngoingCall: jest.fn(), stopOngoingCall: jest.fn(),
  };
  const timers = fakeTimers();
  const streams: Array<[unknown, unknown]> = [];
  const controller = new CallController({
    rtc: webRtc()!,
    myUserId: "u1",
    token: () => "token",
    dispatch: (action) => { state = callReducer(state, action); },
    getState: () => state,
    onStreams: (local, remote) => streams.push([local, remote]),
    api: api as never,
    audio: audio as never,
    timers,
    now: () => 0,
  });
  const peers = (globalThis as unknown as { __webrtc: { peers: Array<Record<string, any>> } }).__webrtc.peers;
  return {
    controller, api, audio, timers, sent, inbox, streams,
    get state() { return state; },
    setServerCall: (next: Partial<CallView>) => { serverCall = { ...serverCall, ...next }; },
    lastPeer: () => peers[peers.length - 1]!,
  };
}

beforeEach(() => {
  (globalThis as unknown as { __webrtc: { peers: unknown[]; getUserMediaError: unknown } }).__webrtc.peers.length = 0;
  (globalThis as unknown as { __webrtc: { getUserMediaError: unknown } }).__webrtc.getUserMediaError = null;
});

describe("placing a call", () => {
  it("offers with the invite, connects once answered, and hangs up", async () => {
    const h = harness();
    await h.controller.place("conv-1", "audio", peer);
    expect(h.api.startCall).toHaveBeenCalledWith("conv-1", "audio", "token");
    expect(h.state.phase).toBe("outgoing");
    expect(h.audio.startCallAudio).toHaveBeenCalledWith("audio", true); // ringback
    await flush();
    expect(h.sent.map((s) => s.kind)).toEqual(["offer"]);
    const pc = h.lastPeer();
    expect(pc.configuration.iceServers[0].urls).toEqual(["stun:stun.example:3478"]);
    expect(pc.tracks.map((t: { kind: string }) => t.kind)).toEqual(["audio"]);

    pc.onicecandidate({ candidate: { candidate: "candidate:1", sdpMid: "0", sdpMLineIndex: 0 } });
    await flush();
    expect(h.sent[1]).toEqual({ kind: "candidate", payload: { candidate: "candidate:1", sdpMid: "0", sdpMLineIndex: 0 } });

    h.controller.onCallEvent({ callId: "call-1", state: "ringing", ringing: true });
    expect(h.state.remoteRinging).toBe(true);

    h.setServerCall({ state: "active" });
    h.inbox.push({ seq: 1, kind: "candidate", payload: { candidate: "candidate:remote", sdpMid: "0", sdpMLineIndex: 0 } });
    h.inbox.push({ seq: 2, kind: "answer", payload: { sdp: "v=0 answer" } });
    h.controller.onCallEvent({ callId: "call-1", state: "active" });
    await flush();
    expect(h.state.phase).toBe("connecting");
    expect(h.audio.stopRingback).toHaveBeenCalled();
    expect(pc.remoteDescription).toEqual({ type: "answer", sdp: "v=0 answer" });
    expect(pc.candidates).toEqual([{ candidate: "candidate:remote", sdpMid: "0", sdpMLineIndex: 0 }]); // held until the answer arrived

    pc.__setState("connected");
    expect(h.state.phase).toBe("active");
    expect(h.audio.startOngoingCall).toHaveBeenCalledWith("Asha", false);

    await h.controller.hangUp();
    expect(h.api.endCall).toHaveBeenCalledWith("call-1", "hangup", "token");
    expect(h.state.phase).toBe("ended");
    expect(h.state.endedBecause).toBe("completed");
    expect(pc.closed).toBe(true);
    expect(h.audio.stopCallAudio).toHaveBeenCalled();
    expect(h.audio.stopOngoingCall).toHaveBeenCalled();
    expect(h.streams[h.streams.length - 1]).toEqual([null, null]);
  });

  it("gives up after the ring time as 'No answer'", async () => {
    const h = harness();
    await h.controller.place("conv-1", "audio", peer);
    h.timers.advance(44_000);
    expect(h.state.phase).toBe("outgoing");
    h.timers.advance(2_000);
    await flush();
    expect(h.api.endCall).toHaveBeenCalledWith("call-1", "timeout", "token");
    expect(h.state.endedBecause).toBe("missed");
  });

  it("says when the other person is on another call", async () => {
    const h = harness();
    h.setServerCall({ state: "ended", endReason: "busy" });
    h.api.startCall.mockResolvedValueOnce({ call: view({ state: "ended", endReason: "busy" }), iceServers: null as never });
    await h.controller.place("conv-1", "audio", peer);
    expect(h.state.endedBecause).toBe("busy");
    expect(h.lastPeer()).toBeUndefined();
  });

  it("stops at a refused microphone, before ringing anyone", async () => {
    const h = harness();
    (globalThis as unknown as { __webrtc: { getUserMediaError: unknown } }).__webrtc.getUserMediaError = Object.assign(new Error("denied"), { name: "NotAllowedError" });
    await h.controller.place("conv-1", "video", peer);
    expect(h.api.startCall).not.toHaveBeenCalled();
    expect(h.state.endedBecause).toBe("permission");
  });

  it("says calls aren't available when the server refuses (blocked, calls off)", async () => {
    const h = harness();
    h.api.startCall.mockRejectedValueOnce(new ApiError(404, "This person can't be called."));
    await h.controller.place("conv-1", "audio", peer);
    expect(h.state.endedBecause).toBe("unavailable");
  });

  it("the other side hanging up ends the call here", async () => {
    const h = harness();
    await h.controller.place("conv-1", "audio", peer);
    h.controller.onCallEvent({ callId: "call-1", state: "ended", reason: "declined" });
    expect(h.state.endedBecause).toBe("declined");
    expect(h.lastPeer().closed).toBe(true);
    h.controller.onCallEvent({ callId: "call-1", state: "ended", reason: "completed" }); // once only
    expect(h.state.endedBecause).toBe("declined");
  });
});

describe("answering a call", () => {
  it("rings, says nothing until answered, then answers the caller's offer", async () => {
    const h = harness();
    h.setServerCall({ outgoing: false, media: "video" });
    await h.controller.receive("call-1");
    expect(h.state.phase).toBe("incoming");
    expect(h.audio.startRinging).toHaveBeenCalled();
    expect(h.api.reportRinging).toHaveBeenCalledWith("call-1", "token");
    expect(h.lastPeer()).toBeUndefined(); // no connection (and no address) before answering

    h.inbox.push({ seq: 1, kind: "offer", payload: { sdp: "v=0 offer" } });
    h.inbox.push({ seq: 2, kind: "candidate", payload: { candidate: "candidate:caller", sdpMid: "0", sdpMLineIndex: 0 } });
    h.setServerCall({ state: "active" });
    await h.controller.accept();
    await flush();
    expect(h.audio.stopRinging).toHaveBeenCalled();
    const pc = h.lastPeer();
    expect(pc.configuration.iceServers[0].urls).toEqual(["turn:turn.example"]);
    expect(pc.tracks.map((t: { kind: string }) => t.kind)).toEqual(["audio", "video"]);
    expect(pc.remoteDescription).toEqual({ type: "offer", sdp: "v=0 offer" });
    expect(pc.candidates).toHaveLength(1);
    expect(h.sent[0]).toEqual({ kind: "answer", payload: { sdp: "v=0 answer" } });
    expect(h.state.phase).toBe("connecting");
  });

  it("answered on another phone: this one stops ringing without a 'Call ended' screen", async () => {
    const h = harness();
    h.setServerCall({ outgoing: false });
    await h.controller.receive("call-1");
    h.controller.onCallEvent({ callId: "call-1", state: "active" });
    expect(h.state.phase).toBe("idle");
    expect(h.audio.stopRinging).toHaveBeenCalled();
  });

  it("a call nobody answers stops ringing when its time is up", async () => {
    const h = harness();
    h.setServerCall({ outgoing: false });
    await h.controller.receive("call-1");
    h.timers.advance(48_000);
    expect(h.state.endedBecause).toBe("missed");
  });

  it("declining tells the server", async () => {
    const h = harness();
    h.setServerCall({ outgoing: false });
    await h.controller.receive("call-1");
    await h.controller.decline();
    expect(h.api.declineCall).toHaveBeenCalledWith("call-1", "token");
    expect(h.state.endedBecause).toBe("declined");
  });
});

describe("during a call", () => {
  async function connected(media: "audio" | "video" = "audio") {
    const h = harness();
    h.setServerCall({ media });
    await h.controller.place("conv-1", media, peer);
    h.setServerCall({ state: "active" });
    h.inbox.push({ seq: 1, kind: "answer", payload: { sdp: "v=0 answer" } });
    h.controller.onCallEvent({ callId: "call-1", state: "active" });
    await flush();
    h.lastPeer().__setState("connected");
    h.sent.length = 0;
    return h;
  }

  it("reconnects after a network change with fresh TURN credentials, and gives up after 30 s", async () => {
    const h = await connected();
    const pc = h.lastPeer();
    pc.__setState("disconnected");
    expect(h.state.phase).toBe("reconnecting");
    h.timers.advance(3_000);
    await flush();
    expect(h.api.getIceServers).toHaveBeenCalled();
    expect(pc.configuration.iceServers[0].urls).toEqual(["turn:fresh.example"]);
    expect(h.sent).toEqual([{ kind: "offer", payload: { sdp: "v=0 offer restart" } }]);
    pc.__setState("connected");
    expect(h.state.phase).toBe("active");

    pc.__setState("failed");
    h.timers.advance(31_000);
    await flush();
    expect(h.state.phase).toBe("ended");
    expect(h.api.endCall).toHaveBeenCalledWith("call-1", "hangup", "token");
  });

  it("mute and camera off stop the tracks and tell the other phone", async () => {
    const h = await connected("video");
    h.controller.toggleMicrophone();
    h.controller.toggleCamera();
    await flush();
    expect(h.state.microphoneOn).toBe(false);
    expect(h.state.cameraOn).toBe(false);
    expect(h.sent[h.sent.length - 1]).toEqual({ kind: "media", payload: { microphone: false, camera: false } });
    h.controller.toggleSpeaker();
    expect(h.audio.setSpeaker).toHaveBeenLastCalledWith(false); // video starts on the loudspeaker
  });

  it("the camera pauses while the app is in the background", async () => {
    const h = await connected("video");
    h.controller.setBackground(true);
    await flush();
    expect(h.sent[h.sent.length - 1]).toEqual({ kind: "media", payload: { microphone: true, camera: false } });
    h.controller.setBackground(false);
    await flush();
    expect(h.sent[h.sent.length - 1]).toEqual({ kind: "media", payload: { microphone: true, camera: true } });
  });

  it("the other person's mute shows here, and a missed hang-up is caught by the heartbeat", async () => {
    const h = await connected();
    h.inbox.push({ seq: 5, kind: "media", payload: { microphone: false, camera: false } });
    h.controller.onSignalEvent("call-1");
    await flush();
    expect(h.state.remoteMicrophoneOn).toBe(false);
    h.setServerCall({ state: "ended", endReason: "completed" });
    h.timers.advance(15_000);
    await flush();
    expect(h.state.phase).toBe("ended");
  });
});

describe("the call screen", () => {
  const controls = (): CallControls => ({
    accept: jest.fn(), decline: jest.fn(), hangUp: jest.fn(), toggleMicrophone: jest.fn(), toggleCamera: jest.fn(),
    toggleSpeaker: jest.fn(), flipCamera: jest.fn(), minimize: jest.fn(), restore: jest.fn(),
  });
  const byLabel = (tree: ReturnType<typeof create>, label: string) => tree.root.find((n) => n.props.accessibilityLabel === label && typeof n.props.onPress === "function");
  // Unmounted after each test, so the call timer and the ringing pulse stop with it.
  const mounted: Array<ReturnType<typeof create>> = [];
  afterEach(() => { act(() => { mounted.splice(0).forEach((t) => t.unmount()); }); });
  const texts = (tree: ReturnType<typeof create>) => tree.root.findAll((n) => (n.type as unknown) === "Text").map((n) => [n.props.children].flat().join(""));

  it("an incoming video call offers Decline and Accept", async () => {
    const c = controls();
    const state = run([{ type: "incoming", callId: "x", conversationId: "c", media: "video", peer }]);
    let tree!: ReturnType<typeof create>;
    await act(async () => { tree = create(<CallScreen state={state} controls={c} local={null} remote={null} />); mounted.push(tree); });
    expect(texts(tree)).toEqual(expect.arrayContaining(["Incoming video call", "Decline", "Accept"]));
    act(() => byLabel(tree, "Accept video call").props.onPress());
    act(() => byLabel(tree, "Decline call").props.onPress());
    expect(c.accept).toHaveBeenCalled();
    expect(c.decline).toHaveBeenCalled();
    expect(tree.root.findAll((n) => n.props.accessibilityLabel === "Mute microphone")).toHaveLength(0);
  });

  it("a video call in progress shows both videos, the timer and every control", async () => {
    const c = controls();
    const state = run([
      { type: "outgoing", conversationId: "c", media: "video", peer }, { type: "placed", callId: "x", peer },
      { type: "answered" }, { type: "mediaConnected", at: Date.now() - 65_000 }, { type: "toggleMicrophone" },
    ]);
    const stream = (url: string) => ({ toURL: () => url, getTracks: () => [], getAudioTracks: () => [], getVideoTracks: () => [] });
    let tree!: ReturnType<typeof create>;
    await act(async () => { tree = create(<CallScreen state={state} controls={c} local={stream("local")} remote={stream("remote")} />); mounted.push(tree); });
    const videos = tree.root.findAll((n) => (n.type as unknown) === "RTCView");
    expect(videos.map((v) => v.props.streamURL).sort()).toEqual(["local", "remote"]);
    expect(videos.find((v) => v.props.streamURL === "local")!.props.mirror).toBe(true);
    expect(texts(tree).some((t) => /^1:0\d$/.test(t))).toBe(true);
    for (const label of ["Switch camera", "Turn off camera", "Unmute microphone", "Turn off loudspeaker", "End call", "Minimize call"]) act(() => byLabel(tree, label).props.onPress());
    expect([c.flipCamera, c.toggleCamera, c.toggleMicrophone, c.toggleSpeaker, c.hangUp, c.minimize].every((f) => (f as jest.Mock).mock.calls.length === 1)).toBe(true);
    expect(tree.root.findAll((n) => n.props.accessibilityLabel === "Unmute microphone").some((n) => n.props.accessibilityState?.selected === true)).toBe(true);
  });

  it("minimized, it's a pill that returns to the call", async () => {
    const c = controls();
    const state = run([{ type: "outgoing", conversationId: "c", media: "audio", peer }, { type: "minimize" }]);
    let tree!: ReturnType<typeof create>;
    await act(async () => { tree = create(<CallScreen state={state} controls={c} local={null} remote={null} />); mounted.push(tree); });
    act(() => byLabel(tree, "Call with Asha, Calling…").props.onPress());
    expect(c.restore).toHaveBeenCalled();
  });

  it("says when the call ended and why", async () => {
    const state = run([{ type: "outgoing", conversationId: "c", media: "audio", peer }, { type: "ended", because: "busy", at: 0 }]);
    let tree!: ReturnType<typeof create>;
    await act(async () => { tree = create(<CallScreen state={state} controls={controls()} local={null} remote={null} />); mounted.push(tree); });
    expect(texts(tree)).toContain("On another call");
    expect(tree.root.findAll((n) => n.props.accessibilityLabel === "End call")).toHaveLength(0);
  });
});
