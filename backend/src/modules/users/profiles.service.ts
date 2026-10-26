import { postingStreak } from "../reminders/return-reasons";
import { USERNAME_MESSAGES, usernameProblem } from "./username-policy";
import { ValidationError } from "../auth/dto";
import { assertLinksAllowed } from "../safety/links";
import { HttpError } from "../../http/errors";
import { DatabaseError } from "../../db/psql";
import * as usersRepo from "../users/users.repository";
import * as socialRepo from "../social/social.repository";
import * as eventsRepo from "../recommendations/events.repository";
import * as storiesRepo from "../stories/stories.repository";
import * as storiesService from "../stories/stories.service";
import * as refreshTokensRepo from "../auth/refresh-tokens.repository";
import { verifyPassword } from "../auth/password";

export interface ProfileView {
  id: string;
  username: string;
  displayName: string;
  bio: string;
  avatarMediaId: string | null;
  /** The banner at the top of the profile, served like the avatar (users.routes.ts). */
  coverMediaId: string | null;
  /** The verified badge (not while on hold after a rename). */
  verified: boolean;
  /** creator, public_figure, brand, news_media or organization; null unless verified. */
  verifiedCategory: string | null;
  interests: string[];
  isPrivate: boolean;
  isSelf: boolean;
  followerCount: number;
  /**
   * Consecutive days with a Story (India time): shown to anyone who can see this person's Stories,
   * so never for a private account you don't follow. Null when hidden; 0 when there's no streak.
   */
  streak: { days: number; postedToday: boolean } | null;
  followingCount: number;
  /** Stories posted so far (not deleted, expired included). Shown to everyone, like the follower count. */
  storyCount: number;
  viewer: {
    isFollowing: boolean;
    isFollowedBy: boolean;
    hasPendingRequestFromViewer: boolean;
    hasPendingRequestFromTarget: boolean;
    isMutedByViewer: boolean;
  };
}

export async function getProfileByUsername(username: string, viewerId: string): Promise<ProfileView> {
  return profileView(await usersRepo.findUserByUsername(username), viewerId);
}

/** The same profile found by the account's permanent ID, so a link still works after a rename. */
export async function getProfileById(id: string, viewerId: string): Promise<ProfileView> {
  return profileView(await usersRepo.findUserById(id), viewerId);
}

async function profileView(target: usersRepo.UserRecord | null, viewerId: string): Promise<ProfileView> {
  if (!target || !target.isActive) throw new HttpError(404, "User not found.");

  if (target.id !== viewerId) {
    const blocked = await socialRepo.anyBlockBetween(viewerId, target.id);
    if (blocked) throw new HttpError(404, "User not found.");
    // Real profile_visit signal for recommendation scoring (spec section
    // 7/12) — emitted here, server-side, rather than trusted from the
    // client, since this is exactly where a genuine profile view happens.
    await eventsRepo.insertEvent({ viewerId, eventType: "profile_visit", creatorId: target.id });
  }

  const [relationship, counts, storyCount, streak] = await Promise.all([
    socialRepo.getRelationship(viewerId, target.id),
    socialRepo.followCounts(target.id),
    storiesRepo.countStoriesForOwner(target.id),
    postingStreak(target.id),
  ]);
  const seesStories = target.id === viewerId || !target.isPrivate || relationship.isFollowing;

  return {
    id: target.id,
    username: target.username,
    displayName: target.displayName,
    bio: target.bio,
    avatarMediaId: target.avatarMediaId,
    coverMediaId: target.coverMediaId,
    verified: target.verified,
    verifiedCategory: target.verifiedCategory,
    interests: target.interests,
    isPrivate: target.isPrivate,
    isSelf: target.id === viewerId,
    followerCount: counts.followers,
    streak: seesStories ? streak : null,
    followingCount: counts.following,
    storyCount,
    viewer: {
      isFollowing: relationship.isFollowing,
      isFollowedBy: relationship.isFollowedBy,
      hasPendingRequestFromViewer: relationship.hasPendingRequestFromViewer,
      hasPendingRequestFromTarget: relationship.hasPendingRequestFromTarget,
      isMutedByViewer: relationship.isMutedByViewer,
    },
  };
}

/** Followers/following lists are gated the same way a private account's Stories will be: owner, or an accepted follower. */
async function assertCanViewConnections(target: usersRepo.UserRecord, viewerId: string): Promise<void> {
  if (target.id === viewerId) return;
  const blocked = await socialRepo.anyBlockBetween(viewerId, target.id);
  if (blocked) throw new HttpError(404, "User not found.");
  if (!target.isPrivate) return;
  const relationship = await socialRepo.getRelationship(viewerId, target.id);
  if (!relationship.isFollowing) {
    throw new HttpError(403, "This account is private.");
  }
}

export async function getFollowers(username: string, viewerId: string, limit: number, offset: number) {
  const target = await usersRepo.findUserByUsername(username);
  if (!target || !target.isActive) throw new HttpError(404, "User not found.");
  await assertCanViewConnections(target, viewerId);
  return socialRepo.listFollowers(target.id, limit, offset);
}

export async function getFollowing(username: string, viewerId: string, limit: number, offset: number) {
  const target = await usersRepo.findUserByUsername(username);
  if (!target || !target.isActive) throw new HttpError(404, "User not found.");
  await assertCanViewConnections(target, viewerId);
  return socialRepo.listFollowing(target.id, limit, offset);
}

export interface UpdateProfileInput {
  username?: string;
  displayName?: string;
  bio?: string;
  isPrivate?: boolean;
  interests?: string[];
  avatarMediaId?: string | null;
  coverMediaId?: string | null;
}

/**
 * A profile photo or cover must be a photo the person uploaded themselves, ready or still being
 * processed (the worker finishes it within seconds; until then the initial shows): never someone
 * else's upload, a video, an ID photo sent for verification (0057) or a Story export overlay.
 */
async function assertUsableProfilePhoto(userId: string, mediaId: string, message: string): Promise<void> {
  const { findMediaById } = await import("../media/media.repository");
  const media = await findMediaById(mediaId, true);
  if (!media || media.ownerId !== userId || media.kind !== "photo" || (media.status !== "ready" && media.status !== "processing") || media.verificationDocument || media.exportOverlay) {
    throw new HttpError(400, message);
  }
}

export async function updateMyProfile(userId: string, input: UpdateProfileInput): Promise<usersRepo.UserRecord> {
  const current = await usersRepo.findUserById(userId);
  if (!current) throw new HttpError(404, "User not found.");
  if (input.bio) await assertLinksAllowed(input.bio, "bio", userId);
  if (input.username !== undefined && input.username !== current.username) {
    const problem = usernameProblem(input.username);
    if (problem) throw new ValidationError({ username: problem.message });
    if (await usersRepo.usernameTaken(input.username, userId)) {
      throw new HttpError(409, "That username is already taken.");
    }
  }
  if (input.avatarMediaId) await assertUsableProfilePhoto(userId, input.avatarMediaId, "Choose a valid uploaded photo for your avatar.");
  if (input.coverMediaId) await assertUsableProfilePhoto(userId, input.coverMediaId, "Choose a valid uploaded photo for your cover.");
  try {
    // Username, avatar, cover and the remaining profile fields share one UPDATE so
    // a failed change cannot leave the account half-updated. A replaced or removed photo is
    // then unused, and the retention job deletes it (media/retention.ts).
    const saved = await usersRepo.setProfile(userId, input);
    if (current.isPrivate && !saved.isPrivate) await socialRepo.acceptAllPendingFollowRequests(userId);
    return saved;
  } catch (error) {
    // The preflight uniqueness check is user-friendly, but the partial unique
    // index is still the final authority when two edits race.
    if (error instanceof DatabaseError && error.detail.includes("users_username_unique")) {
      throw new HttpError(409, "That username is already taken.");
    }
    if (error instanceof DatabaseError && error.detail.includes("USERNAME_HELD")) {
      throw new HttpError(409, USERNAME_MESSAGES.held);
    }
    const limit = error instanceof DatabaseError ? /USERNAME_CHANGE_LIMIT (\S+)/.exec(error.detail) : null;
    if (limit) {
      const retryAt = new Date(limit[1]!);
      const seconds = Math.max(1, Math.ceil((retryAt.getTime() - Date.now()) / 1000));
      const message = `You can change your username twice in 14 days. Try again after ${retryAt.toISOString().slice(0, 10)}.`;
      throw new HttpError(429, message, { username: message }, { "Retry-After": String(seconds) });
    }
    throw error;
  }
}

/**
 * Real, in-app account deletion — required by both App Store review
 * (guideline 5.1.1(v): an app that supports account creation must also
 * support account deletion from inside the app) and Play Store policy,
 * not an optional nicety. Password-confirmed since it's irreversible.
 *
 * Withdraws the account's own active Stories first (soft-delete + the
 * same Highlight cleanup Phase 9 already wired into
 * moderatorDeleteStory), then the account itself, then revokes every
 * refresh token it holds — after this, login, refresh, and every lookup
 * that already filters `deleted_at IS NULL` treat this account as if it
 * never existed. What's deliberately NOT scrubbed: comments this account
 * left on *other* people's Stories, and direct-message history (a shared
 * conversation isn't only this account's to erase) — see
 * legal/PRIVACY_POLICY.md's retention section and
 * backend/README.md's own note on this for why that's a documented
 * scope decision, not an oversight.
 */
export async function deleteMyAccount(userId: string, password: string): Promise<void> {
  const current = await usersRepo.findUserById(userId);
  if (!current) throw new HttpError(404, "User not found.");

  const valid = await verifyPassword(password, current.passwordHash);
  if (!valid) throw new HttpError(401, "Incorrect password.");

  const activeStories = await storiesRepo.listActiveStoriesForOwner(userId);
  for (const story of activeStories) {
    await storiesService.moderatorDeleteStory(story.id);
  }

  await usersRepo.softDeleteUser(userId);
  await refreshTokensRepo.revokeAllRefreshTokensForUser(userId);
  await deleteVerificationQuietly(userId);
}

/**
 * A verification request and its ID photo go as soon as the account does. If storage fails
 * the account is still deleted; the 30-day account scrub (retention.ts) removes the rest.
 */
export async function deleteVerificationQuietly(userId: string): Promise<void> {
  try {
    const [{ deleteForAccount }, { mediaStorage }] = await Promise.all([import("../verification/verification.service"), import("../media/instance")]);
    await deleteForAccount(mediaStorage, userId);
  } catch (error) {
    console.error(JSON.stringify({ event: "verification_delete_failed", error: error instanceof Error ? error.message : "unknown" }));
  }
}

