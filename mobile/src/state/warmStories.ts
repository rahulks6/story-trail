import { Image } from "react-native";
import type { PublicStory } from "../api/stories";

/**
 * Stories a screen has just loaded (a profile's ring), kept for a moment so the Story viewer opens
 * on them at once instead of fetching the same list again, and their first frame starts loading
 * before the tap. Taken once; never older than WARM_MS or past the media links' expiry.
 */
const WARM_MS = 60_000;
const warm = new Map<string, { stories: PublicStory[]; at: number }>();

function firstFrameUrl(story: PublicStory | undefined): string | null {
  const url = story?.media?.imageUrl;
  // Signed CDN links only: the image cache can't send the sign-in header.
  return url && !url.startsWith("/") ? url : null;
}

export function warmStories(username: string, stories: PublicStory[]): void {
  if (!stories.length) {
    warm.delete(username);
    return;
  }
  warm.set(username, { stories, at: Date.now() });
  const url = firstFrameUrl(stories[0]);
  if (url) void Image.prefetch(url).catch(() => undefined);
}

export function takeWarmStories(username: string, now = Date.now()): PublicStory[] | null {
  const entry = warm.get(username);
  warm.delete(username);
  if (!entry || now - entry.at > WARM_MS) return null;
  const expiry = entry.stories.map((s) => s.media?.urlsExpireAt).filter((v): v is string => !!v).map((v) => Date.parse(v));
  // Links that expire within a minute are fetched fresh instead.
  if (expiry.some((t) => Number.isFinite(t) && t - now < 60_000)) return null;
  return entry.stories;
}
