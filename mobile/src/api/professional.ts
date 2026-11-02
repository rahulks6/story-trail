import { apiDelete, apiGet, apiPut } from "./client";
import type { MediaDelivery } from "./media";
import { t } from "../i18n";

/**
 * Professional accounts and their dashboard: /api/v1/me/professional. Mirrors the server's
 * professional module by hand, like the rest of src/api/.
 */
export type ProfessionalCategory = "creator" | "artist" | "public_figure" | "brand" | "news_media" | "organization";

/** The verified badge's categories plus Artist; "brand" reads as Business here. */
export const PROFESSIONAL_CATEGORIES: { value: ProfessionalCategory; label: string; hint: string }[] = [
  { value: "creator", get label() { return t("common.creator"); }, get hint() { return t("professional.videosPhotosAndEverydayStories"); } },
  { value: "artist", get label() { return t("professional.artist"); }, get hint() { return t("professional.musicArtDanceComedyOr"); } },
  { value: "brand", get label() { return t("professional.business"); }, get hint() { return t("professional.aShopBrandRestaurantOr"); } },
  { value: "public_figure", get label() { return t("common.publicFigure"); }, get hint() { return t("professional.sportsPoliticsFilmOrPublic"); } },
  { value: "news_media", get label() { return t("common.newsOrMedia"); }, get hint() { return t("professional.aPublisherChannelOrJournalist"); } },
  { value: "organization", get label() { return t("professional.organisation"); }, get hint() { return t("professional.aNonProfitSchoolOr"); } },
];

/** The label people read for a category; null for a missing or unknown one. */
export function professionalCategoryLabel(category: string | null | undefined): string | null {
  return PROFESSIONAL_CATEGORIES.find((c) => c.value === category)?.label ?? null;
}

export interface ProfessionalStatus {
  professional: { category: ProfessionalCategory; showCategory: boolean; since: string } | null;
  /** `reasons` are sentences written for people. */
  eligibility: { eligible: boolean; reasons: string[] };
}

export function getProfessionalStatus(accessToken: string): Promise<ProfessionalStatus> {
  return apiGet("/api/v1/me/professional", accessToken);
}

/** Switch to a professional account, or change its category or whether it shows. */
export function setProfessional(
  input: { category: ProfessionalCategory; showCategory: boolean; timeZone?: string | null },
  accessToken: string,
): Promise<ProfessionalStatus> {
  return apiPut("/api/v1/me/professional", input, accessToken);
}

export function switchToPersonal(accessToken: string): Promise<ProfessionalStatus> {
  return apiDelete("/api/v1/me/professional", accessToken);
}

export type DashboardRange = 7 | 30;

export interface DashboardDay {
  /** YYYY-MM-DD in your time zone. */
  day: string;
  views: number;
  /** null: before follower changes were counted. */
  followersGained: number | null;
  followersLost: number | null;
}

export interface DashboardTopStory {
  id: string;
  mediaId: string;
  createdAt: string;
  expiresAt: string;
  views: number;
  likes: number;
  replies: number;
  shares: number;
  media: MediaDelivery | null;
}

export type AudienceHours =
  /** `hours`: 24 shares (0-100) of the busiest hour, never counts. */
  | { status: "ready"; hours: number[]; peakHour: number; basedOnFollowers: number; sampled: boolean; computedAt: string }
  | { status: "not_enough"; minimumFollowers: number };

export interface Dashboard {
  days: DashboardRange;
  timeZone: string;
  from: string;
  to: string;
  summary: {
    accountsReached: number;
    reachedFollowers: number;
    storyViews: number;
    storiesPosted: number;
    likes: number;
    comments: number;
    replies: number;
    shares: number;
    followers: number;
    followersNet: number | null;
  };
  previous: { accountsReached: number; storyViews: number };
  daily: DashboardDay[];
  followerHistorySince: string;
  topStories: DashboardTopStory[];
  audience: AudienceHours;
}

/** The phone's time zone (an IANA name such as Asia/Kolkata), or null where it can't be read. */
export function deviceTimeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

export function getDashboard(days: DashboardRange, accessToken: string): Promise<{ dashboard: Dashboard }> {
  const tz = deviceTimeZone();
  return apiGet(`/api/v1/me/professional/dashboard?days=${days}${tz ? `&tz=${encodeURIComponent(tz)}` : ""}`, accessToken);
}
