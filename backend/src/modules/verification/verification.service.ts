/**
 * The verified badge: free, and every badge approved by hand by an admin. It says the account
 * really belongs to the person, brand or organisation it claims to be, and that they are
 * notable. It gives no ranking boost anywhere.
 *
 * - Applying needs a verified email, an account 30 days old, a profile photo, a bio, no
 *   restriction or suspension and no upheld report in the last 90 days; one open request at a
 *   time, and 30 days after a denial before the next.
 * - The request carries a photo of a government ID, uploaded with the normal photo upload and
 *   then marked as a verification document: the media routes never serve it again (not even to
 *   its owner); admins with verification.review see it, each view audit-logged. It is deleted
 *   30 days after the decision or withdrawal (retention.ts), and at once if the account is
 *   deleted.
 * - Renaming while verified puts the badge on hold, and a restriction, suspension or deletion
 *   removes it (the users trigger in migration 0057). Held accounts wait in the admin queue
 *   for Restore or Remove.
 */
import { HttpError } from "../../http/errors";
import { query, queryOne, DatabaseError, type Row } from "../../db/psql";
import { ValidationError } from "../auth/dto";
import { verifiedSql } from "../../shared/verified";
import { mapMediaRow, MEDIA_COLUMNS, type MediaRecord } from "../media/media.repository";
import type { ObjectStore } from "../media/storage";
import { deleteVerificationPhoto } from "../media/retention";

export const CATEGORIES = ["creator", "public_figure", "brand", "news_media", "organization"] as const;
export type Category = (typeof CATEGORIES)[number];

const MIN_ACCOUNT_DAYS = 30;
const REAPPLY_DAYS = 30;
const REPORT_WINDOW_DAYS = 90;
const DAY_MS = 86_400_000;

export interface PublicRequest {
  id: string;
  status: "pending" | "approved" | "denied" | "withdrawn";
  category: Category;
  fullName: string;
  links: string[];
  createdAt: string;
  decidedAt: string | null;
  denialReason: string | null;
  /** A denial: when a new request can be sent. */
  canReapplyAt: string | null;
}

export interface VerificationStatus {
  verified: boolean;
  onHold: boolean;
  category: Category | null;
  eligibility: { eligible: boolean; reasons: string[] };
  request: PublicRequest | null;
}

// Times as ISO 8601 (to_json), which is what the contract with the app promises.
const REQUEST_COLUMNS = `id, status, category, full_name, links, to_json(created_at) #>> '{}' AS created_at,
  to_json(decided_at) #>> '{}' AS decided_at, denial_reason,
  CASE WHEN status = 'denied' THEN to_json(decided_at + make_interval(days => ${REAPPLY_DAYS})) #>> '{}' END AS can_reapply_at`;

function toRequest(row: Row): PublicRequest {
  return {
    id: row.id as string,
    status: row.status as PublicRequest["status"],
    category: row.category as Category,
    fullName: row.full_name as string,
    links: JSON.parse(row.links ?? "[]") as string[],
    createdAt: row.created_at as string,
    decidedAt: row.decided_at ?? null,
    denialReason: row.denial_reason ?? null,
    canReapplyAt: row.can_reapply_at ?? null,
  };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "12 Nov 2026", in India time like the rest of the app's dates. */
function dayText(ms: number): string {
  const d = new Date(ms + 5.5 * 3600_000);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** Everything that decides the badge and the eligibility rules, in one read. */
async function accountState(userId: string): Promise<Row> {
  const row = await queryOne(
    `SELECT to_json(u.created_at) #>> '{}' AS created_at, u.email_verified_at IS NOT NULL AS email_verified, u.avatar_media_id IS NOT NULL AS has_avatar,
            btrim(u.bio) <> '' AS has_bio, (u.moderation_state = 'ACTIVE' AND u.is_active) AS in_good_standing,
            ${verifiedSql("u")} AS verified, u.verified_at IS NOT NULL AND u.verification_hold_at IS NOT NULL AS on_hold,
            CASE WHEN u.verified_at IS NOT NULL THEN u.verified_category END AS category,
            EXISTS (SELECT 1 FROM reports r
                    WHERE r.status = 'ACTIONED' AND coalesce(r.reviewed_at, r.updated_at) > now() - make_interval(days => :'window'::integer)
                      AND ((r.target_type = 'user' AND r.target_id = u.id)
                        OR (r.target_type = 'story' AND r.target_id IN (SELECT s.id FROM stories s WHERE s.owner_id = u.id))
                        OR (r.target_type = 'comment' AND r.target_id IN (SELECT c.id FROM story_comments c WHERE c.user_id = u.id)))) AS upheld_report
     FROM users u WHERE u.id = :'id' AND u.deleted_at IS NULL`,
    { id: userId, window: REPORT_WINDOW_DAYS },
  );
  if (!row) throw new HttpError(404, "User not found.");
  return row;
}

async function latestRequest(userId: string): Promise<PublicRequest | null> {
  const row = await queryOne(`SELECT ${REQUEST_COLUMNS} FROM verification_requests WHERE user_id = :'id' ORDER BY created_at DESC LIMIT 1`, { id: userId });
  return row ? toRequest(row) : null;
}

/** Why the account can't apply now, as sentences the app shows as they are. */
function reasonsFor(state: Row, request: PublicRequest | null, now = Date.now()): string[] {
  const reasons: string[] = [];
  if (state.verified === "t") reasons.push("Your account is already verified.");
  if (request?.status === "pending") reasons.push("Your request is being reviewed.");
  if (request?.canReapplyAt && new Date(request.canReapplyAt).getTime() > now) {
    reasons.push(`You can apply again on ${dayText(new Date(request.canReapplyAt).getTime())}.`);
  }
  if (state.email_verified !== "t") reasons.push("Verify your email address.");
  const oldEnough = new Date(state.created_at as string).getTime() + MIN_ACCOUNT_DAYS * DAY_MS;
  if (oldEnough > now) reasons.push(`Your account needs to be ${MIN_ACCOUNT_DAYS} days old (on ${dayText(oldEnough)}).`);
  if (state.has_avatar !== "t") reasons.push("Add a profile photo.");
  if (state.has_bio !== "t") reasons.push("Add a bio.");
  if (state.in_good_standing !== "t") reasons.push("Your account is restricted.");
  if (state.upheld_report === "t") reasons.push("Your account has a recent upheld report.");
  return reasons;
}

export async function getStatus(userId: string): Promise<VerificationStatus> {
  const [state, request] = await Promise.all([accountState(userId), latestRequest(userId)]);
  const reasons = reasonsFor(state, request);
  return {
    verified: state.verified === "t",
    onHold: state.on_hold === "t",
    category: (state.category as Category | null) ?? null,
    eligibility: { eligible: reasons.length === 0, reasons },
    request,
  };
}

export interface ApplyInput {
  category: Category;
  fullName: string;
  links: string[];
  idMediaId: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function httpsLink(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text || text.length > 300) return null;
  try {
    const url = new URL(text);
    return url.protocol === "https:" && url.hostname.includes(".") && !url.username && !url.password ? text : null;
  } catch {
    return null;
  }
}

export function parseApply(body: unknown): ApplyInput {
  const b = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  const errors: Record<string, string> = {};
  if (!(CATEGORIES as readonly unknown[]).includes(b.category)) errors.category = "Choose a category.";
  const fullName = typeof b.fullName === "string" ? b.fullName.trim().replace(/\s+/g, " ") : "";
  if (!fullName || fullName.length > 80) errors.fullName = "Enter your full name as it appears on your ID (up to 80 characters).";
  const raw = Array.isArray(b.links) ? b.links : [];
  const links = raw.map(httpsLink);
  if (!raw.length || raw.length > 5) errors.links = "Add 1 to 5 links that show who you are.";
  else if (links.some((l) => l === null)) errors.links = "Each link must be a full https:// address of up to 300 characters.";
  if (typeof b.idMediaId !== "string" || !UUID_RE.test(b.idMediaId)) errors.idMediaId = "Add a photo of your ID.";
  if (Object.keys(errors).length) throw new ValidationError(errors);
  return { category: b.category as Category, fullName, links: [...new Set(links as string[])], idMediaId: (b.idMediaId as string).toLowerCase() };
}

export type ApplyResult = { request: PublicRequest } | { notEligible: string[] };

export async function apply(userId: string, input: ApplyInput): Promise<ApplyResult> {
  const [state, request] = await Promise.all([accountState(userId), latestRequest(userId)]);
  if (state.verified === "t") throw new HttpError(409, "Your account is already verified.");
  if (request?.status === "pending") throw new HttpError(409, "You already have a request in review.");
  const reasons = reasonsFor(state, request);
  if (reasons.length) return { notEligible: reasons };
  let row: Row | null;
  try {
    // One statement: the photo becomes a verification document only if it is the caller's own,
    // received photo that nothing else uses (media_in_use), and only together with the request.
    row = await queryOne(
      `WITH m AS (
         UPDATE media SET verification_document = true
         WHERE id = :'media' AND owner_id = :'user' AND kind = 'photo' AND status IN ('ready', 'processing')
           AND purged_at IS NULL AND NOT verification_document AND NOT media_in_use(id)
         RETURNING id),
       r AS (
         INSERT INTO verification_requests (user_id, category, full_name, links, id_media_id)
         SELECT :'user', :'category', :'name', :'links'::jsonb, id FROM m
         RETURNING ${REQUEST_COLUMNS})
       SELECT * FROM r`,
      { user: userId, media: input.idMediaId, category: input.category, name: input.fullName, links: JSON.stringify(input.links) },
    );
  } catch (error) {
    if (error instanceof DatabaseError && error.detail.includes("verification_requests_one_pending")) {
      throw new HttpError(409, "You already have a request in review.");
    }
    throw error;
  }
  if (!row) throw new HttpError(422, "That photo can't be used.", { idMediaId: "Upload a new photo of your ID." });
  return { request: toRequest(row) };
}

/** The ID photo stays until the retention job deletes it, 30 days after the withdrawal. */
export async function withdraw(userId: string): Promise<void> {
  const row = await queryOne(
    `UPDATE verification_requests SET status = 'withdrawn', decided_at = now() WHERE user_id = :'user' AND status = 'pending' RETURNING id`,
    { user: userId },
  );
  if (!row) throw new HttpError(404, "There's no request in review.");
}

/** Account deletion: requests and ID photos go now, not after the 30-day account scrub. */
export async function deleteForAccount(store: ObjectStore, userId: string): Promise<void> {
  const photos = await query(
    `SELECT ${MEDIA_COLUMNS.split(", ").map((c) => `m.${c}`).join(", ")}
     FROM verification_requests r JOIN media m ON m.id = r.id_media_id WHERE r.user_id = :'user'`,
    { user: userId },
  );
  for (const row of photos) await deleteVerificationPhoto(store, mapMediaRow(row));
  await query(`DELETE FROM verification_requests WHERE user_id = :'user'`, { user: userId });
}

// --- Admin -----------------------------------------------------------------------------------

export type Outcome = "approved" | "denied" | "removed" | "restored";

const PUSH_TEXT: Record<Outcome, string> = {
  approved: "You're verified. Your badge now shows on your profile.",
  denied: "Your verification request wasn't approved.",
  removed: "Your verified badge was removed.",
  restored: "Your verified badge is back on your profile.",
};

/**
 * CTEs that tell `target`'s user what happened, in the same statement as the change: the
 * Activity row (no actor), its push and the realtime event. Uses :'outcome' and :'reason'.
 */
const NOTIFY = `
  n AS (INSERT INTO notifications (recipient_id, actor_id, type, verification_status, verification_reason)
        SELECT user_id, NULL, 'verification', :'outcome', NULLIF(:'reason', '') FROM target RETURNING id, recipient_id),
  p AS (INSERT INTO push_outbox (user_id, kind, body, link)
        SELECT recipient_id, 'verification', :'push', 'katkee://verification' FROM n RETURNING id),
  rt AS (SELECT pg_notify('realtime', json_build_object('u', json_build_array(n.recipient_id),
           'e', json_build_object('type', 'notification', 'id', n.id, 'kind', 'verification'))::text) AS x FROM n)`;

function outcomeParams(outcome: Outcome, reason = ""): Record<string, string> {
  return { outcome, reason, push: PUSH_TEXT[outcome] };
}

/** "users": the requester's card, for the queue and the detail. */
function userCard(alias: string): string {
  return `jsonb_build_object('id', ${alias}.id, 'username', ${alias}.username, 'displayName', ${alias}.display_name,
            'hasAvatar', ${alias}.avatar_media_id IS NOT NULL, 'joinedAt', ${alias}.created_at,
            'emailVerified', ${alias}.email_verified_at IS NOT NULL, 'state', ${alias}.moderation_state, 'active', ${alias}.is_active,
            'followers', (SELECT count(*) FROM follows f WHERE f.followee_id = ${alias}.id),
            'verified', ${verifiedSql(alias)}, 'verifiedCategory', ${alias}.verified_category,
            'holdAt', ${alias}.verification_hold_at, 'previous', ${alias}.verification_hold_previous)`;
}

/** Pending requests (oldest first), accounts on hold after a rename, and verified accounts. */
export async function queue(search: string): Promise<{ pending: unknown[]; held: unknown[]; verified: unknown[] }> {
  const [pending, held, verified] = await Promise.all([
    query(
      `SELECT jsonb_build_object('id', r.id, 'category', r.category, 'fullName', r.full_name, 'createdAt', r.created_at, 'user', ${userCard("u")}) AS data
       FROM verification_requests r JOIN users u ON u.id = r.user_id
       WHERE r.status = 'pending' AND u.deleted_at IS NULL ORDER BY r.created_at LIMIT 200`,
    ),
    query(
      `SELECT ${userCard("u")} AS data FROM users u
       WHERE u.verified_at IS NOT NULL AND u.verification_hold_at IS NOT NULL AND u.deleted_at IS NULL
       ORDER BY u.verification_hold_at LIMIT 200`,
    ),
    query(
      `SELECT ${userCard("u")} AS data FROM users u
       WHERE u.verified_at IS NOT NULL AND u.verification_hold_at IS NULL AND u.deleted_at IS NULL
         AND (:'search' = '' OR u.username::text ILIKE :'search' || '%')
       ORDER BY u.verified_at DESC LIMIT 50`,
      { search: search.replace(/[\\%_]/g, (c) => `\\${c}`) },
    ),
  ]);
  const parse = (rows: Row[]) => rows.map((r) => JSON.parse(r.data as string) as unknown);
  return { pending: parse(pending), held: parse(held), verified: parse(verified) };
}

export async function requestDetail(id: string): Promise<Record<string, unknown>> {
  const row = await queryOne(
    `SELECT jsonb_build_object('id', r.id, 'status', r.status, 'category', r.category, 'fullName', r.full_name, 'links', r.links,
              'createdAt', r.created_at, 'decidedAt', r.decided_at, 'denialReason', r.denial_reason,
              'hasIdPhoto', r.id_media_id IS NOT NULL, 'idDeletedAt', r.id_deleted_at,
              'user', ${userCard("u")} || jsonb_build_object(
                'reports90d', (SELECT count(*) FROM reports x WHERE x.target_type = 'user' AND x.target_id = u.id AND x.created_at > now() - interval '90 days'),
                'upheldReports90d', (SELECT count(*) FROM reports x WHERE x.status = 'ACTIONED' AND coalesce(x.reviewed_at, x.updated_at) > now() - interval '90 days'
                                        AND ((x.target_type = 'user' AND x.target_id = u.id)
                                          OR (x.target_type = 'story' AND x.target_id IN (SELECT s.id FROM stories s WHERE s.owner_id = u.id))
                                          OR (x.target_type = 'comment' AND x.target_id IN (SELECT c.id FROM story_comments c WHERE c.user_id = u.id)))),
                'previousRequests', (SELECT count(*) FROM verification_requests y WHERE y.user_id = u.id AND y.id <> r.id))) AS data
     FROM verification_requests r JOIN users u ON u.id = r.user_id WHERE r.id = :'id' AND u.deleted_at IS NULL`,
    { id },
  );
  if (!row) throw new HttpError(404, "Request not found.");
  return JSON.parse(row.data as string) as Record<string, unknown>;
}

/** The ID photo, for an admin: every view is written to the audit log before it is sent. */
export async function idPhotoForAdmin(adminId: string, requestId: string): Promise<MediaRecord> {
  const row = await queryOne(
    `WITH r AS (SELECT r.id, r.user_id, r.id_media_id FROM verification_requests r WHERE r.id = :'id' AND r.id_media_id IS NOT NULL),
          a AS (INSERT INTO admin_audit (actor_id, action, target_id, metadata)
                SELECT :'admin', 'VERIFICATION_ID_VIEWED', user_id, jsonb_build_object('requestId', id) FROM r)
     SELECT ${MEDIA_COLUMNS.split(", ").map((c) => `m.${c}`).join(", ")} FROM r JOIN media m ON m.id = r.id_media_id`,
    { id: requestId, admin: adminId },
  );
  const media = row ? mapMediaRow(row) : null;
  if (!media || media.purgedAt) throw new HttpError(404, "ID photo unavailable.");
  return media;
}

export async function avatarForAdmin(userId: string): Promise<MediaRecord> {
  const row = await queryOne(
    `SELECT ${MEDIA_COLUMNS.split(", ").map((c) => `m.${c}`).join(", ")} FROM users u JOIN media m ON m.id = u.avatar_media_id WHERE u.id = :'id'`,
    { id: userId },
  );
  const media = row ? mapMediaRow(row) : null;
  if (!media || media.purgedAt) throw new HttpError(404, "No profile photo.");
  return media;
}

async function pendingRequest(id: string): Promise<Row> {
  const row = await queryOne(
    `SELECT r.user_id, (u.moderation_state = 'ACTIVE' AND u.is_active AND u.deleted_at IS NULL) AS ok
     FROM verification_requests r JOIN users u ON u.id = r.user_id WHERE r.id = :'id' AND r.status = 'pending'`,
    { id },
  );
  if (!row) throw new HttpError(409, "This request has already been decided or withdrawn.");
  return row;
}

export async function approve(adminId: string, id: string): Promise<void> {
  const current = await pendingRequest(id);
  if (current.ok !== "t") throw new HttpError(409, "This account is restricted, suspended or deleted. Deny the request instead.");
  const row = await queryOne(
    `WITH target AS (
       UPDATE verification_requests SET status = 'approved', decided_at = now(), decided_by = :'admin'
       WHERE id = :'id' AND status = 'pending' RETURNING id, user_id, category),
     u AS (UPDATE users SET verified_at = now(), verified_category = t.category, verification_hold_at = NULL, verification_hold_previous = NULL
           FROM target t WHERE users.id = t.user_id RETURNING users.id),
     a AS (INSERT INTO admin_audit (actor_id, action, target_id, metadata)
           SELECT :'admin', 'VERIFICATION_APPROVED', user_id, jsonb_build_object('requestId', id, 'category', category) FROM target),
     ${NOTIFY}
     SELECT (SELECT count(*) FROM u) AS n, (SELECT count(*) FROM rt) AS sent`,
    { id, admin: adminId, ...outcomeParams("approved") },
  );
  if (!row || row.n === "0") throw new HttpError(409, "This request has already been decided or withdrawn.");
}

export async function deny(adminId: string, id: string, reason: string): Promise<void> {
  await pendingRequest(id);
  const row = await queryOne(
    `WITH target AS (
       UPDATE verification_requests SET status = 'denied', decided_at = now(), decided_by = :'admin', denial_reason = :'reason'
       WHERE id = :'id' AND status = 'pending' RETURNING id, user_id),
     a AS (INSERT INTO admin_audit (actor_id, action, target_id, metadata)
           SELECT :'admin', 'VERIFICATION_DENIED', user_id, jsonb_build_object('requestId', id, 'reason', :'reason') FROM target),
     ${NOTIFY}
     SELECT (SELECT count(*) FROM target) AS n, (SELECT count(*) FROM rt) AS sent`,
    { id, admin: adminId, ...outcomeParams("denied", reason) },
  );
  if (!row || row.n === "0") throw new HttpError(409, "This request has already been decided or withdrawn.");
}

/** Takes the badge away (verified or on hold), with the reason the person is shown. */
export async function removeBadge(adminId: string, userId: string, reason: string): Promise<void> {
  const row = await queryOne(
    `WITH target AS (
       UPDATE users SET verified_at = NULL, verified_category = NULL, verification_hold_at = NULL, verification_hold_previous = NULL
       WHERE id = :'user' AND verified_at IS NOT NULL AND deleted_at IS NULL RETURNING id AS user_id),
     a AS (INSERT INTO admin_audit (actor_id, action, target_id, metadata)
           SELECT :'admin', 'VERIFICATION_REMOVED', user_id, jsonb_build_object('reason', :'reason') FROM target),
     ${NOTIFY}
     SELECT (SELECT count(*) FROM target) AS n, (SELECT count(*) FROM rt) AS sent`,
    { user: userId, admin: adminId, ...outcomeParams("removed", reason) },
  );
  if (!row || row.n === "0") throw new HttpError(404, "This account isn't verified.");
}

/** The new name is fine: the held badge shows again. */
export async function restoreBadge(adminId: string, userId: string): Promise<void> {
  const row = await queryOne(
    `WITH before AS (SELECT verification_hold_previous AS previous FROM users WHERE id = :'user'),
     target AS (
       UPDATE users SET verification_hold_at = NULL, verification_hold_previous = NULL
       WHERE id = :'user' AND verified_at IS NOT NULL AND verification_hold_at IS NOT NULL AND deleted_at IS NULL
         AND is_active AND moderation_state = 'ACTIVE'
       RETURNING id AS user_id, username, display_name),
     a AS (INSERT INTO admin_audit (actor_id, action, target_id, metadata)
           SELECT :'admin', 'VERIFICATION_RESTORED', user_id,
                  jsonb_build_object('previous', (SELECT previous FROM before), 'username', username, 'displayName', display_name) FROM target),
     ${NOTIFY}
     SELECT (SELECT count(*) FROM target) AS n, (SELECT count(*) FROM rt) AS sent`,
    { user: userId, admin: adminId, ...outcomeParams("restored") },
  );
  if (!row || row.n === "0") throw new HttpError(404, "This account's badge isn't on hold.");
}
