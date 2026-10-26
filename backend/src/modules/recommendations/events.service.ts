import { HttpError } from "../../http/errors";
import * as usersRepo from "../users/users.repository";
import { getStoryForViewer } from "../stories/stories.service";
import * as eventsRepo from "./events.repository";
import * as notInterestedRepo from "./not-interested.repository";
import * as topicAffinity from "./topic-affinity.repository";
import { QUICK_SKIP_MS, type TopicSignal } from "./scoring";
import type { EventType, RecordEventInput } from "./events.dto";

/** Which events teach Home what the viewer likes (scoring.ts TOPIC_SIGNALS); impressions and navigation don't. */
const TOPIC_SIGNAL_FOR: Partial<Record<EventType, TopicSignal>> = {
  qualified_view: "qualified_view",
  story_complete: "story_complete",
  story_replay: "story_replay",
  profile_visit: "profile_visit",
  quick_creator_skip: "quick_skip",
  not_interested: "not_interested",
  more_like_this: "more_like_this",
};

function topicSignal(input: RecordEventInput): TopicSignal | null {
  if (input.eventType === "watch_duration") return input.valueMs !== undefined && input.valueMs < QUICK_SKIP_MS ? "quick_skip" : null;
  return TOPIC_SIGNAL_FOR[input.eventType] ?? null;
}

/** Learning interests never stands in the way of what the viewer did. */
export async function learnQuietly(viewerId: string, signal: TopicSignal, target: { storyId?: string; creatorId?: string }): Promise<void> {
  try {
    await topicAffinity.learnFromSignal(viewerId, signal, target);
  } catch (err) {
    console.error("topic affinity update failed", signal, err);
  }
}

export async function recordEvent(viewerId: string, input: RecordEventInput): Promise<void> {
  if (input.creatorId) {
    if (input.creatorId === viewerId) {
      // Self-directed events (e.g. viewing your own profile) aren't a
      // recommendation signal — see spec section 11's self-view guard.
      return;
    }
    const creator = await usersRepo.findUserById(input.creatorId);
    if (!creator) throw new HttpError(404, "creatorId does not refer to a real user.");
  }

  let storyOwner: string | undefined;
  if (input.storyId) {
    // Reuses the exact same access rule as viewing the Story itself — a
    // client can't manufacture engagement signal for content it can't see.
    storyOwner = (await getStoryForViewer(input.storyId, viewerId)).ownerId;
    // "Show more like this" on your own Story says nothing about what you like to watch.
    if (input.eventType === "more_like_this" && storyOwner === viewerId) return;
  }

  await eventsRepo.insertEvent({
    viewerId,
    eventType: input.eventType,
    creatorId: input.creatorId ?? (input.eventType === "more_like_this" ? storyOwner : undefined),
    storyId: input.storyId,
    valueMs: input.valueMs,
  });

  if (input.eventType === "not_interested" && input.creatorId) {
    await notInterestedRepo.markNotInterested(viewerId, input.creatorId);
  }

  const signal = topicSignal(input);
  if (signal && storyOwner !== viewerId) {
    await learnQuietly(viewerId, signal, input.storyId ? { storyId: input.storyId } : { creatorId: input.creatorId! });
  }
}
