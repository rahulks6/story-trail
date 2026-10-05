import { API_BASE_URL, ApiError, apiGet, apiPost, authenticatedFetch, readApiResponse, withRequestTimeout } from "./client";

export type MediaStatus = "uploading" | "processing" | "ready" | "failed";

/** Mirrors backend media/delivery.ts MediaDelivery. Relative URLs are this API (send the bearer token); absolute ones are signed CDN URLs (send nothing). */
export interface MediaDelivery {
  status: MediaStatus;
  kind: "photo" | "video";
  width: number | null;
  height: number | null;
  durationMs: number | null;
  thumbnailUrl: string | null;
  /** The photo, or a video's poster frame (show it while the video loads). */
  imageUrl: string | null;
  /** Best first. */
  videos: { variant: "video_720" | "video_480"; url: string; width: number; height: number; bitrate: number | null }[];
  urlsExpireAt: string | null;
}

export interface UploadedMedia {
  id: string;
  kind: "photo" | "video";
  mimeType: string;
  byteSize: number;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  status: MediaStatus;
  createdAt: string;
  processingError?: string | null;
  retryable?: boolean;
  delivery?: MediaDelivery;
}

export interface UploadPlan {
  partSize: number;
  partCount: number;
  parts: { partNumber: number; byteLength: number; uploaded: boolean; url: string | null }[];
  urlsExpireAt: string;
  sessionExpiresAt: string;
}

export interface UploadSessionResponse {
  media: UploadedMedia;
  /** null once the upload has been completed. */
  upload: UploadPlan | null;
}

/**
 * Starts (or, for the same outbox id, resumes) a direct upload. The server answers
 * with per-part signed URLs; the bytes never pass through the API in production.
 */
export function createUploadSession(
  input: { clientUploadId: string; kind: "photo" | "video"; mimeType: string; byteSize: number },
  accessToken: string,
): Promise<UploadSessionResponse> {
  return apiPost("/api/v1/media/uploads", input, accessToken);
}

/** Which parts already arrived, with fresh URLs for the rest. */
export function getUploadSession(mediaId: string, accessToken: string): Promise<UploadSessionResponse> {
  return apiGet(`/api/v1/media/uploads/${mediaId}`, accessToken);
}

export function completeUploadSession(mediaId: string, accessToken: string): Promise<{ media: UploadedMedia }> {
  return apiPost(`/api/v1/media/uploads/${mediaId}/complete`, undefined, accessToken);
}

export function abortUploadSession(mediaId: string, accessToken: string): Promise<void> {
  return apiPost(`/api/v1/media/uploads/${mediaId}/abort`, undefined, accessToken);
}

/** After a temporary processing failure, asks the server to try again. */
export function retryMediaProcessing(mediaId: string, accessToken: string): Promise<{ media: UploadedMedia }> {
  return apiPost(`/api/v1/media/${mediaId}/retry-processing`, undefined, accessToken);
}

export class PartUploadError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "PartUploadError";
  }
  /** 403: the signed URL expired; fetch fresh URLs and try again. */
  get urlExpired(): boolean {
    return this.status === 403;
  }
}

/**
 * PUTs one part to its signed URL, reporting bytes sent. No Authorization header:
 * the signature is the credential (and S3 rejects a second auth mechanism).
 */
export function uploadPart(url: string, body: ArrayBuffer, onProgress?: (sentBytes: number) => void, timeoutMs = 120_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url.startsWith("/") ? `${API_BASE_URL}${url}` : url);
    xhr.timeout = timeoutMs;
    if (onProgress && xhr.upload) xhr.upload.onprogress = (event) => onProgress(event.loaded);
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new PartUploadError(xhr.status, xhr.status === 403 ? "The upload link expired." : `Upload failed (${xhr.status}).`));
    };
    xhr.onerror = () => reject(new PartUploadError(0, "Upload interrupted. Check your connection."));
    xhr.ontimeout = () => reject(new PartUploadError(0, "Upload timed out. Check your connection."));
    xhr.send(body);
  });
}

/**
 * The single-request upload (raw body -> API). Kept for profile photos; Stories
 * use the resumable direct upload (state/uploadQueue.ts).
 */
async function fileUriToBlob(uri: string): Promise<Blob> {
  return withRequestTimeout(async signal => {
    const response = await fetch(uri, { signal });
    const blob = await response.blob();
    if (!blob.size) throw new Error("The selected file is empty.");
    return blob;
  }, 30_000);
}

async function uploadBlob(path: string, blob: Blob, mimeType: string, accessToken: string): Promise<UploadedMedia> {
 return withRequestTimeout(async signal => {
  const res = await authenticatedFetch(`${API_BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": mimeType, Authorization: `Bearer ${accessToken}` },
    body: blob,
    signal,
  });
  const json = await readApiResponse<{media: UploadedMedia}>(res);
  if (!json.media || typeof json.media.id !== 'string' || !json.media.id) {
    throw new ApiError(res.status, 'The upload response is incomplete. Please try again.');
  }
  return json.media;
 }, 180_000);
}

export async function uploadPhoto(localUri: string, mimeType: string, accessToken: string): Promise<UploadedMedia> {
  const blob = await fileUriToBlob(localUri);
  return uploadBlob("/api/v1/media/photos", blob, mimeType, accessToken);
}

export async function uploadVideo(localUri: string, mimeType: string, accessToken: string): Promise<UploadedMedia> {
  const blob = await fileUriToBlob(localUri);
  return uploadBlob("/api/v1/media/videos", blob, mimeType, accessToken);
}

/** Media access is owner-only unless it's attached to a Story the caller can see (backend Phase 4 rule). */
export async function getMedia(mediaId: string, accessToken: string): Promise<UploadedMedia> {
  const res = await apiGet<{ media: UploadedMedia }>(`/api/v1/media/${mediaId}`, accessToken);
  return res.media;
}

/** An Image/Video source for a delivery URL: the bearer token only goes to this API, never to the CDN. */
export function mediaSource(url: string, accessToken: string | null | undefined): { uri: string; headers?: Record<string, string> } {
  if (!url.startsWith("/")) return { uri: url };
  return { uri: `${API_BASE_URL}${url}`, headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined };
}
