/**
 * Something to start the next Story with, set just before opening Create from elsewhere:
 * - an "Add Yours" prompt from someone's Story (the new Story joins that chain);
 * - an answer to your question sticker, shared to your Story (the question and the answer,
 *   never who sent it).
 * Create's own tab has no route params to carry it (Camera replaces itself with the editor),
 * so it waits here. It's for the next Story only: shared, closed or left for half an hour,
 * it's gone.
 */
export type CreateSeed =
  | { kind: "addYours"; prompt: string; chainId: string }
  | { kind: "answer"; prompt: string; answer: string };

const MAX_AGE_MS = 30 * 60 * 1000;
let pending: { seed: CreateSeed; at: number } | null = null;
const listeners = new Set<() => void>();

export function setCreateSeed(seed: CreateSeed): void {
  pending = { seed, at: Date.now() };
  listeners.forEach((fn) => fn());
}

/** The seed waiting for the next Story, if it's still fresh. */
export function currentCreateSeed(): CreateSeed | null {
  if (pending && Date.now() - pending.at > MAX_AGE_MS) pending = null;
  return pending?.seed ?? null;
}

export function clearCreateSeed(): void {
  if (!pending) return;
  pending = null;
  listeners.forEach((fn) => fn());
}

export function onCreateSeedChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
