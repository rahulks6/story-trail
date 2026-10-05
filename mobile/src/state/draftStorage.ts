/**
 * Crash-safe autosave for an in-progress Story edit (spec section 42's
 * publish flow: "prepare media → persist local draft → upload → process →
 * publish" — a distinct step, not just "keep it in React state until
 * Share is tapped"). Keyed by the source media's own URI, since that's
 * the one stable thing available both when a draft is saved and when
 * StoryEditorScreen re-mounts on that same file after a crash or reload.
 * Same AsyncStorage-behind-an-interface pattern as tokenStorage.ts.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { StoryDraft } from "../models/storyDraft";
import { isSavedDraft } from "./validateSavedDraft";

const KEY_PREFIX = "katkee.draft.v2.";

function ownerPrefix(ownerId: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ownerId)) throw new Error("Invalid draft owner");
  return `${KEY_PREFIX}${ownerId}.`;
}
function keyFor(ownerId: string, mediaUri: string): string {
  return `${ownerPrefix(ownerId)}${mediaUri}`;
}

export interface SavedDraft {
  draft: StoryDraft;
  audience: "public" | "followers";
  mimeType: string;
  savedAt: string;
}

export async function savePendingDraft(ownerId: string, mediaUri: string, saved: SavedDraft): Promise<void> {
  try {
    await AsyncStorage.setItem(keyFor(ownerId, mediaUri), JSON.stringify(saved));
  } catch {
    // Autosave is a safety net, not the primary path — a write failure here shouldn't interrupt editing.
  }
}

export async function loadPendingDraft(ownerId: string, mediaUri: string): Promise<SavedDraft | null> {
  try {
    const raw = await AsyncStorage.getItem(keyFor(ownerId, mediaUri));
    if (!raw) return null;
    const saved: unknown = JSON.parse(raw);
    return isSavedDraft(saved, mediaUri) ? saved : null;
  } catch {
    return null;
  }
}

export async function clearPendingDraft(ownerId: string, mediaUri: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(keyFor(ownerId, mediaUri));
  } catch {
    // Best-effort — a stale leftover entry only ever offers a (harmless) restore prompt for a since-published/discarded Story.
  }
}

/** Count only this account's drafts. Unattributed legacy drafts are never restored. */
export async function countPendingDrafts(ownerId: string): Promise<number> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    return keys.filter((key) => key.startsWith(ownerPrefix(ownerId))).length;
  } catch {
    return 0;
  }
}

/** Remove only this account's drafts, preserving other accounts' work. */
export async function clearAllPendingDrafts(ownerId: string): Promise<void> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const draftKeys = keys.filter((key) => key.startsWith(ownerPrefix(ownerId)));
    if (draftKeys.length > 0) await AsyncStorage.multiRemove(draftKeys);
  } catch {
    // Best-effort — same rationale as clearPendingDraft above.
  }
}
