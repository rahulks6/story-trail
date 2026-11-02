-- One-to-one voice and video calls in a 1:1 chat (src/modules/calls). Sound and video go phone to
-- phone (WebRTC, relayed through a TURN server when there's no direct path) and never reach this
-- server. What is kept is the call log the chat shows ("Missed voice call", "Video call · 4:12"):
-- who called whom, when, how it ended and how long it lasted.
CREATE TABLE calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  caller_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  callee_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  media text NOT NULL CHECK (media IN ('audio', 'video')),
  state text NOT NULL DEFAULT 'ringing' CHECK (state IN ('ringing', 'active', 'ended')),
  -- completed: answered, then hung up; missed: nobody answered in time; cancelled: the caller hung
  -- up first; declined; busy: the other person was already on a call; failed: never connected.
  end_reason text CHECK (end_reason IN ('completed', 'missed', 'cancelled', 'declined', 'busy', 'failed')),
  ended_by uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- The other phone is ringing (its app said so): the caller sees "Ringing" instead of "Calling".
  ringing_at timestamptz,
  answered_at timestamptz,
  ended_at timestamptz,
  -- Each phone's last sign of life while ringing or talking. A call both phones abandoned (a
  -- crash, no network) is ended by the sweeper instead of leaving them "on a call" for good.
  caller_seen_at timestamptz NOT NULL DEFAULT now(),
  callee_seen_at timestamptz,
  CHECK (caller_id <> callee_id),
  CHECK ((state = 'ended') = (ended_at IS NOT NULL AND end_reason IS NOT NULL)),
  -- Talking, or a call that was talked on, was answered.
  CHECK ((state <> 'active' AND end_reason IS DISTINCT FROM 'completed') OR answered_at IS NOT NULL)
);
CREATE INDEX calls_conversation_idx ON calls (conversation_id, created_at DESC);
CREATE INDEX calls_caller_idx ON calls (caller_id);
CREATE INDEX calls_callee_idx ON calls (callee_id);
-- The sweeper's view: calls still ringing or in progress.
CREATE INDEX calls_live_idx ON calls (created_at) WHERE state <> 'ended';
CREATE INDEX calls_ended_idx ON calls (ended_at) WHERE state = 'ended';

-- Who is on a call right now: one row per person, so two calls can never both claim someone
-- (the later one is "busy"), however the requests race. Gone when the call ends.
CREATE TABLE call_lines (
  user_id uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  call_id uuid NOT NULL REFERENCES calls (id) ON DELETE CASCADE
);
CREATE INDEX call_lines_call_idx ON call_lines (call_id);

-- WebRTC signaling between the two phones, in order: the session descriptions (offer, answer),
-- network candidates, a request to restart the connection, and camera/microphone state. They
-- name network addresses, so they last only as long as the call and are deleted when it ends.
CREATE TABLE call_signals (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  call_id uuid NOT NULL REFERENCES calls (id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('offer', 'answer', 'candidate', 'restart', 'media')),
  payload text NOT NULL CHECK (octet_length(payload) <= 16384),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX call_signals_call_idx ON call_signals (call_id, id);

-- Pushes: 'call' rings the other person's phone; 'call_missed' replaces that notification when
-- nobody answered. They are added to whatever kinds the constraint allows by now (read from the
-- constraint itself), so kinds another migration added before this one are kept.
DO $$
DECLARE
  allowed text[];
BEGIN
  SELECT array_agg(DISTINCT m[1]) INTO allowed
    FROM pg_constraint c, regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''', 'g') AS m
   WHERE c.conname = 'push_outbox_kind_check' AND c.conrelid = 'push_outbox'::regclass;
  IF allowed IS NULL OR NOT ('message' = ANY (allowed)) THEN
    RAISE EXCEPTION 'push_outbox_kind_check not found or not understood';
  END IF;
  ALTER TABLE push_outbox DROP CONSTRAINT push_outbox_kind_check;
  EXECUTE format('ALTER TABLE push_outbox ADD CONSTRAINT push_outbox_kind_check CHECK (kind IN (%s))',
    (SELECT string_agg(quote_literal(k), ', ' ORDER BY k) FROM (SELECT DISTINCT unnest(allowed || ARRAY['call', 'call_missed']) AS k) kinds));
END $$;
