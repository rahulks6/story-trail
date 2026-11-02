import { apiPost } from "./client";
import { t } from "../i18n";

/** Mirrors backend/src/modules/moderation/moderation.repository.ts — kept in lockstep by hand, same as the rest of src/api/. */
export type ReportTargetType = "story" | "comment" | "user";
export type ReportReason = "spam" | "harassment" | "nudity" | "violence" | "hate_speech" | "self_harm" | "impersonation" | "scam" | "under_18" | "other";

export const REPORT_REASONS: { value: ReportReason; label: string }[] = [
  { value: "spam", get label() { return t("moderation.spam"); } },
  { value: "harassment", get label() { return t("moderation.harassmentOrBullying"); } },
  { value: "nudity", get label() { return t("moderation.nudityOrSexualContent"); } },
  { value: "violence", get label() { return t("moderation.violence"); } },
  { value: "hate_speech", get label() { return t("moderation.hateSpeech"); } },
  { value: "self_harm", get label() { return t("moderation.selfHarm"); } },
  { value: "impersonation", get label() { return t("moderation.pretendingToBeSomeoneElse"); } },
  { value: "scam", get label() { return t("moderation.scamOrFraud"); } },
  { value: "under_18", get label() { return t("moderation.mayBeUnder18"); } },
  { value: "other", get label() { return t("moderation.somethingElse"); } },
];

export function createReport(
  input: { targetType: ReportTargetType; targetId: string; reason: ReportReason; details?: string },
  accessToken: string,
): Promise<void> {
  return apiPost("/api/v1/reports", input, accessToken);
}

/**
 * Reports a message someone sent you in a DM. The reported message and the nine before it
 * are shared with the safety team; nothing else from the conversation is
 * (backend/src/modules/conversations/conversations.repository.ts reportMessage).
 */
export function reportDirectMessage(
  conversationId: string,
  input: { messageId: string; reason: ReportReason; details?: string },
  accessToken: string,
): Promise<{ report: { id: string } }> {
  return apiPost(`/api/v1/conversations/${conversationId}/report`, input, accessToken);
}
