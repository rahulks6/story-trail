import { API_BASE_URL, apiDelete, apiGet, apiPost } from "./client";
import type { Overlay, DrawStroke, StoryCrop } from "../models/storyDraft";
import type { MediaDelivery } from "./media";

/** Mirrors backend/src/modules/stories/stories.service.ts's PublicStory — kept in lockstep by hand, same as the rest of src/api/. */
export interface PublicStory {
  id: string;
  ownerId: string;
  mediaId: string;
  caption: string;
  audience: "public" | "followers";
  allowComments: "everyone" | "followers" | "disabled";
  allowSharing: boolean;
  createdAt: string;
  expiresAt: string;
  overlays: Overlay[];
  drawing: DrawStroke[];
  /** Lowercase key (e.g. "cinema") — see models/storyDraft.ts's filterKey/filterNameFromKey. */
  filter: string;
  audioMuted: boolean;
  crop: StoryCrop;
  /** URLs for this viewer: thumbnail, full-screen image/poster, video renditions (null from older servers). */
  media?: MediaDelivery | null;
}

export interface FeedEntry {
  owner: { id: string; username: string; displayName: string };
  stories: PublicStory[];
}

export interface RankedFeedEntry extends Omit<FeedEntry,"stories"> {
  stories: Array<Pick<PublicStory,"id"|"mediaId"|"caption"|"audience"|"createdAt"|"expiresAt">>;
  isFollowing: boolean;
  score: number;
}

export interface PublishStoryInput {
  requestId?: string;
  mediaId: string;
  caption?: string;
  audience?: "public" | "followers";
  allowComments?: "everyone" | "followers" | "disabled";
  allowSharing?: boolean;
  overlays?: Overlay[];
  drawing?: DrawStroke[];
  /** Lowercase key — see models/storyDraft.ts's filterKey. */
  filter?: string;
  audioMuted?: boolean;
  crop?: StoryCrop;
}

/**
 * 201 `{story}` when published; 202 `{publish}` when the media is still processing,
 * in which case the server publishes it as soon as processing finishes.
 */
export type PublishStoryResult =
  | { story: PublicStory }
  | { publish: { state: "processing"; requestId: string; mediaId: string } };

export function publishStory(input: PublishStoryInput, accessToken: string): Promise<PublishStoryResult> {
  return apiPost("/api/v1/stories", input, accessToken);
}

export interface PublishRequestStatus {
  state: "processing" | "published" | "failed";
  storyId: string | null;
  mediaId: string;
  error: string | null;
  retryable: boolean;
}

/** Where a publish request stands while its media processes. */
export function getPublishRequest(requestId: string, accessToken: string): Promise<{ publish: PublishRequestStatus }> {
  return apiGet(`/api/v1/stories/publish-requests/${encodeURIComponent(requestId)}`, accessToken);
}

export function getFollowingFeed(accessToken: string): Promise<{ feed: FeedEntry[] }> {
  return apiGet("/api/v1/stories/feed/following", accessToken);
}

/** Phase 6: followed creators + real discovery of public creators you don't yet follow, ranked by the backend's scoring heuristic. */
export function getRankedHomeFeed(accessToken: string, cursor?: string): Promise<{ feed: RankedFeedEntry[]; sponsoredEnabled?: boolean; nextCursor: string|null }> {
  return apiGet("/api/v1/stories/feed/home?limit=12"+(cursor?"&cursor="+encodeURIComponent(cursor):""), accessToken);
}

export function getMyActiveStories(accessToken: string): Promise<{ stories: PublicStory[] }> {
  return apiGet("/api/v1/stories/mine/active", accessToken);
}

export function getUserActiveStories(username: string, accessToken: string): Promise<{ stories: PublicStory[] }> {
  return apiGet(`/api/v1/users/${encodeURIComponent(username)}/stories`, accessToken);
}

/** Every Story you've ever published, expired or not — the private Archive a Highlight's story picker is built from. */
export function getMyArchivedStories(
  accessToken: string,
  params: { limit?: number; offset?: number } = {},
): Promise<{ stories: PublicStory[]; limit: number; offset: number }> {
  const query = new URLSearchParams();
  if (params.limit) query.set("limit", String(params.limit));
  if (params.offset) query.set("offset", String(params.offset));
  const qs = query.toString();
  return apiGet(`/api/v1/stories/mine/archive${qs ? `?${qs}` : ""}`, accessToken);
}

export function recordStoryView(storyId: string, accessToken: string): Promise<void> {
  return apiPost(`/api/v1/stories/${storyId}/view`, undefined, accessToken);
}

export function deleteStory(storyId: string, accessToken: string): Promise<void> {
  return apiDelete(`/api/v1/stories/${storyId}`, accessToken);
}

export function getViewCount(storyId: string, accessToken: string): Promise<{ views: number }> {
  return apiGet(`/api/v1/stories/${storyId}/views`, accessToken);
}

export interface StoryViewer {
  id: string;
  username: string;
  displayName: string;
  viewedAt: string;
}

/** Owner-only — who's actually behind getViewCount's number (backend rejects this for anyone else). */
export function getStoryViewers(storyId: string, accessToken: string): Promise<{ viewers: StoryViewer[] }> {
  return apiGet(`/api/v1/stories/${storyId}/viewers`, accessToken);
}

/** Mirrors backend/src/modules/stories/stories.service.ts's Insights. Every rate is 0-100, already rounded. */
export interface StoryInsights {
  viewCount: number;
  completionRate: number;
  followingViewRate: number;
  discoveryViewRate: number;
  profileVisitRate: number;
}

/** Owner-only — completion %, following-vs-discovery split, and profile-visit rate for one Story. */
export function getStoryInsights(storyId: string, accessToken: string): Promise<{ insights: StoryInsights }> {
  return apiGet(`/api/v1/stories/${storyId}/insights`, accessToken);
}

/** The same shape, aggregated across every currently-active Story the caller owns ("per-sequence Insights"). */
export function getSequenceInsights(accessToken: string): Promise<{ insights: StoryInsights }> {
  return apiGet("/api/v1/stories/mine/sequence-insights", accessToken);
}

/**
 * A Story's owner username, for deep-linking into StoryViewer (which
 * addresses creators by username) when only a storyId is on hand — a
 * mention notification, a DM's shared Story. Denied the same way viewing
 * the Story itself would be.
 */
export function getStoryOwnerUsername(storyId: string, accessToken: string): Promise<{ username: string }> {
  return apiGet(`/api/v1/stories/${storyId}/owner`, accessToken);
}

export type MediaVariant = "display" | "thumbnail" | "poster" | "video_720" | "video_480";

export function mediaFileUrl(mediaId: string, variant?: MediaVariant): string {
  // Consumed with an Authorization header by the viewer (Image/Video source supports a `headers` field).
  // With a CDN the API answers with a redirect to a signed URL; small variants keep grids light.
  return `${API_BASE_URL}/api/v1/media/${mediaId}/file${variant ? `?variant=${variant}` : ""}`;
}
