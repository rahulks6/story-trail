import { apiDelete, apiGet, apiPost, apiPut } from "./client";
import type { VoteResults } from "../models/storyDraft";
import type { CollabPerson, StoryCollab } from "./stories";
import { t } from "../i18n";

/**
 * Interactive stickers, "Add Yours" chains and Collab Stories — mirrors backend
 * stories/stickers.routes.ts. Every call is refused exactly as viewing the Story would be
 * (expired, blocked, private, outside its audience).
 */

const sticker = (storyId: string, stickerId: string) => t("stickers.apiV1StoriesStoryidStickers", { storyId, stickerId: encodeURIComponent(stickerId) });

export interface VoteOutcome {
  results: VoteResults;
  /** Quizzes: the right answer, now that you've answered. */
  correctIndex?: number;
  correct?: boolean;
}

/** One answer per person per poll or quiz (409 when you've already chosen differently). */
export function voteOnSticker(storyId: string, stickerId: string, option: number, accessToken: string): Promise<VoteOutcome> {
  return apiPost(`${sticker(storyId, stickerId)}/vote`, { option }, accessToken);
}

/** An answer to a question sticker: only the Story's owner ever sees it. */
export function answerQuestion(storyId: string, stickerId: string, body: string, accessToken: string): Promise<{ answer: { id: string; createdAt: string } }> {
  return apiPost(`${sticker(storyId, stickerId)}/answers`, { body }, accessToken);
}

/** "Remind me" when a countdown ends (a push then), or not. */
export function setCountdownReminder(storyId: string, stickerId: string, on: boolean, accessToken: string): Promise<{ reminded: boolean }> {
  return on ? apiPut(`${sticker(storyId, stickerId)}/reminder`, undefined, accessToken) : apiDelete(`${sticker(storyId, stickerId)}/reminder`, accessToken);
}

export interface StickerVoter extends CollabPerson {
  option: number;
  votedAt: string;
}

export interface QuestionResponse {
  id: string;
  body: string;
  createdAt: string;
  responder: CollabPerson;
}

export type StickerResponses =
  | { type: "poll" | "quiz"; voters: StickerVoter[] }
  | { type: "question"; responses: QuestionResponse[] };

/** Owner-only: who voted and what, or the answers to a question. */
export function listStickerResponses(storyId: string, stickerId: string, accessToken: string, page: { limit?: number; offset?: number } = {}): Promise<StickerResponses> {
  const query = new URLSearchParams({ limit: String(page.limit ?? 50), offset: String(page.offset ?? 0) });
  return apiGet(`${sticker(storyId, stickerId)}/responses?${query.toString()}`, accessToken);
}

export function deleteStickerResponse(storyId: string, stickerId: string, responseId: string, accessToken: string): Promise<void> {
  return apiDelete(`${sticker(storyId, stickerId)}/responses/${responseId}`, accessToken);
}

/** Whether a link sticker may be posted (link-safety policy); the address as it will be saved. */
export function checkStickerLink(url: string, accessToken: string): Promise<{ url: string }> {
  return apiPost("/api/v1/stories/link-check", { url }, accessToken);
}

export interface ChainStory {
  storyId: string;
  mediaId: string;
  createdAt: string;
  owner: CollabPerson;
}

/** An "Add Yours" chain: its prompt, how many have joined, and the Stories you may see. */
export function getAddYoursChain(chainId: string, accessToken: string, page: { limit?: number; offset?: number } = {}): Promise<{ chain: { id: string; prompt: string; participants: number }; stories: ChainStory[] }> {
  const query = new URLSearchParams({ limit: String(page.limit ?? 30), offset: String(page.offset ?? 0) });
  return apiGet(`/api/v1/add-yours/${chainId}?${query.toString()}`, accessToken);
}

/** The people you may invite to a Collab Story, best match first. */
export function listCollabCandidates(search: string, accessToken: string): Promise<{ people: CollabPerson[] }> {
  return apiGet(`/api/v1/collab-candidates?q=${encodeURIComponent(search)}`, accessToken);
}

export function respondToCollab(storyId: string, accept: boolean, accessToken: string): Promise<{ collab: StoryCollab }> {
  return apiPost(`/api/v1/stories/${storyId}/collab/${accept ? "accept" : "decline"}`, undefined, accessToken);
}

/** The owner removes the collaborator, or the collaborator leaves. */
export function endCollab(storyId: string, accessToken: string): Promise<void> {
  return apiDelete(`/api/v1/stories/${storyId}/collab`, accessToken);
}
