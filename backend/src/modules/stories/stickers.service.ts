/**
 * Interactive Story stickers: polls, quizzes, questions, countdowns, links and "Add Yours"
 * chains. The sticker is part of the Story (overlays); what people do with it is stored apart
 * (stickers.repository.ts) and attached for each viewer when the Story is read.
 *
 * Every action goes through the same door as watching the Story (authorizeStoryAccess): an
 * expired, deleted or removed Story, a block either way, a private account you don't follow,
 * an audience you're not in — each refuses the vote exactly as it refuses the view.
 */
import { assertCanContribute } from "../admin/account-policy";
import { HttpError } from "../../http/errors";
import { enforceAction } from "../safety/limits";
import { assertLinksAllowed } from "../safety/links";
import { learnQuietly } from "../recommendations/events.service";
import { authorizeStoryAccess, isActive } from "./stories.service";
import { parseStickerUrl } from "./dto";
import * as stickersRepo from "./stickers.repository";
import { INTERACTIVE_TYPES, type StoryOverlay, type PollOverlay, type QuizOverlay, type VoteResults } from "./overlays";
import type { StoryRecord } from "./stories.repository";

/** A person may answer one question sticker this many times (Instagram allows more than one). */
export const MAX_ANSWERS_PER_QUESTION = 5;

function isInteractive(overlay: StoryOverlay): boolean {
  return (INTERACTIVE_TYPES as readonly string[]).includes(overlay.type);
}

function resultsFrom(activity: stickersRepo.StickerActivity, overlay: PollOverlay | QuizOverlay, viewerChoice: number | null): VoteResults {
  const counts = overlay.properties.options.map((_, i) => activity.counts[`${overlay.id}:${i}`] ?? 0);
  return { counts, total: counts.reduce((a, b) => a + b, 0), viewerChoice };
}

/** A link sticker whose domain has since been blocked (or flagged) stops showing on read. */
async function linkStillAllowed(url: string): Promise<boolean> {
  try {
    await assertLinksAllowed(url, "story_link", null);
    return true;
  } catch {
    return false;
  }
}

/**
 * A Story's interactive stickers as this viewer should see them: results once they've
 * answered (always for the owner), a quiz's answer only then too, whether they asked to be
 * reminded, the "Add Yours" chain's own prompt and how many have joined. Other stickers pass
 * through untouched.
 */
export async function resolveStickersForViewer(overlays: StoryOverlay[], story: Pick<StoryRecord, "id" | "ownerId">, viewerId: string): Promise<StoryOverlay[]> {
  if (!overlays.some(isInteractive)) return overlays;
  const isOwner = story.ownerId === viewerId;
  const needsActivity = overlays.some((o) => o.type === "poll" || o.type === "quiz" || o.type === "question" || o.type === "countdown");
  const [activity, chain] = await Promise.all([
    needsActivity ? stickersRepo.stickerActivity(story.id, viewerId) : null,
    overlays.some((o) => o.type === "addYours") ? stickersRepo.chainOfStory(story.id) : null,
  ]);
  const summary = chain ? await stickersRepo.chainSummary(chain.id, viewerId) : null;

  const out: StoryOverlay[] = [];
  for (const overlay of overlays) {
    switch (overlay.type) {
      case "poll": {
        const choice = activity!.mine[overlay.id] ?? null;
        const seen = isOwner || choice !== null;
        out.push({ ...overlay, properties: { question: overlay.properties.question, options: overlay.properties.options, results: seen ? resultsFrom(activity!, overlay, choice) : null } });
        break;
      }
      case "quiz": {
        const choice = activity!.mine[overlay.id] ?? null;
        const seen = isOwner || choice !== null;
        const { correctIndex, question, options } = overlay.properties;
        out.push({
          ...overlay,
          properties: { question, options, ...(seen ? { correctIndex } : {}), results: seen ? resultsFrom(activity!, overlay, choice) : null },
        });
        break;
      }
      case "question":
        out.push({
          ...overlay,
          properties: isOwner
            ? { prompt: overlay.properties.prompt, responseCount: activity!.responses[overlay.id] ?? 0 }
            : { prompt: overlay.properties.prompt, viewerAnswered: activity!.answered.includes(overlay.id) },
        });
        break;
      case "countdown":
        out.push({
          ...overlay,
          properties: isOwner
            ? { title: overlay.properties.title, endsAt: overlay.properties.endsAt, reminderCount: activity!.reminders[overlay.id] ?? 0 }
            : { title: overlay.properties.title, endsAt: overlay.properties.endsAt, viewerReminded: activity!.reminded.includes(overlay.id) },
        });
        break;
      case "link":
        if (await linkStillAllowed(overlay.properties.url)) out.push(overlay);
        break;
      case "addYours":
        // Until the chain is linked (a moment after publishing) the sticker shows what was sent.
        out.push(chain && summary
          ? { ...overlay, properties: { prompt: chain.prompt, chainId: chain.id, participants: summary.participants, recent: summary.recent } }
          : { ...overlay, properties: { prompt: overlay.properties.prompt } });
        break;
      default:
        out.push(overlay);
    }
  }
  return out;
}

/** The sticker someone is acting on, on a Story they may see — never their own. */
async function stickerToAnswer<T extends StoryOverlay["type"]>(
  storyId: string,
  viewerId: string,
  stickerId: string,
  types: readonly T[],
  ownMessage: string,
): Promise<{ story: StoryRecord; overlay: Extract<StoryOverlay, { type: T }> }> {
  const story = await authorizeStoryAccess(storyId, viewerId);
  // Owners can open their own expired Stories (Archive); nobody answers one.
  if (!isActive(story)) throw new HttpError(404, "Story not found.");
  if (story.ownerId === viewerId) throw new HttpError(403, ownMessage);
  const overlay = story.overlays.find((o) => o.id === stickerId && (types as readonly string[]).includes(o.type));
  if (!overlay) throw new HttpError(404, "Sticker not found.");
  return { story, overlay: overlay as Extract<StoryOverlay, { type: T }> };
}

export interface VoteOutcome {
  results: VoteResults;
  /** Quizzes only: the right answer, now that they've answered. */
  correctIndex?: number;
  correct?: boolean;
}

/** One answer per person per poll or quiz. Repeating the same answer is fine; changing it isn't. */
export async function vote(viewerId: string, storyId: string, stickerId: string, option: number): Promise<VoteOutcome> {
  const { story, overlay } = await stickerToAnswer(storyId, viewerId, stickerId, ["poll", "quiz"] as const, "You can't answer your own Story's sticker.");
  if (option >= overlay.properties.options.length) throw new HttpError(422, "That option isn't on this sticker.", { option: "That option isn't on this sticker." });
  await enforceAction(viewerId, "vote");
  const inserted = await stickersRepo.insertVote(story.id, overlay.id, viewerId, option);
  if (!inserted) {
    const previous = await stickersRepo.findVote(story.id, overlay.id, viewerId);
    if (previous !== option) throw new HttpError(409, overlay.type === "quiz" ? "You've already answered this quiz." : "You've already voted on this poll.");
  } else {
    // Answering a Story's sticker is a clear sign of interest, like a like.
    await learnQuietly(viewerId, "like", { storyId: story.id });
  }
  const activity = await stickersRepo.stickerActivity(story.id, viewerId);
  const results = resultsFrom(activity, overlay, option);
  if (overlay.type === "quiz") {
    const correctIndex = overlay.properties.correctIndex!;
    return { results, correctIndex, correct: option === correctIndex };
  }
  return { results };
}

/** An answer to "Ask me anything": text only the Story's owner ever sees. */
export async function answerQuestion(viewerId: string, storyId: string, stickerId: string, body: string): Promise<{ id: string; createdAt: string }> {
  await assertCanContribute(viewerId);
  const { story, overlay } = await stickerToAnswer(storyId, viewerId, stickerId, ["question"] as const, "You can't answer your own question.");
  await enforceAction(viewerId, "answer");
  // Private to the creator, like a DM: the same link rules as messages.
  await assertLinksAllowed(body, "message", viewerId);
  if ((await stickersRepo.countOwnResponses(story.id, overlay.id, viewerId)) >= MAX_ANSWERS_PER_QUESTION) {
    throw new HttpError(429, "You've already sent several answers to this question.");
  }
  const response = await stickersRepo.insertQuestionResponse(story.id, overlay.id, viewerId, body);
  await learnQuietly(viewerId, "comment", { storyId: story.id });
  return response;
}

/** "Remind me" on or off. The push goes when the countdown ends (push/dispatcher.ts re-checks it then). */
export async function setReminder(viewerId: string, storyId: string, stickerId: string, on: boolean): Promise<{ reminded: boolean }> {
  const { story, overlay } = await stickerToAnswer(storyId, viewerId, stickerId, ["countdown"] as const, "You can't set a reminder on your own countdown.");
  if (on) {
    if (new Date(overlay.properties.endsAt).getTime() <= Date.now()) throw new HttpError(409, "This countdown has already ended.");
    await enforceAction(viewerId, "vote");
    await stickersRepo.addReminder(story.id, overlay.id, viewerId, story.ownerId, overlay.properties.endsAt);
  } else {
    await stickersRepo.removeReminder(story.id, overlay.id, viewerId);
  }
  return { reminded: on };
}

/** The owner's own sticker (their Insights), on a Story that hasn't been deleted — expired is fine. */
async function ownSticker(ownerId: string, storyId: string, stickerId: string): Promise<{ story: StoryRecord; overlay: StoryOverlay }> {
  const story = await authorizeStoryAccess(storyId, ownerId);
  if (story.ownerId !== ownerId) throw new HttpError(404, "Story not found.");
  const overlay = story.overlays.find((o) => o.id === stickerId && isInteractive(o));
  if (!overlay) throw new HttpError(404, "Sticker not found.");
  return { story, overlay };
}

export type StickerResponses =
  | { type: "poll" | "quiz"; voters: stickersRepo.StickerVoter[] }
  | { type: "question"; responses: stickersRepo.QuestionResponse[] };

/** Owner-only: who voted (and what), or the answers to a question. */
export async function listResponses(ownerId: string, storyId: string, stickerId: string, limit: number, offset: number): Promise<StickerResponses> {
  const { story, overlay } = await ownSticker(ownerId, storyId, stickerId);
  if (overlay.type === "poll" || overlay.type === "quiz") {
    return { type: overlay.type, voters: await stickersRepo.listVoters(story.id, overlay.id, ownerId, limit, offset) };
  }
  if (overlay.type === "question") {
    return { type: "question", responses: await stickersRepo.listQuestionResponses(story.id, overlay.id, ownerId, limit, offset) };
  }
  throw new HttpError(404, "This sticker has no responses to list.");
}

/** Owner-only: clears one answer from their list. */
export async function deleteResponse(ownerId: string, storyId: string, stickerId: string, responseId: string): Promise<void> {
  const { story, overlay } = await ownSticker(ownerId, storyId, stickerId);
  if (overlay.type !== "question" || !/^[0-9a-f-]{36}$/i.test(responseId)) throw new HttpError(404, "Answer not found.");
  if (!(await stickersRepo.deleteQuestionResponse(story.id, responseId))) throw new HttpError(404, "Answer not found.");
}

/**
 * Checked while the sticker is made, so the editor can say so at once instead of the Story
 * failing to post: the same URL rules (dto.ts) and link-safety policy the publish applies.
 */
export async function checkLink(userId: string, raw: unknown): Promise<string> {
  const url = parseStickerUrl(raw);
  if (!url) throw new HttpError(422, "Enter a web address that starts with http:// or https://.", { url: "Enter a valid web address." });
  await assertLinksAllowed(url, "story_link", userId);
  return url;
}

/** Every link sticker on a Story being published must pass the link-safety policy. */
export async function assertStickerLinksAllowed(overlays: StoryOverlay[], authorId: string): Promise<void> {
  for (const overlay of overlays) {
    if (overlay.type === "link") await assertLinksAllowed(overlay.properties.url, "story_link", authorId);
  }
}

/**
 * After publishing: a Story with an "Add Yours" sticker starts a chain, or joins the one it
 * was posted from. Joining needs a Story in that chain the poster may see (the chain id can't
 * be guessed into); otherwise their prompt starts a chain of its own.
 */
export async function linkAddYours(story: StoryRecord): Promise<void> {
  const sticker = story.overlays.find((o) => o.type === "addYours");
  if (!sticker || sticker.type !== "addYours") return;
  let joinId: string | null = null;
  if (sticker.properties.chainId) {
    const chain = await stickersRepo.findChain(sticker.properties.chainId);
    if (chain && (await stickersRepo.listChainStories(chain.id, story.ownerId, 1, 0)).length > 0) joinId = chain.id;
  }
  await stickersRepo.linkStoryToChain(story.id, story.ownerId, sticker.properties.prompt, joinId);
}

export interface ChainView {
  chain: { id: string; prompt: string; participants: number };
  stories: stickersRepo.ChainStory[];
}

/** An "Add Yours" chain's Stories this viewer may see. A chain they can see none of doesn't exist for them. */
export async function getChain(viewerId: string, chainId: string, limit: number, offset: number): Promise<ChainView> {
  const notFound = new HttpError(404, "This Add Yours isn't available.");
  if (!/^[0-9a-f-]{36}$/i.test(chainId)) throw notFound;
  const chain = await stickersRepo.findChain(chainId);
  if (!chain) throw notFound;
  const stories = await stickersRepo.listChainStories(chain.id, viewerId, limit, offset);
  if (offset === 0 && stories.length === 0) throw notFound;
  const summary = await stickersRepo.chainSummary(chain.id, viewerId);
  return { chain: { id: chain.id, prompt: chain.prompt, participants: summary.participants }, stories };
}
