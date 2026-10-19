import { apiGet } from "./client";

/** Mirrors backend music.service.ts PublicTrack. */
export interface MusicTrack {
  id: string;
  title: string;
  artist: string;
  mood: string;
  durationMs: number;
  license: string;
  licenseUrl: string;
  /** The credit the licence asks for; shown with the Story. */
  attribution: string;
  /** Relative: this API (send the sign-in header); absolute: a signed CDN link. */
  url: string;
}

/** Shortest, default and longest part of a song a Story plays (backend music.service.ts). */
export const MIN_CLIP_MS = 5_000;
export const DEFAULT_CLIP_MS = 15_000;
export const MAX_CLIP_MS = 30_000;

export function listMusic(accessToken: string, params: { q?: string; mood?: string; offset?: number } = {}): Promise<{ tracks: MusicTrack[]; moods?: string[] }> {
  const query = new URLSearchParams();
  if (params.q?.trim()) query.set("q", params.q.trim());
  if (params.mood) query.set("mood", params.mood);
  if (params.offset) query.set("offset", String(params.offset));
  query.set("limit", "50");
  return apiGet(`/api/v1/music?${query.toString()}`, accessToken);
}

/** "1:05" */
export function formatClock(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
