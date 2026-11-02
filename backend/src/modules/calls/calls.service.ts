/**
 * One-to-one voice and video calls, between the two people of a 1:1 chat, under the rules of
 * sending a message there: both still in it, no block either way, and the other account active.
 * Those rules are checked when a call starts, when it's answered and on every heartbeat, so a
 * block ends a call in progress within one heartbeat.
 *
 * The server is the referee of the call's state, never a party to its media:
 *
 *   ringing ──accept──▶ active ──end──▶ ended (completed)
 *      │                  └──phones gone quiet──▶ ended (completed, at the last sign of life)
 *      ├──caller ends──▶ ended (cancelled; "missed" once the ring time is up)
 *      ├──callee declines──▶ ended (declined)
 *      └──nobody answers in CALLS_RING_SECONDS──▶ ended (missed)
 *   (the callee already on a call: ended (busy) at once)
 *
 * Signaling (SDP offer and answer, ICE candidates) is relayed through call_signals in order:
 * the caller offers with the invite, so the call connects quickly once answered, but the callee's
 * phone sends nothing (and reveals no network address) until its person answers.
 */
import { config } from "../../config/env";
import { HttpError } from "../../http/errors";
import { enforceAction } from "../safety/limits";
import * as usersRepo from "../users/users.repository";
import * as socialRepo from "../social/social.repository";
import { requireParticipant } from "../conversations/conversations.service";
import { markRead } from "../conversations/conversations.repository";
import { iceServersFor, type IceServers } from "./ice-servers";
import * as callsRepo from "./calls.repository";
import type { CallEndReason, CallMedia, CallPerson, CallRow, SignalKind, SignalRow } from "./calls.repository";

/** Phones send a heartbeat this often during a call; one not heard from for STALE_SECONDS has gone. */
export const HEARTBEAT_SECONDS = 15;
export const STALE_SECONDS = 60;
/** The ring time is judged by the server's clock plus this much, so a caller's own timeout wins. */
const RING_GRACE_SECONDS = 5;
/** Signals each phone may send in one call: a few hundred covers ICE restarts after network changes. */
export const MAX_SIGNALS_PER_PHONE = 400;
const MAX_SDP_LENGTH = 12_000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface CallView {
  id: string;
  conversationId: string;
  media: CallMedia;
  state: CallRow["state"];
  endReason: CallEndReason | null;
  /** Whether the viewer placed the call. */
  outgoing: boolean;
  caller: CallPerson | null;
  callee: CallPerson | null;
  createdAt: string;
  /** The callee's phone is ringing. */
  ringing: boolean;
  answeredAt: string | null;
  endedAt: string | null;
  /** When the ring time runs out (a ringing call). */
  ringsUntil: string | null;
  durationSeconds: number | null;
}

function notAvailable(): never {
  throw new HttpError(404, "Calls aren't available.");
}

async function toView(call: CallRow, viewerId: string): Promise<CallView> {
  const people = await callsRepo.findCallPeople(call);
  const answered = call.answeredAt ? new Date(call.answeredAt).getTime() : null;
  return {
    id: call.id,
    conversationId: call.conversationId,
    media: call.media,
    state: call.state,
    endReason: call.endReason,
    outgoing: call.callerId === viewerId,
    caller: people.caller,
    callee: people.callee,
    createdAt: call.createdAt,
    ringing: call.ringingAt !== null,
    answeredAt: call.answeredAt,
    endedAt: call.endedAt,
    ringsUntil: call.state === "ringing" ? new Date(new Date(call.createdAt).getTime() + config.calls.ringSeconds * 1000).toISOString() : null,
    durationSeconds: answered !== null && call.endedAt && call.endReason === "completed" ? Math.max(0, Math.floor((new Date(call.endedAt).getTime() - answered) / 1000)) : null,
  };
}

/** The other person in the chat, if the viewer may call them now (the rules of sending them a message). */
async function requireCallable(viewerId: string, conversationId: string): Promise<{ otherId: string }> {
  if (!config.calls.enabled) notAvailable();
  const conversation = await requireParticipant(conversationId, viewerId);
  if (conversation.kind !== "direct") throw new HttpError(422, "Calls are for one-to-one chats.");
  const otherId = conversation.userAId === viewerId ? conversation.userBId! : conversation.userAId!;
  const other = await usersRepo.findUserById(otherId);
  // Blocked either way looks like an account that's gone, as it does everywhere else.
  if (!other || !other.isActive || (await socialRepo.anyBlockBetween(viewerId, otherId))) throw new HttpError(404, "This person can't be called.");
  return { otherId };
}

/** Whether the viewer can call the other person in this 1:1 chat (the chat header's buttons). */
export async function callsAvailableWith(viewerId: string, otherId: string): Promise<boolean> {
  if (!config.calls.enabled) return false;
  const other = await usersRepo.findUserById(otherId);
  return !!other && other.isActive && !(await socialRepo.anyBlockBetween(viewerId, otherId));
}

/** A call the viewer is on (as caller or callee); anyone else gets a 404. */
async function requireCall(viewerId: string, callId: string): Promise<CallRow> {
  if (!config.calls.enabled) notAvailable();
  const call = UUID_RE.test(callId) ? await callsRepo.findCall(callId) : null;
  if (!call || (call.callerId !== viewerId && call.calleeId !== viewerId)) throw new HttpError(404, "Call not found.");
  return call;
}

/** Why a call nobody ended has to end now, or null while it's still alive. */
function abandonment(call: CallRow, nowMs = Date.now()): { reason: CallEndReason; stale: boolean } | null {
  if (call.state === "ringing" && nowMs - new Date(call.createdAt).getTime() > (config.calls.ringSeconds + RING_GRACE_SECONDS) * 1000) return { reason: "missed", stale: false };
  if (call.state === "active") {
    const seen = Math.min(new Date(call.callerSeenAt).getTime(), new Date(call.calleeSeenAt ?? call.callerSeenAt).getTime());
    if (nowMs - seen > STALE_SECONDS * 1000) return { reason: "completed", stale: true };
  }
  return null;
}

/**
 * Ends a call and leaves its line in the chat. The line doesn't make the chat unread for the
 * caller (it's their own) or for a callee who answered or declined; only a missed call does.
 */
async function finish(call: CallRow, reason: CallEndReason, endedBy: string | null, stale = false): Promise<CallRow> {
  const ended = await callsRepo.endCall(call.id, reason, endedBy, stale);
  if (!ended) return (await callsRepo.findCall(call.id)) ?? call; // someone else ended it first
  await markRead(ended.conversationId, ended.callerId);
  if (ended.answeredAt || reason === "declined") await markRead(ended.conversationId, ended.calleeId);
  return ended;
}

/** The call as it stands, ending it first when nobody else will (rang out, or both phones went quiet). */
async function current(call: CallRow): Promise<CallRow> {
  const gone = abandonment(call);
  return gone ? finish(call, gone.reason, null, gone.stale) : call;
}

/** Ends whatever calls the phones abandoned. The worker runs this every few seconds (call-timeouts.ts). */
export async function endAbandonedCalls(userIds: string[] | null = null): Promise<number> {
  const calls = await callsRepo.abandonedCalls(config.calls.ringSeconds + RING_GRACE_SECONDS, STALE_SECONDS, userIds);
  let ended = 0;
  for (const call of calls) {
    const gone = abandonment(call);
    if (!gone) continue;
    await finish(call, gone.reason, null, gone.stale);
    ended++;
  }
  return ended;
}

export interface StartedCall {
  call: CallView;
  /** Null when the call ended at once (the other person is on another call). */
  iceServers: IceServers | null;
}

/** Places a call in a 1:1 chat. 409 `in_call` when the viewer is already on one. */
export async function startCall(viewerId: string, conversationId: string, media: CallMedia): Promise<StartedCall> {
  const { otherId } = await requireCallable(viewerId, conversationId);
  await enforceAction(viewerId, "call");
  // A call either of them abandoned (an app killed mid-call) mustn't make them look busy.
  await endAbandonedCalls([viewerId, otherId]);
  const result = await callsRepo.createCall(conversationId, viewerId, otherId, media);
  if (result.status === "caller_busy") throw new HttpError(409, "You're already on a call.", undefined, undefined, "in_call");
  if (result.status === "callee_busy") {
    const ended = await finish(result.call, "busy", null);
    return { call: await toView(ended, viewerId), iceServers: null };
  }
  const [iceServers] = await Promise.all([iceServersFor(viewerId), callsRepo.ringCall(result.call)]);
  return { call: await toView(result.call, viewerId), iceServers };
}

export async function getCall(viewerId: string, callId: string): Promise<CallView> {
  return toView(await current(await requireCall(viewerId, callId)), viewerId);
}

/** The callee's phone says it's ringing. */
export async function reportRinging(viewerId: string, callId: string): Promise<CallView> {
  const call = await current(await requireCall(viewerId, callId));
  if (call.calleeId !== viewerId) throw new HttpError(403, "Only the person being called can do that.");
  const updated = call.state === "ringing" ? await callsRepo.markRinging(call.id, viewerId) : null;
  return toView(updated ?? (await callsRepo.findCall(call.id)) ?? call, viewerId);
}

/** 409 `call_ended` when the call is no longer ringing (the caller hung up, or it rang out). */
function callEnded(): never {
  throw new HttpError(409, "This call has ended.", undefined, undefined, "call_ended");
}

export async function acceptCall(viewerId: string, callId: string): Promise<StartedCall> {
  const call = await current(await requireCall(viewerId, callId));
  if (call.calleeId !== viewerId) throw new HttpError(403, "Only the person being called can answer.");
  if (call.state !== "ringing") callEnded();
  try {
    await requireCallable(viewerId, call.conversationId);
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) await finish(call, "cancelled", null);
    throw error;
  }
  const answered = await callsRepo.answerCall(call.id, viewerId);
  if (!answered) callEnded();
  return { call: await toView(answered, viewerId), iceServers: await iceServersFor(viewerId) };
}

export async function declineCall(viewerId: string, callId: string): Promise<CallView> {
  const call = await current(await requireCall(viewerId, callId));
  if (call.calleeId !== viewerId) throw new HttpError(403, "Only the person being called can decline.");
  return toView(call.state === "ringing" ? await finish(call, "declined", viewerId) : call, viewerId);
}

/**
 * Hangs up, whoever it is and whatever the state: cancelled while ringing (missed if the caller's
 * own ring timeout ended it), declined by the callee, completed once answered, or failed when the
 * phones never managed to connect. Ending an ended call changes nothing.
 */
export async function endCall(viewerId: string, callId: string, reason: "hangup" | "timeout" | "failed"): Promise<CallView> {
  const call = await current(await requireCall(viewerId, callId));
  if (call.state === "ended") return toView(call, viewerId);
  const outcome: CallEndReason = call.state === "ringing"
    ? (call.calleeId === viewerId ? "declined" : reason === "timeout" ? "missed" : "cancelled")
    : reason === "failed" ? "failed" : "completed";
  return toView(await finish(call, outcome, viewerId), viewerId);
}

/** A phone on the call is still there. Answers with the call's state, so a missed "ended" is noticed. */
export async function heartbeat(viewerId: string, callId: string): Promise<CallView> {
  let call = await current(await requireCall(viewerId, callId));
  if (call.state !== "ended") {
    const other = call.callerId === viewerId ? call.calleeId : call.callerId;
    // A block (or the other account suspended) since the call started ends it.
    if (!(await callsAvailableWith(viewerId, other))) call = await finish(call, call.answeredAt ? "completed" : "cancelled", null);
    else call = (await callsRepo.touchCall(call.id, viewerId)) ?? call;
  }
  return toView(call, viewerId);
}

/** Only these, in these shapes: anything else is refused before it reaches the other phone. */
export function parseSignal(body: unknown): { kind: SignalKind; payload: string } {
  const b = (body ?? {}) as { kind?: unknown; payload?: unknown };
  const p = (b.payload ?? {}) as Record<string, unknown>;
  const invalid = (): never => { throw new HttpError(422, "Invalid call signal."); };
  if (typeof b.payload !== "object" || b.payload === null || Array.isArray(b.payload)) invalid();
  switch (b.kind) {
    case "offer":
    case "answer":
      if (typeof p.sdp !== "string" || !p.sdp.startsWith("v=0") || p.sdp.length > MAX_SDP_LENGTH) invalid();
      return { kind: b.kind, payload: JSON.stringify({ sdp: p.sdp }) };
    case "candidate": {
      const { candidate, sdpMid, sdpMLineIndex } = p;
      if (typeof candidate !== "string" || candidate.length > 1024) invalid();
      if (sdpMid !== undefined && sdpMid !== null && (typeof sdpMid !== "string" || sdpMid.length > 64)) invalid();
      if (sdpMLineIndex !== undefined && sdpMLineIndex !== null && (!Number.isInteger(sdpMLineIndex) || (sdpMLineIndex as number) < 0 || (sdpMLineIndex as number) > 64)) invalid();
      return { kind: "candidate", payload: JSON.stringify({ candidate, sdpMid: sdpMid ?? null, sdpMLineIndex: sdpMLineIndex ?? null }) };
    }
    case "restart":
      return { kind: "restart", payload: "{}" };
    case "media":
      if (typeof p.microphone !== "boolean" || typeof p.camera !== "boolean") invalid();
      return { kind: "media", payload: JSON.stringify({ microphone: p.microphone, camera: p.camera }) };
    default:
      return invalid();
  }
}

/**
 * Who may say what, when: the caller offers (with the invite, and again to restart the
 * connection); the callee answers, asks for a restart, and sends candidates only once it has
 * answered. Nobody signals on an ended call.
 */
function allowed(call: CallRow, viewerId: string, kind: SignalKind): boolean {
  const caller = call.callerId === viewerId;
  if (call.state === "ended") return false;
  if (call.state === "ringing") return caller && (kind === "offer" || kind === "candidate" || kind === "media");
  switch (kind) {
    case "offer":
      return caller;
    case "answer":
    case "restart":
      return !caller;
    default:
      return true;
  }
}

export async function sendSignal(viewerId: string, callId: string, signal: { kind: SignalKind; payload: string }): Promise<{ seq: number }> {
  const call = await current(await requireCall(viewerId, callId));
  if (call.state === "ended") callEnded();
  if (!allowed(call, viewerId, signal.kind)) throw new HttpError(409, "That isn't possible on this call right now.", undefined, undefined, "not_now");
  const seq = await callsRepo.addSignal(call, viewerId, signal.kind, signal.payload, MAX_SIGNALS_PER_PHONE);
  if (seq === null) {
    if ((await callsRepo.findCall(call.id))?.state === "ended") callEnded();
    throw new HttpError(429, "Too many call signals.");
  }
  return { seq };
}

/** The other phone's signals after `afterSeq` (from the realtime event, or 0 for all of them). */
export async function listSignals(viewerId: string, callId: string, afterSeq: number): Promise<{ call: CallView; signals: SignalRow[] }> {
  const call = await current(await requireCall(viewerId, callId));
  // The callee reads the caller's offer only once it has answered: until then, nothing.
  const signals = call.state === "ended" || (call.state === "ringing" && call.calleeId === viewerId) ? [] : await callsRepo.listSignals(call.id, viewerId, afterSeq);
  return { call: await toView(call, viewerId), signals };
}

export async function iceServers(viewerId: string): Promise<IceServers> {
  if (!config.calls.enabled) notAvailable();
  return iceServersFor(viewerId);
}
