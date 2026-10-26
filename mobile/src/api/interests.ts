import { apiDelete, apiGet } from "./client";

/** A topic Katkee has learned you like from what you watch; how strongly, never a score. */
export interface LearnedInterest {
  topic: string;
  strength: "high" | "medium";
}

/** Mirrors backend/src/modules/recommendations/interests.routes.ts. Yours only. */
export interface MyInterests {
  /** What you chose on your profile (Edit profile). */
  chosen: string[];
  /** Strongest first, at most five. */
  learned: LearnedInterest[];
}

export function getMyInterests(accessToken: string): Promise<MyInterests> {
  return apiGet("/api/v1/me/interests", accessToken);
}

/** Sets that learned topic back to nothing, and keeps it there for 30 days. */
export function removeLearnedInterest(topic: string, accessToken: string): Promise<void> {
  return apiDelete(`/api/v1/me/interests/learned/${encodeURIComponent(topic)}`, accessToken);
}
