import { getMedia, uploadAudio, uploadPhoto, uploadVideo } from "../../api/media";
import { sendMessage, newClientMessageId, type Message } from "../../api/conversations";
import { ApiError } from "../../api/client";

/** A photo or video on its way into a conversation: shown in the thread straight away. */
export interface PendingMedia {
  clientMessageId: string;
  uri: string;
  mimeType: string;
  mediaKind: "photo" | "video" | "audio";
  width: number | null;
  /** A voice note's length, shown while it sends. */
  durationMs?: number;
  height: number | null;
  status: "sending" | "failed";
  error?: string;
}

/** The single-request upload holds the file in memory, so DM videos stay small. */
export const MAX_DM_VIDEO_BYTES = 100 * 1024 * 1024;
const READY_TIMEOUT_MS = 3 * 60_000;

export function newPendingMedia(asset: { uri: string; type?: string; width?: number; height?: number }): PendingMedia {
  const kind = asset.type?.startsWith("video/") ? "video" : "photo";
  return {
    clientMessageId: newClientMessageId(),
    uri: asset.uri,
    mimeType: asset.type ?? (kind === "video" ? "video/mp4" : "image/jpeg"),
    mediaKind: kind,
    width: asset.width ?? null,
    height: asset.height ?? null,
    status: "sending",
  };
}

/** A recorded voice note, ready to send. */
export function newVoiceNote(uri: string, durationMs: number): PendingMedia {
  return { clientMessageId: newClientMessageId(), uri, mimeType: "audio/mp4", mediaKind: "audio", width: null, height: null, durationMs, status: "sending" };
}

const wait = (ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms); });

/**
 * Uploads the file, waits until the server has processed it (so the other person can open it
 * the moment it arrives), then sends it. Retrying with the same entry never sends it twice.
 */
export async function sendPendingMedia(conversationId: string, item: PendingMedia, getToken: () => string | null): Promise<Message> {
  const token = () => {
    const t = getToken();
    if (!t) throw new Error("You're signed out.");
    return t;
  };
  const uploaded = item.mediaKind === "audio" ? await uploadAudio(item.uri, token())
    : item.mediaKind === "video" ? await uploadVideo(item.uri, item.mimeType, token())
    : await uploadPhoto(item.uri, item.mimeType, token());
  let media = uploaded;
  const deadline = Date.now() + READY_TIMEOUT_MS;
  for (let delay = 700; media.status !== "ready"; delay = Math.min(delay * 1.5, 5_000)) {
    if (media.status === "failed") throw new Error(media.processingError ?? "This file couldn't be processed.");
    if (Date.now() > deadline) throw new Error("Processing is taking too long. Try again.");
    await wait(delay);
    media = await getMedia(uploaded.id, token());
  }
  try {
    const { message } = await sendMessage(conversationId, { mediaId: media.id, clientMessageId: item.clientMessageId }, token());
    return message;
  } catch (error) {
    if (error instanceof ApiError) throw new Error(error.message);
    throw error;
  }
}
