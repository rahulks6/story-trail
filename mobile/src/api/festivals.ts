import { apiGet } from "./client";

/** A festival from Katkee's calendar (server: modules/festivals). Days are India's. */
export interface Festival {
  slug: string;
  name: string;
  emoji: string;
  greeting: string;
  startsOn: string;
  endsOn: string;
}

export interface CurrentFestival {
  festival: Festival | null;
  /** The next festival when none is on today. */
  next: Festival | null;
  /** Who posted public Stories for today's festival (your own first). */
  creators: string[];
  storyCount: number;
}

export function getCurrentFestival(accessToken: string, signal?: AbortSignal): Promise<CurrentFestival> {
  return apiGet<CurrentFestival>("/api/v1/festivals/current", accessToken, signal);
}

export interface PostingStreak {
  days: number;
  postedToday: boolean;
}

export function getPostingStreak(accessToken: string, signal?: AbortSignal): Promise<{ streak: PostingStreak }> {
  return apiGet<{ streak: PostingStreak }>("/api/v1/stories/streak", accessToken, signal);
}
