import * as RNFS from "@dr.pogodin/react-native-fs";
import Share from "react-native-share";
import { captureRef } from "react-native-view-shot";
import type { ShareCardHandle } from "../components/StoryShareCard";
import { API_BASE_URL, ApiError } from "../api/client";
import { uploadStoryOverlay } from "../api/media";
import { getStoryExport, startStoryExport } from "../api/stories";
import { track } from "../analytics/analytics";

/** How often, and for how long, the app asks whether a video is ready. */
export const EXPORT_POLL_MS = 1500;
export const EXPORT_MAX_WAIT_MS = 90_000;

export class ShareCancelled extends Error {
  constructor() {
    super("Cancelled.");
    this.name = "ShareCancelled";
  }
}

/** What went wrong, in words the sheet can show as they are. */
export class ShareFailed extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ShareFailed";
  }
}

const OFFLINE = "Check your connection and try again.";

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new ShareCancelled());
    const timer = setTimeout(() => { signal.removeEventListener("abort", onAbort); resolve(); }, ms);
    const onAbort = () => { clearTimeout(timer); reject(new ShareCancelled()); };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

const stripScheme = (uri: string) => uri.replace(/^file:\/\//, "");

/**
 * Moves a captured file into the app's own cache, the folder react-native-share's Android file
 * provider covers (view-shot may write to the external cache instead).
 */
async function intoCache(uri: string, ext: string): Promise<string> {
  const target = `${RNFS.CachesDirectoryPath}/katkee-share-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  await RNFS.moveFile(stripScheme(uri), target);
  return target;
}

async function remove(paths: (string | null)[]): Promise<void> {
  for (const file of paths) if (file) await RNFS.unlink(stripScheme(file)).catch(() => undefined);
}

/** The system share sheet with the file, and the links as the message. True when it was sent. */
async function openShareSheet(file: string, type: string, message: string): Promise<boolean> {
  const result = await Share.open({ url: `file://${file}`, type, message, failOnCancel: false });
  return !result?.dismissedAction;
}

interface Common {
  storyId: string;
  /** The text that goes with the file: the profile link (and the Story's, when it's public). */
  message: string;
  signal: AbortSignal;
}

/** A photo Story: the card (photo, text, stickers, mark) saved as a JPEG and shared. */
export async function sharePhotoStory(card: React.RefObject<ShareCardHandle | null>, input: Common): Promise<boolean> {
  let captured: string | null = null, file: string | null = null;
  try {
    captured = await captureRef(card, { format: "jpg", quality: 0.92, width: 1080, height: 1920, result: "tmpfile" });
    if (input.signal.aborted) throw new ShareCancelled();
    file = await intoCache(captured, "jpg");
    captured = null;
    const sent = await openShareSheet(file, "image/jpeg", input.message);
    if (sent) track("story_shared_external", { kind: "photo" });
    return sent;
  } finally {
    await remove([captured, file]);
  }
}

/**
 * A video Story: the card's transparent layer goes to the server, which puts the video together
 * (see backend media/exports.ts); the app waits for it, downloads it to the cache and shares it.
 */
export async function shareVideoStory(card: React.RefObject<ShareCardHandle | null>, input: Common & { accessToken: string }): Promise<boolean> {
  const { storyId, accessToken, signal } = input;
  let overlay: string | null = null, file: string | null = null;
  try {
    overlay = await captureRef(card, { format: "png", width: 720, height: 1280, result: "tmpfile" });
    let upload: { id: string };
    try {
      upload = await uploadStoryOverlay(overlay, accessToken);
    } finally {
      await remove([overlay]);
      overlay = null;
    }
    if (signal.aborted) throw new ShareCancelled();
    let job = await startStoryExport(storyId, upload.id, accessToken);
    const deadline = Date.now() + EXPORT_MAX_WAIT_MS;
    while (job.status === "processing") {
      if (Date.now() >= deadline) throw new ShareFailed("This is taking longer than usual. Try again in a moment.");
      await wait(EXPORT_POLL_MS, signal);
      job = await getStoryExport(storyId, job.id, accessToken, signal);
    }
    if (job.status === "failed" || !job.url) throw new ShareFailed(job.error ?? "We couldn't prepare this video. Try again.");
    if (signal.aborted) throw new ShareCancelled();

    file = `${RNFS.CachesDirectoryPath}/katkee-story-${job.id}.mp4`;
    const relative = job.url.startsWith("/");
    const download = RNFS.downloadFile({
      fromUrl: relative ? `${API_BASE_URL}${job.url}` : job.url,
      toFile: file,
      // The sign-in token only ever goes to this API, never to the CDN.
      ...(relative ? { headers: { Authorization: `Bearer ${accessToken}` } } : {}),
    });
    const onAbort = () => RNFS.stopDownload(download.jobId);
    signal.addEventListener("abort", onAbort, { once: true });
    let status: number;
    try {
      status = (await download.promise).statusCode;
    } finally {
      signal.removeEventListener("abort", onAbort);
    }
    if (signal.aborted) throw new ShareCancelled();
    if (status !== 200) throw new ShareFailed(OFFLINE);
    const sent = await openShareSheet(file, "video/mp4", input.message);
    if (sent) track("story_shared_external", { kind: "video" });
    return sent;
  } catch (error) {
    if (error instanceof ShareCancelled || error instanceof ShareFailed) throw error;
    if (signal.aborted) throw new ShareCancelled();
    // A refusal from the server (the daily limit, a deleted Story) says what happened; anything
    // else is the connection.
    if (error instanceof ApiError && error.status >= 400 && error.status < 500 && error.message) throw new ShareFailed(error.message);
    throw new ShareFailed(OFFLINE);
  } finally {
    await remove([overlay, file]);
  }
}
