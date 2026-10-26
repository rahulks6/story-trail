import { ValidationError } from "../auth/dto";
import { MAX_FORWARD_RECIPIENTS, STORY_REACTIONS, type ForwardTargets, type SendMessageInput, type StoryReplyInput } from "./conversations.service";
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

  let mediaId: string | null = null;
  if (b.mediaId !== undefined && b.mediaId !== null) {
    if (typeof b.mediaId !== "string" || !UUID_RE.test(b.mediaId)) errors.mediaId = "mediaId must be a valid media id.";
    else mediaId = b.mediaId;
  }

  let replyToMessageId: string | null = null;
  if (b.replyToMessageId !== undefined && b.replyToMessageId !== null) {
    if (typeof b.replyToMessageId !== "string" || !UUID_RE.test(b.replyToMessageId)) errors.replyToMessageId = "replyToMessageId must be a valid message id.";
    else replyToMessageId = b.replyToMessageId;
  }

  if (!messageBody && !storyId && !mediaId && !errors.mediaId) {
    errors.body = "A message needs text, a photo or video, or a shared Story.";
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
  return { body: messageBody, storyId, clientMessageId, mediaId, replyToMessageId };
}

/** POST …/messages/:messageId/forward: `{ userIds, conversationIds }`, up to ten of each, at least one in all. */
export function parseForwardInput(body: unknown): ForwardTargets {
  const b = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  const errors: Record<string, string> = {};
  const ids = (key: "userIds" | "conversationIds"): string[] => {
    const value = b[key];
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value) || value.some((v) => typeof v !== "string" || !UUID_RE.test(v))) {
      errors[key] = `${key} must be a list of ids.`;
      return [];
    }
    const unique = [...new Set((value as string[]).map((v) => v.toLowerCase()))];
    if (unique.length > MAX_FORWARD_RECIPIENTS) errors[key] = `At most ${MAX_FORWARD_RECIPIENTS}.`;
    return unique;
  };
  const userIds = ids("userIds");
  const conversationIds = ids("conversationIds");
  if (!Object.keys(errors).length && userIds.length + conversationIds.length === 0) errors.userIds = "Choose at least one person or chat.";
  if (Object.keys(errors).length > 0) throw new ValidationError(errors);
  return { userIds, conversationIds };
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

/** POST /api/v1/stories/:id/replies: `{ body }` for a written reply or `{ reaction }` for a quick one. */
export function parseStoryReplyInput(body: unknown): StoryReplyInput {
  const errors: Record<string, string> = {};
  const b = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  const text = typeof b.body === "string" ? b.body.trim() : "";
  const reaction = typeof b.reaction === "string" ? b.reaction : "";
  if (text && reaction) errors.body = "Send either a reply or a reaction, not both.";
  else if (reaction && !(STORY_REACTIONS as readonly string[]).includes(reaction)) errors.reaction = "Choose one of the quick reactions.";
  else if (!text && !reaction) errors.body = "Write a reply.";
  else if (text.length > MAX_BODY_LENGTH) errors.body = `Replies can be at most ${MAX_BODY_LENGTH} characters.`;
  let clientMessageId: string | null = null;
  if (b.clientMessageId !== undefined && b.clientMessageId !== null) {
    if (typeof b.clientMessageId !== "string" || !/^[A-Za-z0-9_-]{16,64}$/.test(b.clientMessageId)) {
      errors.clientMessageId = "clientMessageId must be 16-64 letters, digits, '-' or '_'.";
    } else {
      clientMessageId = b.clientMessageId;
    }
  }
  if (Object.keys(errors).length > 0) throw new ValidationError(errors);
  return reaction ? { body: reaction, kind: "reaction", clientMessageId } : { body: text, kind: "reply", clientMessageId };
}
