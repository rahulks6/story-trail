import type { GroupEvent } from "../api/conversations";
import { formatCallDuration } from "../calls/callMachine";
import { t } from "../i18n";

export type CallEvent = Extract<GroupEvent, { type: "call" }>;

/**
 * A call's line in the chat, from the reader's side, like WhatsApp: "Video call · 4:12" once
 * talked on; to the person called and not reached, "Missed voice call"; to the caller, how it
 * went ("Voice call · No answer"). `mine`: the reader placed the call.
 */
export function callLineText(event: CallEvent, mine: boolean): string {
  const video = event.media === "video";
  const kind = video ? t("callLines.videoCall") : t("callLines.voiceCall");
  const missed = video ? t("callLines.missedVideoCall") : t("callLines.missedVoiceCall");
  switch (event.outcome) {
    case "completed":
      return event.durationSeconds !== null ? `${kind} · ${formatCallDuration(event.durationSeconds)}` : kind;
    case "declined":
      return t("callLines.kindDeclined", { kind });
    case "failed":
      return t("callLines.kindCouldntConnect", { kind });
    case "busy":
      return mine ? t("callLines.kindOnAnotherCall", { kind }) : missed;
    case "missed":
      return mine ? t("callLines.kindNoAnswer", { kind }) : missed;
    case "cancelled":
      return mine ? t("callLines.kindCancelled", { kind }) : missed;
    default:
      return kind;
  }
}

/** Whether the reader missed this call (the line is drawn in the alert colour). */
export function isMissedCall(event: CallEvent, mine: boolean): boolean {
  return !mine && (event.outcome === "missed" || event.outcome === "cancelled" || event.outcome === "busy");
}
