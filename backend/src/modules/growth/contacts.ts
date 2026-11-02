/**
 * Find friends from your contacts (Settings > Contacts on Katkee, onboarding, Search).
 *
 * Only ever on request, after the person has read what happens and allowed contacts on the phone.
 * The phone normalises each email and phone number and sends only SHA-256 hashes of them
 * (mobile/src/utils/contactHashes.ts), in batches. Here they are compared, in memory and in one
 * query, against the verified emails and phone numbers of accounts that let people find them
 * this way, and the matches are returned. The uploaded hashes are never written anywhere: not to
 * the database, not to logs. Nothing about the person's contacts outlives the request.
 *
 * The hashes are not secret. The pepper ships in the app, and there are few enough phone numbers
 * to hash them all, so anyone who saw a hash could find the number. That is why they are never
 * kept, and why an account's own phone number is matched through a key only this server holds
 * (phoneContactKey): a copy of the database alone can't be turned back into numbers. The real
 * protections are the opt-out, the per-account limits below, and showing only accounts.
 */
import { createHash, createHmac } from "node:crypto";
import { query } from "../../db/psql";
import { HttpError } from "../../http/errors";
import { enforceSharedLimit } from "../../shared/sharedRateLimit";
import { verifiedSql } from "../../shared/verified";
import { providerConfig } from "../auth/providers";
import type { ListRelationship } from "../users/users.repository";

/** Must equal CONTACT_HASH_PEPPER in the app and contact_match_hash() in migration 0064. */
export const CONTACT_HASH_PEPPER = "katkee-contacts-v1";
/** Hashes per request; the app sends bigger address books in several. */
export const MAX_HASHES_PER_BATCH = 500;
/**
 * Requests per account: plenty for a few thousand contacts (two hashes each, on average) checked
 * a couple of times a day, but far too few to test a meaningful slice of all phone numbers.
 */
export const CONTACT_BATCHES_PER_HOUR = 30;
export const CONTACT_BATCHES_PER_DAY = 60;

const HASH_RE = /^[0-9a-f]{64}$/;

/** What the app uploads for one email or E.164 phone number (already normalised). */
export function contactHash(kind: "email" | "phone", value: string): string {
  return createHash("sha256").update(`${CONTACT_HASH_PEPPER}|${kind}|${value}`).digest("hex");
}

/**
 * The key a verified phone number is matched by: the app's hash, keyed with the phone identity
 * secret, so the stored value can't be reversed without that secret. Null when phone sign-in
 * isn't configured (there are no phone identities to match then).
 */
export function phoneKeyForHash(hash: string): string | null {
  if (!providerConfig.phoneSecret) return null;
  return createHmac("sha256", providerConfig.phoneSecret).update(`contacts|${hash}`).digest("hex");
}

/** The key for an account's own phone number, made while it signs in with that number. */
export function phoneContactKey(e164: string): string | null {
  return phoneKeyForHash(contactHash("phone", e164));
}

/** The request's hashes, de-duplicated, or a 422 for anything that isn't one batch of hashes. */
export function parseContactHashes(body: unknown): string[] {
  const list = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>).hashes : undefined;
  if (!Array.isArray(list) || list.length === 0 || list.length > MAX_HASHES_PER_BATCH) {
    throw new HttpError(422, `Send between 1 and ${MAX_HASHES_PER_BATCH} contact hashes.`);
  }
  const unique = new Set<string>();
  for (const value of list) {
    if (typeof value !== "string" || !HASH_RE.test(value.toLowerCase())) throw new HttpError(422, "Contact hashes must be SHA-256, in hex.");
    unique.add(value.toLowerCase());
  }
  return [...unique];
}

export interface ContactMatch {
  id: string;
  username: string;
  displayName: string;
  avatarMediaId: string | null;
  verified: boolean;
  isPrivate: boolean;
  viewer: ListRelationship;
}

/**
 * The accounts behind these hashes that the viewer may see: active, not suspended or deleted,
 * findable from contacts, and with no block either way. Emails match only once verified; phone
 * numbers only as a verified sign-in. People already followed are included (shown as Following),
 * after the rest.
 */
export async function matchContacts(viewerId: string, hashes: string[]): Promise<ContactMatch[]> {
  await enforceSharedLimit(`contacts:hour:${viewerId}`, CONTACT_BATCHES_PER_HOUR, 3600, "You've checked a lot of contacts.");
  await enforceSharedLimit(`contacts:day:${viewerId}`, CONTACT_BATCHES_PER_DAY, 86_400, "You've checked a lot of contacts today.");
  const phoneKeys = hashes.map(phoneKeyForHash).filter((key): key is string => key !== null);
  const rows = await query(
    `WITH wanted AS (SELECT value AS h FROM jsonb_array_elements_text(:'hashes'::jsonb)),
     keys AS (SELECT value AS k FROM jsonb_array_elements_text(:'keys'::jsonb)),
     found AS (
       SELECT u.id FROM users u
       WHERE contact_match_hash('email', lower(btrim(u.email::text))) IN (SELECT h FROM wanted)
         AND u.email IS NOT NULL AND u.email_verified_at IS NOT NULL AND u.deleted_at IS NULL
       UNION
       SELECT i.user_id FROM auth_identities i
       WHERE i.provider = 'PHONE' AND i.contact_key IN (SELECT k FROM keys)
     )
     SELECT u.id, u.username, u.display_name, u.avatar_media_id, ${verifiedSql("u")} AS verified, u.is_private,
            EXISTS (SELECT 1 FROM follows WHERE follower_id = :'viewer' AND followee_id = u.id) AS is_following,
            EXISTS (SELECT 1 FROM follows WHERE follower_id = u.id AND followee_id = :'viewer') AS is_followed_by,
            EXISTS (SELECT 1 FROM follow_requests WHERE requester_id = :'viewer' AND target_id = u.id AND status = 'pending') AS requested
     FROM found f
     JOIN users u ON u.id = f.id
     WHERE u.id <> :'viewer' AND u.deleted_at IS NULL AND u.is_active AND u.moderation_state = 'ACTIVE' AND u.findable_by_contacts
       AND NOT EXISTS (SELECT 1 FROM blocks
                       WHERE (blocker_id = :'viewer' AND blocked_id = u.id) OR (blocker_id = u.id AND blocked_id = :'viewer'))
     ORDER BY is_following, lower(u.display_name), u.username
     LIMIT :'limit'`,
    { viewer: viewerId, hashes: JSON.stringify(hashes), keys: JSON.stringify(phoneKeys), limit: MAX_HASHES_PER_BATCH },
  );
  return rows.map((row) => ({
    id: row.id as string,
    username: row.username as string,
    displayName: row.display_name as string,
    avatarMediaId: (row.avatar_media_id as string | null) ?? null,
    verified: row.verified === "t",
    isPrivate: row.is_private === "t",
    viewer: { isFollowing: row.is_following === "t", isFollowedBy: row.is_followed_by === "t", hasPendingRequestFromViewer: row.requested === "t" },
  }));
}
