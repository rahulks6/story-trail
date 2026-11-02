/**
 * Who may see a Story, by its audience: the one rule every place a Story can be seen uses
 * (the Story itself, a creator's list, Highlights, the ranked home feed in SQL). The account
 * gates (blocks, a private account) are checked before this, by each caller.
 *
 * - public: anyone who may see the account;
 * - followers: people who follow the owner — or, on a Collab Story, its collaborator;
 * - close_friends: people on the owner's Close Friends list.
 *
 * Collab Stories (migration 0063) bring the collaborator's followers, never past the owner's
 * own gates: a private owner's collab is still seen only by the owner's followers, and anyone
 * blocked by (or blocking) the collaborator doesn't see it either. The person invited sees the
 * Story while they decide, so they know what they're agreeing to.
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

/** :'viewer' has been invited to collaborate on Story `s` and hasn't said no. */
export const INVITED_SQL = `EXISTS (SELECT 1 FROM story_collaborators ic WHERE ic.story_id = s.id AND ic.user_id = :'viewer' AND ic.status <> 'declined')`;

/** The SQL condition for a Story row `s` seen by :'viewer' (owner rows and account gates are separate). */
export const AUDIENCE_SQL = `(s.audience = 'public'
  OR (s.audience = 'followers' AND EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = :'viewer' AND f.followee_id = s.owner_id))
  OR (s.audience = 'followers' AND EXISTS (SELECT 1 FROM story_collabs_live cl JOIN follows f ON f.followee_id = cl.user_id
                                           WHERE cl.story_id = s.id AND f.follower_id = :'viewer'))
  OR (s.audience = 'close_friends' AND EXISTS (SELECT 1 FROM close_friends cf WHERE cf.owner_id = s.owner_id AND cf.friend_id = :'viewer'))
  OR ${INVITED_SQL})`;

/** No block either way between :'viewer' and Story `s`'s live collaborator. */
export const COLLAB_BLOCKS_SQL = `NOT EXISTS (SELECT 1 FROM story_collabs_live cb JOIN blocks b
    ON (b.blocker_id = :'viewer' AND b.blocked_id = cb.user_id) OR (b.blocker_id = cb.user_id AND b.blocked_id = :'viewer')
  WHERE cb.story_id = s.id)`;

/**
 * The whole rule in SQL, for a list of Stories `s` that aren't all one person's (an "Add
 * Yours" chain, a collaborator's ring): the owner's account gates, the audience, and the
 * collaborator's blocks. Expiry and deletion are the caller's.
 */
export const VISIBLE_STORY_SQL = `(s.owner_id = :'viewer' OR (
  EXISTS (SELECT 1 FROM users ou WHERE ou.id = s.owner_id AND ou.is_active AND ou.deleted_at IS NULL
          AND (NOT ou.is_private OR EXISTS (SELECT 1 FROM follows fo WHERE fo.follower_id = :'viewer' AND fo.followee_id = ou.id) OR ${INVITED_SQL}))
  AND NOT EXISTS (SELECT 1 FROM blocks bo WHERE (bo.blocker_id = :'viewer' AND bo.blocked_id = s.owner_id) OR (bo.blocker_id = s.owner_id AND bo.blocked_id = :'viewer'))
  AND ${COLLAB_BLOCKS_SQL}
  AND ${AUDIENCE_SQL}))`;
