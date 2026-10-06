/**
 * Moderator tools around a report: its full context and history, notes, the DM messages a
 * reporter chose to attach, and appeal decisions. Authorization is re-checked here for
 * every permission involved; routes only establish the Admin session.
 */
import { DatabaseError } from "../../db/psql";
import { HttpError } from "../../http/errors";
import { one, rows } from "./admin.service";
import { authorize, confirmation, integer, text, uuid, type Permission, type Principal } from "./policy";

/** The account behind a reported item (owner of a Story/comment, the user, or the advertiser). */
const CREATOR_OF = `CASE r.target_type
  WHEN 'user' THEN r.target_id
  WHEN 'story' THEN (SELECT owner_id FROM stories WHERE id = r.target_id)
  WHEN 'comment' THEN (SELECT user_id FROM story_comments WHERE id = r.target_id)
  WHEN 'ad' THEN (SELECT a.user_id FROM ad_creatives c JOIN ad_campaigns k ON k.id = c.campaign_id JOIN advertisers a ON a.id = k.advertiser_id WHERE c.id = r.target_id)
END`;

/** Report, target preview, creator, other reports, previous actions, notes and appeals. */
export async function reportDetail(p: Principal, reportId: string): Promise<Record<string, unknown>> {
  authorize(p, "reports.read");
  const id = uuid(reportId);
  const report = await one(`SELECT to_jsonb(r) AS data FROM reports r WHERE id = :'id'`, { id });
  if (!report) throw new HttpError(404, "Report not found.");
  const type = String(report.target_type), target = String(report.target_id);
  const preview = await one(`SELECT data FROM (
    SELECT 'story' AS type, s.id, jsonb_build_object('id', s.id, 'username', u.username, 'caption', s.caption, 'mediaId', s.media_id, 'deleted', s.deleted_at IS NOT NULL) AS data FROM stories s JOIN users u ON u.id = s.owner_id
    UNION ALL SELECT 'comment', c.id, jsonb_build_object('id', c.id, 'username', u.username, 'body', c.body, 'deleted', c.deleted_at IS NOT NULL) FROM story_comments c JOIN users u ON u.id = c.user_id
    UNION ALL SELECT 'user', u.id, jsonb_build_object('id', u.id, 'username', u.username, 'bio', u.bio, 'state', u.moderation_state) FROM users u
    UNION ALL SELECT 'ad', c.id, jsonb_build_object('id', c.id, 'caption', c.caption, 'mediaId', c.media_id, 'destination', c.destination, 'state', c.review_status) FROM ad_creatives c
  ) targets WHERE type = :'type' AND id = :'target'`, { type, target });
  const creator = await one(`SELECT jsonb_build_object(
      'id', u.id, 'username', u.username, 'displayName', u.display_name, 'joinedAt', u.created_at,
      'state', u.moderation_state, 'active', u.is_active, 'deleted', u.deleted_at IS NOT NULL,
      'followers', (SELECT count(*) FROM follows f WHERE f.followee_id = u.id),
      'priorActions', (SELECT count(*) FROM moderation_actions a WHERE a.action IN ('remove', 'restrict', 'suspend')
                        AND (a.target_id = u.id OR a.target_id IN (SELECT id FROM stories WHERE owner_id = u.id) OR a.target_id IN (SELECT id FROM story_comments WHERE user_id = u.id))),
      'openReports', (SELECT count(*) FROM reports o WHERE o.status IN ('OPEN', 'UNDER_REVIEW') AND o.target_type = 'user' AND o.target_id = u.id)
    ) AS data
    FROM reports r JOIN users u ON u.id = ${CREATOR_OF} WHERE r.id = :'id'`, { id });
  const history = {
    reports: await rows(`SELECT jsonb_build_object('id', id, 'reason', reason, 'status', status, 'priority', priority, 'source', source, 'createdAt', created_at) AS data
      FROM reports WHERE target_type = :'type' AND target_id = :'target' AND id <> :'id' ORDER BY created_at DESC LIMIT 20`, { type, target, id }),
    // Actions on this item and on its creator's account and content.
    actions: await rows(`SELECT jsonb_build_object('id', a.id, 'action', a.action, 'targetType', a.target_type, 'targetId', a.target_id,
        'reason', a.reason, 'createdAt', a.created_at, 'by', (SELECT username FROM users WHERE id = a.actor_id)) AS data
      FROM moderation_actions a, (SELECT ${CREATOR_OF} AS creator FROM reports r WHERE r.id = :'id') c
      WHERE (a.target_type = :'type' AND a.target_id = :'target') OR a.target_id = c.creator
         OR a.target_id IN (SELECT id FROM stories WHERE owner_id = c.creator) OR a.target_id IN (SELECT id FROM story_comments WHERE user_id = c.creator)
      ORDER BY a.created_at DESC LIMIT 20`, { type, target, id }),
    notes: await rows(`SELECT jsonb_build_object('id', n.id, 'body', n.body, 'reportId', n.report_id, 'by', u.username, 'createdAt', n.created_at) AS data
      FROM moderation_notes n JOIN users u ON u.id = n.author_id
      WHERE n.target_type = :'type' AND n.target_id = :'target' ORDER BY n.created_at DESC LIMIT 50`, { type, target }),
    appeals: await rows(`SELECT jsonb_build_object('id', p.id, 'status', p.status, 'reason', p.reason, 'resolution', p.resolution, 'createdAt', p.created_at) AS data
      FROM moderation_appeals p JOIN moderation_actions a ON a.id = p.action_id WHERE a.report_id = :'id' ORDER BY p.created_at DESC`, { id }),
  };
  const counts = await one(`SELECT jsonb_build_object('count', count(*)) AS data FROM reports WHERE target_type = :'type' AND target_id = :'target'`, { type, target });
  // DM evidence is never part of the report view: it is opened separately (permission + audit).
  const evidence = await one(`SELECT jsonb_build_object('messages', count(*)) AS data FROM report_message_evidence WHERE report_id = :'id'`, { id });
  return { report, target: preview, creator, history, counts, evidence };
}

/** Append-only moderator note on a report's target (shown with every report on it). */
export async function addNote(p: Principal, reportId: string, input: Record<string, unknown>): Promise<Record<string, unknown>> {
  authorize(p, "reports.review");
  const note = await one(`WITH r AS (SELECT id, target_type, target_id FROM reports WHERE id = :'id'),
      n AS (INSERT INTO moderation_notes (report_id, target_type, target_id, author_id, body)
            SELECT id, target_type, target_id, :'actor', :'body' FROM r RETURNING *),
      audit AS (INSERT INTO admin_audit (actor_id, action, target_id, metadata)
                SELECT :'actor', 'MODERATION_NOTE_ADDED', n.report_id, jsonb_build_object('noteId', n.id, 'length', char_length(n.body)) FROM n)
    SELECT jsonb_build_object('id', id, 'body', body, 'createdAt', created_at) AS data FROM n`,
    { id: uuid(reportId), actor: p.userId, body: text(input.body, 1000) });
  if (!note) throw new HttpError(404, "Report not found.");
  return note;
}

/**
 * The messages a reporter attached to a DM report — and nothing else from the conversation.
 * Needs `reports.messages.read`; every view is written to the audit log.
 */
export async function reportMessages(p: Principal, reportId: string): Promise<Record<string, unknown>[]> {
  authorize(p, "reports.messages.read");
  const id = uuid(reportId);
  const items = await rows(`WITH r AS (SELECT id, target_id FROM reports WHERE id = :'id' AND source = 'direct_message'),
      audit AS (INSERT INTO admin_audit (actor_id, action, target_id, metadata)
                SELECT :'actor', 'DM_EVIDENCE_VIEWED', r.id, jsonb_build_object('messages', (SELECT count(*) FROM report_message_evidence WHERE report_id = r.id)) FROM r)
    SELECT jsonb_build_object('messageId', e.message_id, 'sender', u.username, 'fromReportedUser', e.sender_id = r.target_id,
             'body', e.body, 'sharedStoryId', e.shared_story_id, 'sentAt', e.sent_at, 'purged', e.purged_at IS NOT NULL) AS data
    FROM report_message_evidence e JOIN r ON r.id = e.report_id LEFT JOIN users u ON u.id = e.sender_id
    ORDER BY e.sent_at ASC`, { id, actor: p.userId });
  return items;
}

export async function listAppeals(p: Principal, status: string, limit: number, offset: number): Promise<Record<string, unknown>[]> {
  authorize(p, "reports.review");
  const filter = ["OPEN", "UPHELD", "DENIED"].includes(status.toUpperCase()) ? status.toUpperCase() : "";
  return rows(`SELECT jsonb_build_object('id', p.id, 'status', p.status, 'version', p.version, 'reason', p.reason, 'resolution', p.resolution,
        'createdAt', p.created_at, 'reviewedAt', p.reviewed_at, 'username', u.username,
        'action', jsonb_build_object('id', a.id, 'action', a.action, 'targetType', a.target_type, 'targetId', a.target_id, 'reason', a.reason, 'createdAt', a.created_at),
        'reportId', a.report_id, 'reportStatus', r.status) AS data
      FROM moderation_appeals p JOIN moderation_actions a ON a.id = p.action_id JOIN users u ON u.id = p.user_id LEFT JOIN reports r ON r.id = a.report_id
      WHERE (:'status' = '' OR p.status = :'status') ORDER BY p.created_at ASC LIMIT :'limit' OFFSET :'offset'`,
    { status: filter, limit, offset });
}

/** Permission needed to undo each kind of action when an appeal succeeds. */
function reversalPermission(action: string, targetType: string): Permission | null {
  if (action === "remove") return targetType === "ad" ? "ads.review" : "content.restore";
  if (action === "restrict") return "users.restrict";
  if (action === "suspend") return "users.suspend";
  return null;
}

/**
 * DENIED keeps the action; UPHELD reverses it (restores the content, ad or account) in the
 * same transaction. Either way the report is CLOSED.
 */
export async function reviewAppeal(p: Principal, appealId: string, input: Record<string, unknown>): Promise<Record<string, unknown>> {
  authorize(p, "reports.review");
  confirmation(input.confirmed);
  const decision = text(input.decision, 20);
  if (decision !== "UPHELD" && decision !== "DENIED") throw new HttpError(422, "Invalid decision.");
  const id = uuid(appealId);
  if (decision === "UPHELD") {
    const action = await one(`SELECT jsonb_build_object('action', a.action, 'targetType', a.target_type) AS data
      FROM moderation_appeals p JOIN moderation_actions a ON a.id = p.action_id WHERE p.id = :'id'`, { id });
    if (!action) throw new HttpError(404, "Appeal not found.");
    const needed = reversalPermission(String(action.action), String(action.targetType));
    if (needed) authorize(p, needed);
  }
  try {
    const result = await one(`SELECT admin_review_appeal(:'actor'::uuid, :'id'::uuid, :'version'::integer, :'decision', :'reason') AS data`, {
      actor: p.userId, id, version: integer(input.version, 1, 2147483647), decision, reason: text(input.reason, 500),
    });
    if (!result) throw new HttpError(404, "Appeal not found.");
    return result;
  } catch (error) {
    if (error instanceof DatabaseError) {
      if (error.detail.includes("CONFLICT")) throw new HttpError(409, "This appeal was already reviewed. Refresh state.");
      if (error.detail.includes("NOT_FOUND")) throw new HttpError(404, "Appeal not found.");
    }
    throw error;
  }
}
