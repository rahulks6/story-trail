import { useEffect, useRef, useState } from "react";
import type { ImageURISource } from "react-native";

/**
 * A photo just saved as a profile photo or cover is usually still being processed: its file
 * answers 404 for a few seconds. So the photo is asked for again a few times, a little later
 * each time, before giving up on it (about a minute in all).
 */
export const PROFILE_PHOTO_RETRY_DELAYS_MS = [2000, 4000, 8000, 16000, 30000];

/** The picture you cropped on this phone, by the media id it was saved as. */
const localPhotos = new Map<string, string>();

/**
 * Called once a new profile photo or cover is saved: until the app restarts your own page shows
 * the picture you cropped, at once, rather than waiting for the server to finish its copy.
 */
export function rememberLocalProfilePhoto(mediaId: string, uri: string): void {
  localPhotos.set(mediaId, uri);
}

/**
 * The image source for a profile photo or cover: the local copy when this phone saved it, else
 * the access-checked file, asked for again while it is still being processed. Null while
 * waiting to try again, or once it can't be shown (failed: then the initial, or no cover, shows).
 * Only a known media id is retried: with an unknown one, a 404 just means there's no photo.
 */
export function useProfilePhotoSource(
  url: string | null,
  mediaId: string | null | undefined,
  accessToken: string | null | undefined,
): { source: ImageURISource | null; onError: () => void; failed: boolean } {
  // A new sign-in token starts afresh too: a photo asked for with a token that had just expired
  // (the app back after a while) answers 401, and shows once the session is refreshed.
  const key = `${url}|${mediaId}|${accessToken}`;
  const [state, setState] = useState({ key, localFailed: false, attempt: 0, waiting: false, failed: false });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // A new photo starts afresh (and any pending retry for the old one is dropped).
  const current = state.key === key ? state : { key, localFailed: false, attempt: 0, waiting: false, failed: false };
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, [key]);

  const local = mediaId ? localPhotos.get(mediaId) : undefined;
  const showLocal = !!local && !current.localFailed;
  let source: ImageURISource | null = null;
  if (url && accessToken) {
    if (showLocal) source = { uri: local };
    else if (!current.waiting && !current.failed) {
      const uri = current.attempt > 0 ? `${url}${url.includes("?") ? "&" : "?"}attempt=${current.attempt}` : url;
      source = { uri, headers: { Authorization: `Bearer ${accessToken}` } };
    }
  }

  const onError = () => {
    if (showLocal) {
      setState({ ...current, localFailed: true });
      return;
    }
    const delay = mediaId ? PROFILE_PHOTO_RETRY_DELAYS_MS[current.attempt] : undefined;
    if (delay === undefined) {
      setState({ ...current, failed: true });
      return;
    }
    setState({ ...current, waiting: true });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      setState((latest) => (latest.key === key ? { ...latest, waiting: false, attempt: latest.attempt + 1 } : latest));
    }, delay);
  };

  return { source, onError, failed: current.failed };
}
