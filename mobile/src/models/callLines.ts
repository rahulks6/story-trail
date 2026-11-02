import type { GroupEvent } from "../api/conversations";
import { formatCallDuration } from "../calls/callMachine";

export type CallEvent = Extract<GroupEvent, { type: "call" }>;

/**
 * A call's line in the chat, from the reader's side, like WhatsApp: "Video call · 4:12" once
 * talked on; to the person called and not reached, "Missed voice call"; to the caller, how it
 * went ("Voice call · No answer"). `mine`: the reader placed the call.
 */
export function callLineText(event: CallEvent, mine: boolean): string {
  const kind = event.media === "video" ? "Video call" : "Voice call";
  switch (event.outcome) {
    case "completed":
      return event.durationSeconds !== null ? `${kind} · ${formatCallDuration(event.durationSeconds)}` : kind;
    case "declined":
      return `${kind} · Declined`;
    case "failed":
      return `${kind} · Couldn't connect`;
    case "busy":
      return mine ? `${kind} · On another call` : `Missed ${kind.toLowerCase()}`;
    case "missed":
      return mine ? `${kind} · No answer` : `Missed ${kind.toLowerCase()}`;
    case "cancelled":
      return mine ? `${kind} · Cancelled` : `Missed ${kind.toLowerCase()}`;
    default:
      return kind;
  }
}

/** Whether the reader missed this call (the line is drawn in the alert colour). */
export function isMissedCall(event: CallEvent, mine: boolean): boolean {
  return !mine && (event.outcome === "missed" || event.outcome === "cancelled" || event.outcome === "busy");
}
