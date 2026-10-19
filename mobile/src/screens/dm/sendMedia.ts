import * as RNFS from "@dr.pogodin/react-native-fs";
import {
  completeUploadSession,
  createUploadSession,
  getMedia,
  getUploadSession,
  PartUploadError,
  retryMediaProcessing,
  uploadAudio,
  uploadPart,
  uploadPhoto,
  type UploadedMedia,
  type UploadSessionResponse,
} from "../../api/media";
import { sendMessage, newClientMessageId, type Message } from "../../api/conversations";
import { ApiError } from "../../api/client";
import { base64ToBytes } from "../../utils/base64";

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
  /** Set once the server has the file: a retry only waits for it and sends, never uploads again. */
  mediaId?: string;
}

/**
 * DM videos go up part by part (the same resumable direct upload as Stories), so a
 * dropped connection continues where it stopped. The cap keeps a chat video sensible.
 */
export const MAX_DM_VIDEO_BYTES = 100 * 1024 * 1024;
/** How long to wait for the server to process a file before asking the person to retry. */
const READY_TIMEOUT_MS = 10 * 60_000;
const PART_ATTEMPTS = 3;

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
const localPath = (uri: string) => (uri.startsWith("file://") ? decodeURI(uri.slice(7)) : uri);

/**
 * A video through the resumable upload. The message's own id is the upload's id, so
 * a retry (even after the app was closed) picks up the same upload and only sends the
 * parts the server doesn't have yet.
 */
async function uploadVideoResumable(item: PendingMedia, token: () => string): Promise<UploadedMedia> {
  const path = localPath(item.uri);
  const size = Number((await RNFS.stat(path)).size);
  if (!size) throw new Error("The selected file is empty.");
  let session: UploadSessionResponse = await createUploadSession({ clientUploadId: item.clientMessageId, kind: "video", mimeType: item.mimeType, byteSize: size }, token());
  for (let round = 0; session.upload; round++) {
    if (round >= 4) throw new Error("Upload could not be completed. Try again.");
    const plan = session.upload;
    let refresh = false;
    for (const part of plan.parts) {
      if (part.uploaded || !part.url) continue;
      const chunk = base64ToBytes(await RNFS.read(path, part.byteLength, (part.partNumber - 1) * plan.partSize, "base64"));
      if (chunk.byteLength !== part.byteLength) throw new Error("The video changed. Delete it and choose it again.");
      for (let attempt = 1; ; attempt++) {
        try {
          await uploadPart(part.url, chunk.buffer as ArrayBuffer);
          break;
        } catch (error) {
          if (error instanceof PartUploadError && error.urlExpired) { refresh = true; break; }
          const transient = !(error instanceof PartUploadError) || error.status === 0 || error.status >= 500;
          if (!transient || attempt >= PART_ATTEMPTS) throw error;
          await wait(attempt * 1_500);
        }
      }
      if (refresh) break;
    }
    if (refresh) { session = await getUploadSession(session.media.id, token()); continue; }
    try {
      session = { media: (await completeUploadSession(session.media.id, token())).media, upload: null };
    } catch (error) {
      // 409: a part went missing; fetch the plan and send what's left.
      if (error instanceof ApiError && error.status === 409) { session = await getUploadSession(session.media.id, token()); continue; }
      throw error;
    }
  }
  return session.media;
}

/** The file already on the server, or null when it's gone (and has to be uploaded again). */
async function existingMedia(mediaId: string, token: () => string): Promise<UploadedMedia | null> {
  try {
    const media = await getMedia(mediaId, token());
    // A temporary processing failure: the server tries again without a new upload.
    if (media.status === "failed" && media.retryable) return (await retryMediaProcessing(mediaId, token())).media;
    return media;
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

/**
 * Uploads the file, waits until the server has processed it (so the other person can open it
 * the moment it arrives), then sends it. Retrying with the same entry never sends it twice,
 * and once `onUploaded` has seen the media id, never uploads it twice either.
 */
export async function sendPendingMedia(
  conversationId: string,
  item: PendingMedia,
  getToken: () => string | null,
  onUploaded?: (mediaId: string) => void,
): Promise<Message> {
  const token = () => {
    const t = getToken();
    if (!t) throw new Error("You're signed out.");
    return t;
  };
  let media = item.mediaId ? await existingMedia(item.mediaId, token) : null;
  if (!media) {
    media = item.mediaKind === "audio" ? await uploadAudio(item.uri, token())
      : item.mediaKind === "video" ? await uploadVideoResumable(item, token)
      : await uploadPhoto(item.uri, item.mimeType, token());
    onUploaded?.(media.id);
  }
  const mediaId = media.id;
  const deadline = Date.now() + READY_TIMEOUT_MS;
  for (let delay = 700; media.status !== "ready"; delay = Math.min(delay * 1.5, 5_000)) {
    if (media.status === "failed") throw new Error(media.processingError ?? "This file couldn't be processed.");
    // Uploaded: Retry only waits again, it doesn't upload a second copy.
    if (Date.now() > deadline) throw new Error("Still processing. Tap to check again.");
    await wait(delay);
    media = await getMedia(mediaId, token());
  }
  try {
    const { message } = await sendMessage(conversationId, { mediaId, clientMessageId: item.clientMessageId }, token());
    return message;
  } catch (error) {
    if (error instanceof ApiError) throw new Error(error.message);
    throw error;
  }
}
