import { apiPost } from "./client";

/** Mirrors backend/src/modules/moderation/moderation.repository.ts — kept in lockstep by hand, same as the rest of src/api/. */
export type ReportTargetType = "story" | "comment" | "user";
export type ReportReason = "spam" | "harassment" | "nudity" | "violence" | "hate_speech" | "self_harm" | "impersonation" | "scam" | "other";

export const REPORT_REASONS: { value: ReportReason; label: string }[] = [
  { value: "spam", label: "Spam" },
  { value: "harassment", label: "Harassment or bullying" },
  { value: "nudity", label: "Nudity or sexual content" },
  { value: "violence", label: "Violence" },
  { value: "hate_speech", label: "Hate speech" },
  { value: "self_harm", label: "Self-harm" },
  { value: "impersonation", label: "Pretending to be someone else" },
  { value: "scam", label: "Scam or fraud" },
  { value: "other", label: "Something else" },
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
