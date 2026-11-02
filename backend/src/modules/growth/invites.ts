/**
 * Invite friends: everyone has one personal link, https://katkee.com/i/<code>, made the first time
 * they share it (Settings > Invite friends, and the empty Home, Search and Messages screens).
 *
 * Attribution is link-based and deliberately simple. When someone opens the link in the app,
 * whether before signing up (the app keeps the code until they do) or soon after (they installed
 * from the link's page, then tapped the link again), the app redeems it. A new account (created
 * in the last INVITE_WINDOW_DAYS) can be credited to one inviter, once; then each is suggested to
 * the other in "Suggested for you" and the inviter hears "@x joined from your invite".
 *
 * There is no install attribution: nothing follows the person through the app store, so someone
 * who installs from the page and never taps the link again isn't credited. Doing that reliably
 * needs a third-party attribution SDK or fingerprinting, which Katkee doesn't use.
 */
import { randomInt } from "node:crypto";
import { queryOne } from "../../db/psql";
import { HttpError } from "../../http/errors";
import { verifiedSql } from "../../shared/verified";
import { createNotification } from "../notifications/notifications.repository";

export const INVITE_ORIGIN = "https://katkee.com";
/** A new account can be credited to an invite for this long after it is created. */
export const INVITE_WINDOW_DAYS = 7;
/** No 0/o, 1/l/i: a code read aloud or retyped from a screenshot still works. Matches 0064's CHECK. */
const ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";
const CODE_LENGTH = 8;
export const INVITE_CODE_RE = /^[2-9a-hjkmnp-z]{8}$/;

export const inviteLink = (code: string): string => `${INVITE_ORIGIN}/i/${code}`;

/** A code from a request (any case), or a 404: a malformed code is just a link that doesn't work. */
export function parseInviteCode(value: unknown): string {
  const code = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!INVITE_CODE_RE.test(code)) throw new HttpError(404, "This invite link isn't valid.");
  return code;
}

function newCode(): string {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) code += ALPHABET[randomInt(ALPHABET.length)];
  return code;
}

/** The person's invite code, made on first use. A clash with someone else's code just tries again. */
export async function inviteCodeFor(userId: string): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    // The SELECT can't see the row the INSERT adds (one snapshot), hence both.
    const row = await queryOne(
      `WITH made AS (
         INSERT INTO invite_codes (user_id, code) VALUES (:'user', :'code') ON CONFLICT DO NOTHING RETURNING code)
       SELECT code FROM made UNION ALL SELECT code FROM invite_codes WHERE user_id = :'user' LIMIT 1`,
      { user: userId, code: newCode() },
    );
    if (row?.code) return row.code;
  }
  throw new Error("Could not make an invite code");
}

export interface MyInvite {
  code: string;
  url: string;
  /** People who joined from this link and still have an account. */
  joinedCount: number;
}

export async function myInvite(userId: string): Promise<MyInvite> {
  const code = await inviteCodeFor(userId);
  const row = await queryOne(
    `SELECT count(*) AS n FROM invite_redemptions r JOIN users u ON u.id = r.invitee_id AND u.deleted_at IS NULL WHERE r.inviter_id = :'user'`,
    { user: userId },
  );
  return { code, url: inviteLink(code), joinedCount: Number(row?.n ?? 0) };
}

export interface Inviter {
  id: string;
  username: string;
  displayName: string;
  avatarMediaId: string | null;
  verified: boolean;
}

const INVITER_COLUMNS = `u.id, u.username, u.display_name, u.avatar_media_id, ${verifiedSql("u")} AS verified`;
/** Only a usable account's link works: a deleted, deactivated or suspended inviter's is dead. */
const INVITER_OK = `u.deleted_at IS NULL AND u.is_active AND u.moderation_state = 'ACTIVE'`;

function mapInviter(row: Record<string, string | null>): Inviter {
  return {
    id: row.id as string,
    username: row.username as string,
    displayName: row.display_name as string,
    avatarMediaId: row.avatar_media_id ?? null,
    verified: row.verified === "t",
  };
}

/** Whose link this is, for the invite page and the app's sign-up screen; null when it doesn't work. */
export async function inviterForCode(code: string): Promise<Inviter | null> {
  const row = await queryOne(`SELECT ${INVITER_COLUMNS} FROM invite_codes c JOIN users u ON u.id = c.user_id WHERE c.code = :'code' AND ${INVITER_OK}`, { code });
  return row ? mapInviter(row) : null;
}

/**
 * - redeemed: this new account is now credited to the inviter (the inviter was notified);
 * - already_redeemed: it was credited before (to this inviter or another);
 * - not_new: the account is older than the invite window, so the link just opens the profile;
 * - own: your own link.
 */
export type RedeemStatus = "redeemed" | "already_redeemed" | "not_new" | "own";

/**
 * Credits the signed-in (new) account to the link's owner. Blocks either way make the link look
 * invalid, exactly like an unknown code, so a block is never revealed through it.
 */
export async function redeemInvite(inviteeId: string, code: string): Promise<{ status: RedeemStatus; inviter: Inviter }> {
  const row = await queryOne(
    `WITH inviter AS (
       SELECT ${INVITER_COLUMNS} FROM invite_codes c JOIN users u ON u.id = c.user_id WHERE c.code = :'code' AND ${INVITER_OK}),
     me AS (SELECT id, created_at > now() - make_interval(days => :'days'::integer) AS is_new FROM users WHERE id = :'me' AND deleted_at IS NULL),
     blocked AS (
       SELECT EXISTS (SELECT 1 FROM blocks b, inviter i
                      WHERE (b.blocker_id = i.id AND b.blocked_id = :'me') OR (b.blocker_id = :'me' AND b.blocked_id = i.id)) AS yes),
     made AS (
       INSERT INTO invite_redemptions (invitee_id, inviter_id)
       SELECT me.id, inviter.id FROM me, inviter, blocked
       WHERE me.id <> inviter.id AND me.is_new AND NOT blocked.yes
       ON CONFLICT (invitee_id) DO NOTHING
       RETURNING inviter_id)
     SELECT inviter.*, me.is_new, blocked.yes AS blocked,
            (SELECT count(*) FROM made) AS made,
            EXISTS (SELECT 1 FROM invite_redemptions WHERE invitee_id = :'me') AS had
     FROM inviter, me, blocked`,
    { code, me: inviteeId, days: INVITE_WINDOW_DAYS },
  );
  if (!row || row.blocked === "t") throw new HttpError(404, "This invite link isn't valid.");
  const inviter = mapInviter(row);
  const status: RedeemStatus = inviter.id === inviteeId ? "own"
    : Number(row.made) > 0 ? "redeemed"
    : row.had === "t" ? "already_redeemed"
    : "not_new";
  if (status === "redeemed") {
    await createNotification({ recipientId: inviter.id, actorId: inviteeId, type: "invite_joined" });
    console.info(JSON.stringify({ event: "invite_redeemed" }));
  }
  return { status, inviter };
}
