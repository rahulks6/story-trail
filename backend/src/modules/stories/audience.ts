/**
 * Who may see a Story, by its audience: the one rule every place a Story can be seen uses
 * (the Story itself, a creator's list, Highlights, the ranked home feed in SQL). The account
 * gates (blocks, a private account) are checked before this, by each caller.
 *
 * - public: anyone who may see the account;
 * - followers: people who follow the owner;
 * - close_friends: people on the owner's Close Friends list.
 */
import { queryOne } from "../../db/psql";
import type { Audience } from "./stories.repository";

export interface AudienceAccess {
  isFollowing: boolean;
  isCloseFriend: boolean;
}

export function audienceAllows(audience: Audience, access: AudienceAccess): boolean {
  if (audience === "public") return true;
  if (audience === "followers") return access.isFollowing;
  if (audience === "close_friends") return access.isCloseFriend;
  return false;
}

/** Whether `viewerId` is on `ownerId`'s Close Friends list. */
export async function isCloseFriendOf(ownerId: string, viewerId: string): Promise<boolean> {
  if (ownerId === viewerId) return false;
  const row = await queryOne(
    `SELECT EXISTS(SELECT 1 FROM close_friends WHERE owner_id = :'owner' AND friend_id = :'viewer') AS yes`,
    { owner: ownerId, viewer: viewerId },
  );
  return row?.yes === "t" || row?.yes === "true";
}

/** The SQL condition for a Story row `s` seen by :'viewer' (owner rows and account gates are separate). */
export const AUDIENCE_SQL = `(s.audience = 'public'
  OR (s.audience = 'followers' AND EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = :'viewer' AND f.followee_id = s.owner_id))
  OR (s.audience = 'close_friends' AND EXISTS (SELECT 1 FROM close_friends cf WHERE cf.owner_id = s.owner_id AND cf.friend_id = :'viewer')))`;
