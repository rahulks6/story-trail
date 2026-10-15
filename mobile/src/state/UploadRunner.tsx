import { useCallback, useEffect, useRef } from "react";
import { useAuth } from "./AuthContext";
import { listUploads, runUpload, subscribeUploads, uploadRunning, type UploadJob } from "./uploadQueue";

/**
 * Sends saved Stories in the background while the app is open (like Instagram): one upload at a
 * time, and Stories already on the server are checked on until they post. It used to run only
 * while the Story uploads page was open, so sharing had to show that page.
 */
export function UploadRunner(): null {
  const { user, accessToken } = useAuth();
  const session = useRef<{ ownerId: string; token: string } | null>(null);
  session.current = user && accessToken ? { ownerId: user.id, token: accessToken } : null;

  const tick = useCallback(async () => {
    if (!user) return;
    let jobs: UploadJob[];
    try {
      jobs = await listUploads(user.id);
    } catch {
      return;
    }
    const run = (job: UploadJob) => void runUpload(job.ownerId, job.id, () => session.current).catch(() => undefined);
    for (const job of jobs) if (job.status === "processing" && !uploadRunning(job.ownerId, job.id)) run(job);
    if (jobs.some((j) => j.status !== "processing" && uploadRunning(j.ownerId, j.id))) return;
    const next = jobs.find((j) => j.status === "queued");
    if (next) run(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  useEffect(() => {
    void tick();
    return subscribeUploads(() => void tick());
  }, [tick]);

  return null;
}
