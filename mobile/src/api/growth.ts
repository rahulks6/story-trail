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

/** Today's theme (backend themes/daily-themes.ts): the same for everyone, in your language. */
export interface TodayTheme {
  date: string;
  slug: string;
  emoji: string;
  title: string;
  postedToday: boolean;
}

export function getTodayTheme(accessToken: string, signal?: AbortSignal): Promise<TodayTheme> {
  return apiGet("/api/v1/themes/today", accessToken, signal);
}

/** Founding member spots: how many of the first 1,000 accounts are taken (growth/official.ts). */
export function getFoundingSpots(accessToken: string, signal?: AbortSignal): Promise<{ total: number; taken: number; left: number }> {
  return apiGet("/api/v1/founding", accessToken, signal);
}

/** The invite contest (backend growth/contest.ts); null when none is on, or not in this language. */
export interface ContestLeader {
  rank: number;
  userId: string;
  username: string;
  displayName: string;
  avatarMediaId: string | null;
  counted: number;
}
export interface ContestFriend {
  username: string;
  displayName: string;
  activeDays: number;
  counted: boolean;
}
export interface Contest {
  slug: string;
  prize: { amountMinor: number; currency: "INR"; kind: "amazon_voucher" };
  startsAt: string;
  endsAt: string;
  countsUntil: string;
  qualifyDays: number;
  state: "running" | "counting" | "final";
  rulesUrl: string;
  winner: { username: string; displayName: string } | null;
  me: { counted: number; pending: number; rank: number | null; toFirst: number | null; friends: ContestFriend[] };
  leaders: ContestLeader[];
}
export function getContest(accessToken: string, signal?: AbortSignal): Promise<{ contest: Contest | null }> {
  return apiGet("/api/v1/contest", accessToken, signal);
}
