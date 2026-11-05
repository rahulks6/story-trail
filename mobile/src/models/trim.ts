/** The part of a video kept in a Story, in milliseconds (the server cuts it: backend media/processing.ts). */
export interface TrimRange {
  startMs: number;
  endMs: number;
}

export type TrimPart = "start" | "end" | "middle";

/** The longest Story video, in seconds (the server's MEDIA_MAX_VIDEO_SECONDS). */
export const MAX_STORY_VIDEO_SECONDS = 60;

/** The shortest part that can be kept (the server's MIN_TRIM_MS). */
export const MIN_TRIM_MS = 1000;
/** The longest video that can be trimmed down to a Story (the server's MAX_TRIM_SOURCE_SECONDS). */
export const MAX_TRIM_SOURCE_MS = 15 * 60 * 1000;

const round = (ms: number) => Math.round(ms / 100) * 100;

/** The part to keep when a video first opens: all of it, or the first `maxMs` of a longer one. */
export function initialTrim(durationMs: number, maxMs: number): TrimRange {
  return { startMs: 0, endMs: Math.min(Math.floor(durationMs), maxMs) };
}

/**
 * `from` with one end (or the whole part, "middle") moved by `deltaMs`, kept inside the video,
 * at least MIN_TRIM_MS and at most `maxMs` long. Moving one end past the longest allowed drags
 * the other end along, as in the phone's own video trimmer.
 */
export function moveTrim(from: TrimRange, part: TrimPart, deltaMs: number, durationMs: number, maxMs: number): TrimRange {
  const total = Math.max(MIN_TRIM_MS, Math.floor(durationMs));
  const longest = Math.min(maxMs, total);
  let { startMs, endMs } = from;
  if (part === "middle") {
    const length = endMs - startMs;
    startMs = Math.min(Math.max(0, startMs + deltaMs), total - length);
    endMs = startMs + length;
  } else if (part === "start") {
    startMs = Math.min(Math.max(0, startMs + deltaMs), endMs - MIN_TRIM_MS);
    if (endMs - startMs > longest) endMs = startMs + longest;
  } else {
    endMs = Math.max(Math.min(total, endMs + deltaMs), startMs + MIN_TRIM_MS);
    if (endMs - startMs > longest) startMs = endMs - longest;
  }
  startMs = Math.max(0, round(startMs));
  endMs = Math.min(total, round(endMs));
  if (endMs - startMs < MIN_TRIM_MS) endMs = Math.min(total, startMs + MIN_TRIM_MS);
  return { startMs, endMs };
}

/** Whether a trim keeps less than the whole video (otherwise nothing is sent: the server processes it all). */
export function isTrimmed(trim: TrimRange | null | undefined, durationMs: number | null): boolean {
  if (!trim || !durationMs) return false;
  return trim.startMs > 50 || trim.endMs < durationMs - 50;
}

/** 0:07, 1:23 */
export function formatTrimTime(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
