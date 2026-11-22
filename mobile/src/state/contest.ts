import { useCallback, useEffect, useState } from "react";
import { getContest, type Contest } from "../api/growth";
import { useAuth } from "./AuthContext";
import { localeTag } from "../i18n";

/**
 * The invite contest (backend growth/contest.ts): Home's 🏆 button, its one-time intro and the
 * contest screen share one copy, fetched again when it's older than a few minutes.
 */
const FRESH_MS = 5 * 60 * 1000;
let cached: { userId: string; at: number; contest: Contest | null } | null = null;
const listeners = new Set<() => void>();

export async function loadContest(accessToken: string, userId: string, force = false): Promise<Contest | null> {
  if (!force && cached && cached.userId === userId && Date.now() - cached.at < FRESH_MS) return cached.contest;
  const { contest } = await getContest(accessToken);
  cached = { userId, at: Date.now(), contest };
  for (const listener of listeners) listener();
  return contest;
}

/** The contest, or null (none on, not shown in this language, or not loaded yet). */
export function useContest(): { contest: Contest | null; reload: () => Promise<void> } {
  const { user, accessToken } = useAuth();
  const [contest, setContest] = useState<Contest | null>(cached && cached.userId === user?.id ? cached.contest : null);
  const userId = user?.id;
  useEffect(() => {
    if (!userId || !accessToken) return;
    const update = () => { if (cached?.userId === userId) setContest(cached.contest); };
    listeners.add(update);
    void loadContest(accessToken, userId).then(update, () => undefined);
    return () => { listeners.delete(update); };
  }, [userId, accessToken]);
  const reload = useCallback(async () => {
    if (userId && accessToken) await loadContest(accessToken, userId, true);
  }, [userId, accessToken]);
  return { contest, reload };
}

/** ₹1,000 written the Indian way, whatever the app's language. */
export function prizeAmount(contest: Contest): string {
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(contest.prize.amountMinor / 100);
}

/** A contest date in India time (the contest's dates are India's), e.g. "21 Dec". */
export function contestDate(iso: string, endOfPeriod = false): string {
  const at = new Date(Date.parse(iso) - (endOfPeriod ? 1 : 0));
  return at.toLocaleDateString(localeTag(), { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });
}

/** Whole days left to invite, counting today (1 on the last day); 0 once invites have closed. */
export function daysLeft(contest: Contest, now = Date.now()): number {
  const left = Date.parse(contest.endsAt) - now;
  return left <= 0 ? 0 : Math.ceil(left / (24 * 3600 * 1000));
}

/** For tests. */
export function resetContestCache(): void {
  cached = null;
}
