import { apiPost } from "./client";

/** Settings > Help > Send feedback (backend support.service.ts). */
export function sendFeedback(
  input: { body: string; screenshotMediaId?: string; appVersion: string; osVersion: string; deviceModel: string },
  accessToken: string,
): Promise<{ feedback: { id: string } }> {
  return apiPost("/api/v1/feedback", input, accessToken);
}

export const MAX_FEEDBACK_LENGTH = 2000;
