import { ValidationError } from "../auth/dto";
import type { SendMessageInput } from "./conversations.service";
import { REPORT_REASONS } from "../moderation/dto";

const MAX_BODY_LENGTH = 2000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseSendMessageInput(body: unknown): SendMessageInput {
  const errors: Record<string, string> = {};
  const b = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;

  let messageBody: string | null = null;
  if (b.body !== undefined && b.body !== null) {
    if (typeof b.body !== "string") {
      errors.body = "body must be a string.";
    } else {
      const trimmed = b.body.trim();
      if (trimmed.length > MAX_BODY_LENGTH) {
        errors.body = `body must be at most ${MAX_BODY_LENGTH} characters.`;
      } else if (trimmed.length > 0) {
        messageBody = trimmed;
      }
    }
  }

  let storyId: string | null = null;
  if (b.storyId !== undefined && b.storyId !== null) {
    if (typeof b.storyId !== "string" || !UUID_RE.test(b.storyId)) {
      errors.storyId = "storyId must be a valid Story id.";
    } else {
      storyId = b.storyId;
    }
  }

  if (!messageBody && !storyId) {
    errors.body = "A message needs text, a shared Story, or both.";
  }

  let clientMessageId: string | null = null;
  if (b.clientMessageId !== undefined && b.clientMessageId !== null) {
    if (typeof b.clientMessageId !== "string" || !/^[A-Za-z0-9_-]{16,64}$/.test(b.clientMessageId)) {
      errors.clientMessageId = "clientMessageId must be 16-64 letters, digits, '-' or '_'.";
    } else {
      clientMessageId = b.clientMessageId;
    }
  }

  if (Object.keys(errors).length > 0) throw new ValidationError(errors);
  return { body: messageBody, storyId, clientMessageId };
}

export interface ReportMessageInput {
  messageId: string;
  reason: string;
  details: string | null;
}

/** Same categories as every other report (moderation/dto.ts). */
export function parseReportMessageInput(body: unknown): ReportMessageInput {
  const b = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  const errors: Record<string, string> = {};
  const messageId = typeof b.messageId === "string" && UUID_RE.test(b.messageId) ? b.messageId : "";
  if (!messageId) errors.messageId = "messageId must be a valid id.";
  const reason = typeof b.reason === "string" && (REPORT_REASONS as string[]).includes(b.reason) ? b.reason : "";
  if (!reason) errors.reason = `reason must be one of: ${REPORT_REASONS.join(", ")}.`;
  let details: string | null = null;
  if (b.details !== undefined && b.details !== null) {
    if (typeof b.details !== "string" || b.details.length > 500) errors.details = "details must be at most 500 characters.";
    else details = b.details.trim() || null;
  }
  if (Object.keys(errors).length > 0) throw new ValidationError(errors);
  return { messageId, reason, details };
}
