import { apiDelete, apiGet, apiPost } from "./client";

/**
 * The verified badge: GET/POST/DELETE /api/v1/me/verification. Mirrors the server's
 * verification module by hand, like the rest of src/api/.
 */
export type VerificationCategory = "creator" | "public_figure" | "brand" | "news_media" | "organization";

export const VERIFICATION_CATEGORIES: { value: VerificationCategory; label: string }[] = [
  { value: "creator", label: "Creator" },
  { value: "public_figure", label: "Public figure" },
  { value: "brand", label: "Brand or business" },
  { value: "news_media", label: "News or media" },
  { value: "organization", label: "Government or organisation" },
];

/** The label people read for a category; null for a missing or unknown one. */
export function verificationCategoryLabel(category: string | null | undefined): string | null {
  return VERIFICATION_CATEGORIES.find((c) => c.value === category)?.label ?? null;
}

export interface VerificationRequest {
  id: string;
  status: "pending" | "approved" | "denied" | "withdrawn";
  category: string;
  fullName: string;
  links: string[];
  createdAt: string;
  decidedAt: string | null;
  denialReason: string | null;
  /** Denied: when a new request is allowed (30 days after the decision). */
  canReapplyAt: string | null;
}

export interface VerificationStatus {
  /** The badge shows. */
  verified: boolean;
  /** Verified, but paused after a name change until the review team looks again. */
  onHold: boolean;
  category: string | null;
  /** `reasons` are sentences written for people ("Add a bio."). */
  eligibility: { eligible: boolean; reasons: string[] };
  /** The most recent request, whatever its status. */
  request: VerificationRequest | null;
}

export interface VerificationInput {
  category: VerificationCategory;
  /** As on the ID, 1–80 characters. */
  fullName: string;
  /** 1–5 https links. */
  links: string[];
  /** A photo uploaded with uploadPhoto; the server keeps it private to the review team. */
  idMediaId: string;
}

export const MAX_VERIFICATION_LINKS = 5;
export const MAX_FULL_NAME_LENGTH = 80;
export const MAX_LINK_LENGTH = 300;

export function getVerification(accessToken: string): Promise<VerificationStatus> {
  return apiGet("/api/v1/me/verification", accessToken);
}

export function requestVerification(input: VerificationInput, accessToken: string): Promise<{ request: VerificationRequest }> {
  return apiPost("/api/v1/me/verification", input, accessToken);
}

export function withdrawVerification(accessToken: string): Promise<void> {
  return apiDelete("/api/v1/me/verification", accessToken);
}

/**
 * Tick-like characters a name can't contain (they'd pass for the badge): check marks, ballot boxes
 * with a check, the square-root sign and their emoji forms. The server refuses them too.
 */
const TICK_LIKE = /[\u2713\u2714\u2611\u2705\u237B\u221A\u{1F5F8}\u{1F5F9}]/u;

export const NAME_TICK_ERROR = "Names can't include check marks.";

export function hasTickLikeCharacter(name: string): boolean {
  return TICK_LIKE.test(name);
}
