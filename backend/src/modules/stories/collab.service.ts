/**
 * Collab Stories: the owner invites one person when posting (someone who follows them, or
 * whom they follow); the invitation arrives in Activity with Accept and Decline. Accepted, the
 * Story shows in both people's rings, to both sets of followers (audience.ts has the exact
 * rule), with both names at the top. The Story stays the owner's: their media, audience,
 * Insights and delete. Either of them can end it — the owner by removing the collaborator,
 * the collaborator by leaving — and a block between them ends it on its own.
 */
import { HttpError } from "../../http/errors";
import * as notificationsRepo from "../notifications/notifications.repository";
import * as storiesRepo from "./stories.repository";
import * as collabRepo from "./collab.repository";
import type { CollabPerson, CollabRecord, CollabStatus } from "./collab.repository";
import type { StoryRecord } from "./stories.repository";

/** What a Story says about its collab, to one viewer. */
export interface CollabView {
  status: CollabStatus;
  owner: CollabPerson;
  collaborator: CollabPerson;
}

/**
 * Everyone sees a live collab (both names on the Story). An invitation still waiting, or one
 * declined, is between the two of them: only the owner and the invited person see it.
 */
export function collabViewFor(record: CollabRecord | undefined | null, viewerId: string): CollabView | null {
  if (!record) return null;
  const involved = viewerId === record.owner.id || viewerId === record.collaborator.id;
  if (record.live) return { status: "accepted", owner: record.owner, collaborator: record.collaborator };
  if (!involved) return null;
  // Accepted but not live (a block between them since): to them it's simply over.
  return { status: record.status === "accepted" ? "declined" : record.status, owner: record.owner, collaborator: record.collaborator };
}

/** Before a publish is accepted: the person may be invited at all. */
export async function assertCanInvite(ownerId: string, collaboratorId: string): Promise<void> {
  if (!(await collabRepo.canInvite(ownerId, collaboratorId))) {
    throw new HttpError(422, "You can invite someone who follows you or whom you follow.", { collaboratorId: "You can invite someone who follows you or whom you follow." });
  }
}

/**
 * After publishing: the invitation is sent — if it still may be. Media can take minutes to
 * process, and a block or an unfollow in that time withdraws it instead.
 */
export async function sendInvitation(story: StoryRecord): Promise<void> {
  const record = await collabRepo.findCollab(story.id);
  if (!record || record.status !== "pending") return;
  if (!(await collabRepo.canInvite(story.ownerId, record.collaborator.id))) {
    await collabRepo.remove(story.id);
    return;
  }
  await notificationsRepo.createNotification({ recipientId: record.collaborator.id, actorId: story.ownerId, type: "collab_invite", storyId: story.id });
}

async function invitedStory(storyId: string): Promise<StoryRecord> {
  if (!/^[0-9a-f-]{36}$/i.test(storyId)) throw new HttpError(404, "Invitation not found.");
  const story = await storiesRepo.findStoryById(storyId);
  if (!story || story.deletedAt !== null || new Date(story.expiresAt).getTime() <= Date.now()) throw new HttpError(404, "Invitation not found.");
  return story;
}

/** The invited person says yes or no. Only a pending invitation to them can be answered. */
export async function respond(userId: string, storyId: string, accept: boolean): Promise<CollabView> {
  const story = await invitedStory(storyId);
  const record = await collabRepo.findCollab(story.id);
  if (!record || record.collaborator.id !== userId) throw new HttpError(404, "Invitation not found.");
  if (record.status !== "pending") throw new HttpError(409, "You've already answered this invitation.");
  // Accepting needs the two of them still connected (a block or both unfollowing since ends it).
  if (accept && !(await collabRepo.canInvite(story.ownerId, userId))) {
    await collabRepo.remove(story.id);
    throw new HttpError(404, "Invitation not found.");
  }
  if (!(await collabRepo.respond(story.id, userId, accept ? "accepted" : "declined"))) throw new HttpError(409, "You've already answered this invitation.");
  if (accept) await notificationsRepo.createNotification({ recipientId: story.ownerId, actorId: userId, type: "collab_accepted", storyId: story.id });
  return collabViewFor(await collabRepo.findCollab(story.id), userId)!;
}

/**
 * Ends a collab. The owner removes the collaborator (or withdraws a waiting invitation); the
 * collaborator leaves one they accepted.
 */
export async function end(userId: string, storyId: string): Promise<void> {
  if (!/^[0-9a-f-]{36}$/i.test(storyId)) throw new HttpError(404, "Story not found.");
  const record = await collabRepo.findCollab(storyId);
  if (!record) throw new HttpError(404, "This Story has no collaborator.");
  if (record.owner.id === userId) {
    await collabRepo.remove(storyId);
    return;
  }
  if (record.collaborator.id === userId) {
    if (!(await collabRepo.leave(storyId, userId))) throw new HttpError(409, "You're not a collaborator on this Story.");
    return;
  }
  throw new HttpError(404, "This Story has no collaborator.");
}

/** The people the owner may invite (Story editor's picker). */
export async function listInvitable(ownerId: string, search: string): Promise<CollabPerson[]> {
  const q = search.trim().replace(/^@/, "").slice(0, 30);
  return collabRepo.listInvitable(ownerId, q, 20);
}
