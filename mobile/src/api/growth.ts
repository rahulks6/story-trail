import { apiGet, apiPost } from "./client";
import type { ListRelationship } from "./users";

/**
 * Contacts on Katkee and Invite friends. Shapes mirror backend/src/modules/growth (contacts.ts,
 * invites.ts), kept in step by hand like the rest of api/.
 */
export interface ContactMatch {
  id: string;
  username: string;
  displayName: string;
  avatarMediaId: string | null;
  verified: boolean;
  isPrivate: boolean;
  viewer: ListRelationship;
}

/** One batch (at most 500) of hashes from utils/contactHashes.ts; the server keeps none of them. */
export function matchContacts(hashes: string[], accessToken: string): Promise<{ matches: ContactMatch[] }> {
  return apiPost("/api/v1/contacts/match", { hashes }, accessToken);
}

export interface MyInvite {
  code: string;
  /** https://katkee.com/i/<code> */
  url: string;
  joinedCount: number;
}

export function getMyInvite(accessToken: string): Promise<{ invite: MyInvite }> {
  return apiGet("/api/v1/invites/me", accessToken);
}

export interface Inviter {
  username: string;
  displayName: string;
  verified: boolean;
  avatarMediaId?: string | null;
}

export type RedeemStatus = "redeemed" | "already_redeemed" | "not_new" | "own";

export function redeemInvite(code: string, accessToken: string): Promise<{ status: RedeemStatus; inviter: Inviter }> {
  return apiPost("/api/v1/invites/redeem", { code }, accessToken);
}

/** Whose invite a code is, before there's an account (the sign-up screen's "Invited by …"). */
export function getInviter(code: string, signal?: AbortSignal): Promise<{ inviter: Inviter }> {
  return apiGet(`/api/v1/invites/${encodeURIComponent(code)}`, null, signal);
}
