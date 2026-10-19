import { HttpError } from "../../http/errors";
import { cdnEnabled, signedCdnUrl } from "../media/delivery";
import * as musicRepo from "./music.repository";
import type { MusicTrack } from "./music.repository";

/** Shortest and longest part of a song a Story plays. */
export const MIN_CLIP_MS = 5_000;
export const MAX_CLIP_MS = 30_000;
export const DEFAULT_CLIP_MS = 15_000;

/** What a Story stores: which track, and which part of it plays. */
export interface StoryMusic {
  trackId: string;
  startMs: number;
  durationMs: number;
}

/** A track as the app sees it, with a URL to play it from. */
export interface PublicTrack {
  id: string;
  title: string;
  artist: string;
  mood: string;
  durationMs: number;
  license: string;
  licenseUrl: string;
  attribution: string;
  url: string;
}

/** Signed CDN link in production; this API (with the sign-in header) in development. */
export function trackUrl(track: MusicTrack): string {
  return cdnEnabled() ? signedCdnUrl(track.storageKey).url : `/api/v1/music/${track.id}/file`;
}

export function toPublicTrack(track: MusicTrack): PublicTrack {
  return {
    id: track.id, title: track.title, artist: track.artist, mood: track.mood, durationMs: track.durationMs,
    license: track.license, licenseUrl: track.licenseUrl, attribution: track.attribution, url: trackUrl(track),
  };
}

export async function listTracks(search: string, mood: string, limit: number, offset: number): Promise<PublicTrack[]> {
  return (await musicRepo.listTracks(search.trim().slice(0, 60), mood.trim().slice(0, 40), limit, offset)).map(toPublicTrack);
}

/** The part of the song a Story plays, kept inside the song and within 5 to 30 seconds. */
export async function validateStoryMusic(music: StoryMusic): Promise<StoryMusic> {
  const track = await musicRepo.findActiveTrack(music.trackId);
  if (!track) throw new HttpError(422, "That song isn't available.", { music: "Choose another song." });
  const durationMs = Math.min(Math.max(Math.round(music.durationMs), MIN_CLIP_MS), MAX_CLIP_MS, track.durationMs);
  const startMs = Math.min(Math.max(Math.round(music.startMs), 0), Math.max(0, track.durationMs - durationMs));
  return { trackId: track.id, startMs, durationMs };
}

export async function requireTrack(id: string): Promise<MusicTrack> {
  const track = await musicRepo.findTrack(id);
  if (!track) throw new HttpError(404, "Song not found.");
  return track;
}
