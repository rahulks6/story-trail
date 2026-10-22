/**
 * Group chats: 3 to 32 people. Whoever makes a group is its admin; any member can add people
 * they're connected to (a follow either way, no block) and rename the group; admins can remove
 * people; anyone can leave. Each change is a line in the thread ("@asha added @dev"), and a
 * member sees the messages sent after they joined.
 */
import { HttpError } from "../../http/errors";
import { ValidationError } from "../auth/dto";
import { enforceAction } from "../safety/limits";
import { assertCanContribute } from "../admin/account-policy";
import { assertLinksAllowed } from "../safety/links";
import * as conversationsRepo from "./conversations.repository";
import * as groupsRepo from "./groups.repository";
import { getConversation, requireParticipant, type GroupDetails } from "./conversations.service";

export const MAX_GROUP_MEMBERS = 32;
export const MAX_GROUP_TITLE = 60;

const PROBLEM_TEXT: Record<NonNullable<groupsRepo.AddableCheck["problem"]>, string> = {
  not_found: "isn't on Katkee",
  self: "is you",
  blocked: "can't be added",
  not_connected: "isn't connected to you: add people you follow or who follow you",
};

export function parseUsernames(value: unknown, max = MAX_GROUP_MEMBERS): string[] {
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) throw new ValidationError({ usernames: "usernames must be a list of usernames." });
  const names = [...new Set((value as string[]).map((v) => v.trim().replace(/^@/, "").toLowerCase()).filter(Boolean))];
  if (names.length === 0) throw new ValidationError({ usernames: "Choose at least one person." });
  if (names.length > max || names.some((n) => n.length > 30)) throw new ValidationError({ usernames: `At most ${max} people.` });
  return names;
}

export function parseTitle(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new ValidationError({ title: "title must be text." });
  const title = value.trim().replace(/\s+/g, " ");
  if (title.length > MAX_GROUP_TITLE) throw new ValidationError({ title: `Group names can be at most ${MAX_GROUP_TITLE} characters.` });
  return title || null;
}

async function addableIds(viewerId: string, usernames: string[]): Promise<string[]> {
  const checks = await groupsRepo.checkAddable(viewerId, usernames);
  const refused = checks.filter((c) => c.problem);
  if (refused.length) {
    throw new HttpError(422, refused.map((c) => `@${c.username} ${PROBLEM_TEXT[c.problem!]}`).join(". ") + ".", { usernames: "Some people can't be added." });
  }
  return checks.map((c) => c.userId!);
}

async function requireGroup(conversationId: string, viewerId: string) {
  const conversation = await requireParticipant(conversationId, viewerId);
  if (conversation.kind !== "group") throw new HttpError(404, "Group not found.");
  return conversation;
}

async function details(viewerId: string, conversationId: string): Promise<GroupDetails> {
  return (await getConversation(viewerId, conversationId, true)) as GroupDetails;
}

export async function createGroup(viewerId: string, usernames: string[], title: string | null): Promise<GroupDetails> {
  await assertCanContribute(viewerId);
  if (title) await assertLinksAllowed(title, "message", viewerId);
  if (usernames.length < 2) throw new ValidationError({ usernames: "A group needs at least two other people. For one, start a chat." });
  if (usernames.length + 1 > MAX_GROUP_MEMBERS) throw new ValidationError({ usernames: `A group can have up to ${MAX_GROUP_MEMBERS} people, you included.` });
  const ids = await addableIds(viewerId, usernames);
  await enforceAction(viewerId, "conversation"); // the same budget as starting new chats
  const id = await groupsRepo.createGroup(viewerId, title, ids);
  await conversationsRepo.createGroupEvent(id, viewerId, { type: "created", title });
  return details(viewerId, id);
}

export async function addPeople(viewerId: string, conversationId: string, usernames: string[]): Promise<GroupDetails> {
  await requireGroup(conversationId, viewerId);
  await assertCanContribute(viewerId);
  const ids = await addableIds(viewerId, usernames);
  const current = await groupsRepo.countActiveMembers(conversationId);
  const active = new Set((await conversationsRepo.listActiveMembers(conversationId)).map((m) => m.userId));
  const fresh = ids.filter((id) => !active.has(id));
  if (current + fresh.length > MAX_GROUP_MEMBERS) throw new HttpError(422, `A group can have up to ${MAX_GROUP_MEMBERS} people.`);
  const joined = fresh.length ? await groupsRepo.addMembers(conversationId, viewerId, fresh) : [];
  if (joined.length) await conversationsRepo.createGroupEvent(conversationId, viewerId, { type: "added", userIds: joined });
  return details(viewerId, conversationId);
}

/** An admin takes someone out (to leave yourself, use leaveGroup). */
export async function removePerson(viewerId: string, conversationId: string, userId: string): Promise<GroupDetails> {
  const group = await requireGroup(conversationId, viewerId);
  if (group.role !== "admin") throw new HttpError(403, "Only the group's admins can remove people.");
  if (userId === viewerId) throw new HttpError(422, "To leave the group, use Leave.");
  const removed = /^[0-9a-f-]{36}$/i.test(userId) && (await groupsRepo.removeMember(conversationId, userId));
  if (!removed) throw new HttpError(404, "That person isn't in this group.");
  // They're told too, so their app drops the thread.
  await conversationsRepo.createGroupEvent(conversationId, viewerId, { type: "removed", userIds: [userId] }, [userId]);
  return details(viewerId, conversationId);
}

export async function leaveGroup(viewerId: string, conversationId: string): Promise<void> {
  await requireGroup(conversationId, viewerId);
  await conversationsRepo.createGroupEvent(conversationId, viewerId, { type: "left" });
  await groupsRepo.removeMember(conversationId, viewerId);
}

export async function renameGroup(viewerId: string, conversationId: string, title: string | null): Promise<GroupDetails> {
  const group = await requireGroup(conversationId, viewerId);
  await assertCanContribute(viewerId);
  if (title) await assertLinksAllowed(title, "message", viewerId);
  if ((group.title ?? null) !== title) {
    await groupsRepo.renameGroup(conversationId, title);
    await conversationsRepo.createGroupEvent(conversationId, viewerId, { type: "renamed", title });
  }
  return details(viewerId, conversationId);
}
