/**
 * Calls, the lines that say who is on one (migration 0068), the signaling relayed between the two
 * phones, and the line each call leaves in the chat ("Missed voice call", "Video call · 4:12").
 * Every change of state publishes its realtime event, and any push, in the statement that writes it.
 * Call lines are message rows with an event and no text; this file never reads a message.
 */
import { query, queryOne, type Row } from "../../db/psql";
import { verifiedSql } from "../../shared/verified";

export type CallMedia = "audio" | "video";
export type CallState = "ringing" | "active" | "ended";
export type CallEndReason = "completed" | "missed" | "cancelled" | "declined" | "busy" | "failed";
export type SignalKind = "offer" | "answer" | "candidate" | "restart" | "media";

export interface CallPerson {
  id: string;
  username: string;
  displayName: string;
  avatarMediaId: string | null;
  verified: boolean;
}

export interface CallRow {
  id: string;
  conversationId: string;
  callerId: string;
  calleeId: string;
  media: CallMedia;
  state: CallState;
  endReason: CallEndReason | null;
  createdAt: string;
  ringingAt: string | null;
  answeredAt: string | null;
  endedAt: string | null;
  callerSeenAt: string;
  calleeSeenAt: string | null;
}

const CALL_COLUMNS = "id, conversation_id, caller_id, callee_id, media, state, end_reason, created_at, ringing_at, answered_at, ended_at, caller_seen_at, callee_seen_at";

function mapCall(row: Row): CallRow {
  return {
    id: row.id as string,
    conversationId: row.conversation_id as string,
    callerId: row.caller_id as string,
    calleeId: row.callee_id as string,
    media: row.media as CallMedia,
    state: row.state as CallState,
    endReason: (row.end_reason as CallEndReason | null) ?? null,
    createdAt: row.created_at as string,
    ringingAt: row.ringing_at ?? null,
    answeredAt: row.answered_at ?? null,
    endedAt: row.ended_at ?? null,
    callerSeenAt: row.caller_seen_at as string,
    calleeSeenAt: row.callee_seen_at ?? null,
  };
}

/** What both phones hear about a call: ids and its state only (names come from GET /calls/:id). */
function callEvent(alias: string): string {
  return `json_build_object('u', json_build_array(${alias}.caller_id, ${alias}.callee_id),
            'e', json_build_object('type', 'call', 'callId', ${alias}.id, 'conversationId', ${alias}.conversation_id,
                                   'callerId', ${alias}.caller_id, 'calleeId', ${alias}.callee_id, 'media', ${alias}.media,
                                   'state', ${alias}.state, 'reason', ${alias}.end_reason, 'ringing', ${alias}.ringing_at IS NOT NULL))::text`;
}

export async function findCall(id: string): Promise<CallRow | null> {
  const row = await queryOne(`SELECT ${CALL_COLUMNS} FROM calls WHERE id = :'id'`, { id });
  return row ? mapCall(row) : null;
}

/** Both people on a call, for the app's call screen. */
export async function findCallPeople(call: CallRow): Promise<{ caller: CallPerson | null; callee: CallPerson | null }> {
  const rows = await query(
    `SELECT id, username, display_name, avatar_media_id, ${verifiedSql("users")} AS verified FROM users WHERE id IN (:'a', :'b')`,
    { a: call.callerId, b: call.calleeId },
  );
  const person = (id: string): CallPerson | null => {
    const r = rows.find((row) => row.id === id);
    return r ? { id, username: r.username as string, displayName: r.display_name as string, avatarMediaId: r.avatar_media_id ?? null, verified: r.verified === "t" } : null;
  };
  return { caller: person(call.callerId), callee: person(call.calleeId) };
}

export type StartResult = { status: "ringing"; call: CallRow } | { status: "caller_busy" } | { status: "callee_busy"; call: CallRow };

/**
 * Creates a ringing call and takes both people's lines in one statement. When the caller already
 * has a line (another call of theirs) the new call is dropped; when only the callee does, it's
 * returned for the caller to end as "busy".
 */
export async function createCall(conversationId: string, callerId: string, calleeId: string, media: CallMedia): Promise<StartResult> {
  const row = await queryOne(
    `WITH c AS (
       INSERT INTO calls (conversation_id, caller_id, callee_id, media) VALUES (:'conversation', :'caller', :'callee', :'media')
       RETURNING ${CALL_COLUMNS}),
     l AS (INSERT INTO call_lines (user_id, call_id) SELECT u, c.id FROM c, unnest(ARRAY[:'caller'::uuid, :'callee'::uuid]) AS u
           ON CONFLICT (user_id) DO NOTHING RETURNING user_id)
     SELECT c.*, EXISTS (SELECT 1 FROM l WHERE user_id = :'caller') AS caller_line, EXISTS (SELECT 1 FROM l WHERE user_id = :'callee') AS callee_line FROM c`,
    { conversation: conversationId, caller: callerId, callee: calleeId, media },
  );
  const call = mapCall(row!);
  if (row!.caller_line !== "t") {
    await query(`DELETE FROM calls WHERE id = :'id'`, { id: call.id });
    return { status: "caller_busy" };
  }
  return row!.callee_line === "t" ? { status: "ringing", call } : { status: "callee_busy", call };
}

/** Rings the other person: tells both phones, and queues the push that wakes the callee's. */
export async function ringCall(call: CallRow): Promise<void> {
  await query(
    `WITH c AS (SELECT ${CALL_COLUMNS} FROM calls WHERE id = :'id' AND state = 'ringing'),
     p AS (INSERT INTO push_outbox (user_id, kind, actor_id, ref_id) SELECT callee_id, 'call', caller_id, id FROM c RETURNING id),
     n AS (SELECT pg_notify('realtime', ${callEvent("c")}) FROM c)
     SELECT (SELECT count(*) FROM p) AS queued, (SELECT count(*) FROM n) AS notified`,
    { id: call.id },
  );
}

/** The callee's phone is ringing: the caller hears about it once. */
export async function markRinging(callId: string, calleeId: string): Promise<CallRow | null> {
  const row = await queryOne(
    `WITH c AS (UPDATE calls SET ringing_at = now(), callee_seen_at = now()
                WHERE id = :'id' AND callee_id = :'callee' AND state = 'ringing' AND ringing_at IS NULL RETURNING ${CALL_COLUMNS}),
     n AS (SELECT pg_notify('realtime', ${callEvent("c")}) FROM c)
     SELECT c.*, (SELECT count(*) FROM n) AS notified FROM c`,
    { id: callId, callee: calleeId },
  );
  // Already ringing (another of the callee's phones said so first): just a sign of life.
  return row ? mapCall(row) : touchCall(callId, calleeId);
}

/** The callee answers a ringing call; both phones (all of the callee's) hear it. */
export async function answerCall(callId: string, calleeId: string): Promise<CallRow | null> {
  const row = await queryOne(
    `WITH c AS (UPDATE calls SET state = 'active', answered_at = now(), callee_seen_at = now()
                WHERE id = :'id' AND callee_id = :'callee' AND state = 'ringing' RETURNING ${CALL_COLUMNS}),
     n AS (SELECT pg_notify('realtime', ${callEvent("c")}) FROM c)
     SELECT c.*, (SELECT count(*) FROM n) AS notified FROM c`,
    { id: callId, callee: calleeId },
  );
  return row ? mapCall(row) : null;
}

/** A sign of life from one of the phones (heartbeats, signals). */
export async function touchCall(callId: string, userId: string): Promise<CallRow | null> {
  const row = await queryOne(
    `UPDATE calls SET caller_seen_at = CASE WHEN caller_id = :'user' THEN now() ELSE caller_seen_at END,
                      callee_seen_at = CASE WHEN callee_id = :'user' THEN now() ELSE callee_seen_at END
     WHERE id = :'id' AND state <> 'ended' AND :'user' IN (caller_id, callee_id) RETURNING ${CALL_COLUMNS}`,
    { id: callId, user: userId },
  );
  return row ? mapCall(row) : null;
}

/**
 * Ends a call (once: an ended call is left as it is, and null comes back): frees both lines,
 * deletes its signaling, writes its line in the chat, tells both phones, and pushes "Missed
 * call" to the callee when it rang unanswered (replacing the ringing notification). `stale`: the
 * phones stopped answering, so the call ends at the last moment either was heard from.
 */
export async function endCall(callId: string, reason: CallEndReason, endedBy: string | null, stale = false): Promise<(CallRow & { messageId: string }) | null> {
  const row = await queryOne(
    `WITH c AS (
       UPDATE calls SET state = 'ended', end_reason = :'reason', ended_by = NULLIF(:'by', '')::uuid,
              ended_at = CASE WHEN :'stale' = '1' THEN LEAST(now(), GREATEST(coalesce(answered_at, created_at), LEAST(caller_seen_at, coalesce(callee_seen_at, caller_seen_at))))
                              ELSE now() END
       WHERE id = :'id' AND state <> 'ended'
       RETURNING ${CALL_COLUMNS}),
     lines AS (DELETE FROM call_lines WHERE call_id IN (SELECT id FROM c)),
     signals AS (DELETE FROM call_signals WHERE call_id IN (SELECT id FROM c)),
     m AS (INSERT INTO messages (conversation_id, sender_id, event)
           SELECT conversation_id, caller_id, jsonb_build_object('type', 'call', 'callId', id, 'media', media, 'outcome', end_reason,
                    'durationSeconds', CASE WHEN answered_at IS NOT NULL AND end_reason = 'completed'
                                            THEN GREATEST(0, floor(extract(epoch FROM ended_at - answered_at)))::integer END)
           FROM c RETURNING id, conversation_id, sender_id, created_at),
     p AS (INSERT INTO push_outbox (user_id, kind, actor_id, ref_id)
           SELECT callee_id, 'call_missed', caller_id, id FROM c WHERE end_reason IN ('missed', 'cancelled', 'busy') RETURNING id),
     n AS (SELECT pg_notify('realtime', json_build_object('u', json_build_array(c.caller_id, c.callee_id),
             'e', json_build_object('type', 'message', 'conversationId', m.conversation_id, 'messageId', m.id,
                                    'senderId', m.sender_id, 'createdAt', m.created_at))::text) AS message,
                  pg_notify('realtime', ${callEvent("c")}) AS call
           FROM c, m)
     SELECT c.*, m.id AS message_id, (SELECT count(*) FROM p) AS queued, (SELECT count(*) FROM n) AS notified FROM c, m`,
    { id: callId, reason, by: endedBy ?? "", stale: stale ? "1" : "" },
  );
  return row ? { ...mapCall(row), messageId: row.message_id as string } : null;
}

/**
 * Calls nobody will end themselves: ringing past the ring time (missed), or in progress with a
 * phone that hasn't been heard from in `staleSeconds`. `userIds` limits it to calls of these
 * people (checked before they start another one); otherwise every such call.
 */
export async function abandonedCalls(ringSeconds: number, staleSeconds: number, userIds: string[] | null = null): Promise<CallRow[]> {
  const rows = await query(
    `SELECT ${CALL_COLUMNS} FROM calls
     WHERE state <> 'ended'
       AND (:'users' = '' OR id IN (SELECT call_id FROM call_lines WHERE user_id = ANY (string_to_array(:'users', ',')::uuid[])))
       AND ((state = 'ringing' AND created_at < now() - make_interval(secs => :'ring'::integer))
         OR (state = 'active' AND LEAST(caller_seen_at, coalesce(callee_seen_at, caller_seen_at)) < now() - make_interval(secs => :'stale'::integer)))
     ORDER BY created_at LIMIT 200`,
    { users: userIds?.join(",") ?? "", ring: ringSeconds, stale: staleSeconds },
  );
  return rows.map(mapCall);
}

export interface SignalRow {
  seq: number;
  kind: SignalKind;
  payload: unknown;
  createdAt: string;
}

/**
 * Relays a signal to the other phone: stored in order and announced by its sequence number (the
 * other phone fetches it; a payload can be larger than a realtime event may be). At most
 * `maxPerSender` per phone per call; null when over that, or once the call has ended.
 */
export async function addSignal(call: CallRow, senderId: string, kind: SignalKind, payload: string, maxPerSender: number): Promise<number | null> {
  const recipient = senderId === call.callerId ? call.calleeId : call.callerId;
  const row = await queryOne(
    `WITH s AS (
       INSERT INTO call_signals (call_id, sender_id, kind, payload)
       SELECT :'call', :'sender', :'kind', :'payload'
       WHERE EXISTS (SELECT 1 FROM calls WHERE id = :'call' AND state <> 'ended')
         AND (SELECT count(*) FROM call_signals WHERE call_id = :'call' AND sender_id = :'sender') < :'max'::integer
       RETURNING id),
     seen AS (UPDATE calls SET caller_seen_at = CASE WHEN caller_id = :'sender' THEN now() ELSE caller_seen_at END,
                               callee_seen_at = CASE WHEN callee_id = :'sender' THEN now() ELSE callee_seen_at END
              WHERE id = :'call' AND EXISTS (SELECT 1 FROM s)),
     n AS (SELECT pg_notify('realtime', json_build_object('u', json_build_array(:'recipient'::uuid),
             'e', json_build_object('type', 'call_signal', 'callId', :'call'::uuid, 'seq', s.id))::text) FROM s)
     SELECT s.id, (SELECT count(*) FROM n) AS notified FROM s`,
    { call: call.id, sender: senderId, recipient, kind, payload, max: maxPerSender },
  );
  return row ? Number(row.id) : null;
}

/** The other phone's signals after `afterSeq`, oldest first. */
export async function listSignals(callId: string, recipientId: string, afterSeq: number, limit = 200): Promise<SignalRow[]> {
  const rows = await query(
    `SELECT id, kind, payload, created_at FROM call_signals
     WHERE call_id = :'call' AND sender_id <> :'recipient' AND id > :'after'::bigint
     ORDER BY id LIMIT :'limit'`,
    { call: callId, recipient: recipientId, after: afterSeq, limit },
  );
  return rows.map((r) => ({ seq: Number(r.id), kind: r.kind as SignalKind, payload: JSON.parse(r.payload as string) as unknown, createdAt: r.created_at as string }));
}
