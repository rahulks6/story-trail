import { useCallback, useEffect, useRef } from "react";
import { AppState } from "react-native";
import { useAuth } from "./AuthContext";
import { useRealtimeEventsIfAvailable } from "./RealtimeContext";
import { autoResumeDue, listUploads, nextAutoResumeAt, runUpload, subscribeUploads, uploadRunning, wasInterrupted, type UploadJob } from "./uploadQueue";

/**
 * Sends saved Stories in the background while the app is open (like Instagram): one upload at a
 * time, and Stories already on the server are checked on until they post. It used to run only
 * while the Story uploads page was open, so sharing had to show that page.
 *
 * Stories interrupted part-way (the app was closed or put away mid-upload) continue by themselves,
 * and one that failed only because the connection dropped is tried again with backoff (a few
 * times, see AUTO_RETRY_LIMIT) — straight away when the app comes back or the live connection
 * returns, since the network is likely working again.
 */
export function UploadRunner(): null {
  const { user, accessToken } = useAuth();
  const session = useRef<{ ownerId: string; token: string } | null>(null);
  session.current = user && accessToken ? { ownerId: user.id, token: accessToken } : null;
  const wakeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const tick = useCallback(async (networkBack = false) => {
    if (!user) return;
    let jobs: UploadJob[];
    try {
      jobs = await listUploads(user.id);
    } catch {
      return;
    }
    const run = (job: UploadJob) => void runUpload(job.ownerId, job.id, () => session.current).catch(() => undefined);
    for (const job of jobs) if (job.status === "processing" && !uploadRunning(job.ownerId, job.id)) run(job);
    // Wake up again when the next connection-failed Story is due another try.
    if (wakeTimer.current) clearTimeout(wakeTimer.current);
    wakeTimer.current = null;
    const due = jobs.map(nextAutoResumeAt).filter((at): at is number => at !== null);
    if (due.length) wakeTimer.current = setTimeout(() => { wakeTimer.current = null; void tick(); }, Math.max(1000, Math.min(...due) - Date.now()));
    if (jobs.some((j) => j.status !== "processing" && uploadRunning(j.ownerId, j.id))) return;
    // Oldest first: interrupted ones, then queued ones, then connection failures that are due.
    const oldest = [...jobs].reverse();
    const next = oldest.find(wasInterrupted) ?? oldest.find((j) => j.status === "queued") ?? oldest.find((j) => autoResumeDue(j, Date.now(), networkBack));
    if (next) run(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  useEffect(() => {
    void tick();
    const stop = subscribeUploads(() => void tick());
    const appState = AppState.addEventListener("change", (next) => { if (next === "active") void tick(true); });
    return () => {
      stop();
      appState.remove();
      if (wakeTimer.current) clearTimeout(wakeTimer.current);
      wakeTimer.current = null;
    };
  }, [tick]);

  // The live connection is back: the network works again.
  useRealtimeEventsIfAvailable((event) => { if (event.type === "resync") void tick(true); });

  return null;
}
