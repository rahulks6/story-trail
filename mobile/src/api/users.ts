import { API_BASE_URL, apiGet, apiPatch, apiPost, apiDelete, type PublicUser } from "./client";

/**
 * Shapes here mirror backend/src/modules/users/profiles.service.ts
 * (ProfileView) and social.service.ts — kept in lockstep by hand until a
 * shared types package exists (same caveat as api/client.ts).
 */
export interface ProfileView {
  id: string;
  username: string;
  displayName: string;
  bio: string;
  avatarMediaId: string | null;
  interests: string[];
  isPrivate: boolean;
  isSelf: boolean;
  followerCount: number;
  followingCount: number;
  viewer: {
    isFollowing: boolean;
    isFollowedBy: boolean;
    hasPendingRequestFromViewer: boolean;
    hasPendingRequestFromTarget: boolean;
    isMutedByViewer: boolean;
  };
}

/** The signed-in person's relationship to someone in a list (search, suggestions). */
export interface ListRelationship {
  isFollowing: boolean;
  isFollowedBy: boolean;
  hasPendingRequestFromViewer: boolean;
}

export interface SearchResult {
  id: string;
  username: string;
  displayName: string;
  avatarMediaId?: string | null;
  bio: string;
  isPrivate?: boolean;
  interests?: string[];
  viewer?: ListRelationship;
}

/** Why someone is suggested; only facts the person can already see. */
export type SuggestionReason =
  | { kind: "follows_you" }
  | { kind: "followed_by"; username: string; others: number }
  | { kind: "shared_interest"; interest: string }
  | { kind: "new" };

export interface SuggestedPerson {
  id: string;
  username: string;
  displayName: string;
  avatarMediaId: string | null;
  isPrivate: boolean;
  reason: SuggestionReason;
  viewer: ListRelationship;
}

export interface UsernameAvailability {
  username: string;
  available: boolean;
  reason: "available" | "yours" | "taken" | "held" | "invalid" | "reserved" | "not_allowed";
  message: string;
}

export type FollowStatus = { status: "following" } | { status: "requested" };

/** By username, or by the account's permanent ID (which still finds someone after a rename). */
export function getProfile(usernameOrId: string, accessToken: string): Promise<{ profile: ProfileView }> {
  return apiGet<{ profile: ProfileView }>(`/api/v1/users/${encodeURIComponent(usernameOrId)}`, accessToken);
}

/** Live check while choosing a username; signed out at sign-up, so the token is optional. */
export function checkUsername(username: string, accessToken: string | null, signal?: AbortSignal): Promise<UsernameAvailability> {
  return apiGet(`/api/v1/usernames/availability?username=${encodeURIComponent(username)}`, accessToken, signal);
}

export function getSuggestions(accessToken: string, signal?: AbortSignal): Promise<{ suggestions: SuggestedPerson[] }> {
  return apiGet("/api/v1/search/suggestions", accessToken, signal);
}

export function updateMyProfile(
  input: { username?: string; displayName?: string; bio?: string; isPrivate?: boolean; interests?: string[]; avatarMediaId?: string | null },
  accessToken: string,
) {
  return apiPatch<{ user: PublicUser }>("/api/v1/users/me", input, accessToken);
}

export function avatarFileUrl(username: string, avatarMediaId?: string | null): string {
  const version = avatarMediaId ? `?v=${encodeURIComponent(avatarMediaId)}` : "";
  return `${API_BASE_URL}/api/v1/users/${encodeURIComponent(username)}/avatar/file${version}`;
}

export function searchUsers(
  query: string,
  accessToken: string,
  options: { offset?: number; limit?: number; following?: boolean; signal?: AbortSignal } = {},
): Promise<{ results: SearchResult[]; limit: number; offset: number }> {
  const params = new URLSearchParams({ q: query });
  if (options.offset) params.set("offset", String(options.offset));
  if (options.limit) params.set("limit", String(options.limit));
  if (options.following) params.set("scope", "following");
  return apiGet(`/api/v1/search/users?${params.toString()}`, accessToken, options.signal);
}

export function followUser(username: string, accessToken: string): Promise<FollowStatus> {
  return apiPost(`/api/v1/users/${encodeURIComponent(username)}/follow`, undefined, accessToken);
}

export function unfollowUser(username: string, accessToken: string): Promise<void> {
  return apiDelete(`/api/v1/users/${encodeURIComponent(username)}/follow`, accessToken);
}

export function blockUser(username: string, accessToken: string): Promise<void> {
  return apiPost(`/api/v1/users/${encodeURIComponent(username)}/block`, undefined, accessToken);
}

export function unblockUser(username: string, accessToken: string): Promise<void> {
  return apiDelete(`/api/v1/users/${encodeURIComponent(username)}/block`, accessToken);
}

export function muteUser(username: string, accessToken: string): Promise<void> {
  return apiPost(`/api/v1/users/${encodeURIComponent(username)}/mute`, undefined, accessToken);
}

export function unmuteUser(username: string, accessToken: string): Promise<void> {
  return apiDelete(`/api/v1/users/${encodeURIComponent(username)}/mute`, accessToken);
}

export interface BlockedUser {
  id: string;
  username: string;
  displayName: string;
  blockedAt: string;
}

export function listBlockedUsers(
  accessToken: string,
  params: { limit?: number; offset?: number } = {},
): Promise<{ blocked: BlockedUser[]; limit: number; offset: number }> {
  const query = new URLSearchParams();
  if (params.limit) query.set("limit", String(params.limit));
  if (params.offset) query.set("offset", String(params.offset));
  const qs = query.toString();
  return apiGet(`/api/v1/blocks${qs ? `?${qs}` : ""}`, accessToken);
}

export interface MutedUser {
  id: string;
  username: string;
  displayName: string;
  avatarMediaId?: string | null;
  mutedAt: string;
}

export function listMutedUsers(
  accessToken: string,
  params: { limit?: number; offset?: number } = {},
): Promise<{ muted: MutedUser[]; limit: number; offset: number }> {
  const query = new URLSearchParams();
  if (params.limit) query.set("limit", String(params.limit));
  if (params.offset) query.set("offset", String(params.offset));
  const qs = query.toString();
  return apiGet(`/api/v1/mutes${qs ? `?${qs}` : ""}`, accessToken);
}

export interface FollowedUser {
  id: string;
  username: string;
  displayName: string;
  avatarMediaId?: string | null;
  bio: string;
  isPrivate: boolean;
  followedAt: string;
}

export interface IncomingFollowRequest {
  requestId: string;
  requesterId: string;
  username: string;
  displayName: string;
  avatarMediaId?: string | null;
  createdAt: string;
}

export function listFollowRequests(
  accessToken: string,
  params: { limit?: number; offset?: number } = {},
): Promise<{ requests: IncomingFollowRequest[]; limit: number; offset: number }> {
  const query = new URLSearchParams();
  if (params.limit) query.set("limit", String(params.limit));
  if (params.offset) query.set("offset", String(params.offset));
  const qs = query.toString();
  return apiGet(`/api/v1/follow-requests${qs ? `?${qs}` : ""}`, accessToken);
}

export function acceptFollowRequest(requestId: string, accessToken: string): Promise<void> {
  return apiPost(`/api/v1/follow-requests/${requestId}/accept`, undefined, accessToken);
}

export function declineFollowRequest(requestId: string, accessToken: string): Promise<void> {
  return apiPost(`/api/v1/follow-requests/${requestId}/decline`, undefined, accessToken);
}

export function getFollowing(
  username: string,
  accessToken: string,
  params: { limit?: number; offset?: number } = {},
): Promise<{ following: FollowedUser[]; limit: number; offset: number }> {
  const query = new URLSearchParams();
  if (params.limit) query.set("limit", String(params.limit));
  if (params.offset) query.set("offset", String(params.offset));
  const qs = query.toString();
  return apiGet(`/api/v1/users/${encodeURIComponent(username)}/following${qs ? `?${qs}` : ""}`, accessToken);
}

/** Same shape and gating as getFollowing — a private account's list is 403 unless you're the owner or an accepted follower. */
export function getFollowers(
  username: string,
  accessToken: string,
  params: { limit?: number; offset?: number } = {},
): Promise<{ followers: FollowedUser[]; limit: number; offset: number }> {
  const query = new URLSearchParams();
  if (params.limit) query.set("limit", String(params.limit));
  if (params.offset) query.set("offset", String(params.offset));
  const qs = query.toString();
  return apiGet(`/api/v1/users/${encodeURIComponent(username)}/followers${qs ? `?${qs}` : ""}`, accessToken);
}
