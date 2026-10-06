import { nullable, query, queryOne, type Row } from "../../db/psql";

export type TargetType = "story" | "comment" | "user";
export type ReportReason = "spam" | "harassment" | "nudity" | "violence" | "hate_speech" | "self_harm" | "impersonation" | "scam" | "other";
/** The report lifecycle (migration 0032). */
export type ReportStatus = "OPEN" | "UNDER_REVIEW" | "ACTIONED" | "DISMISSED" | "APPEALED" | "CLOSED";
export const REPORT_STATUSES: ReportStatus[] = ["OPEN", "UNDER_REVIEW", "ACTIONED", "DISMISSED", "APPEALED", "CLOSED"];
const LEGACY_STATUS: Record<string, ReportStatus> = {
  pending: "OPEN", under_review: "UNDER_REVIEW", actioned: "ACTIONED", dismissed: "DISMISSED", appealed: "APPEALED", closed: "CLOSED",
};

/** A status filter from a query string: the spec's names, or the lowercase names used before Phase 4. */
export function parseReportStatus(value: string | undefined, fallback: ReportStatus = "OPEN"): ReportStatus | null {
  if (value === undefined || value === "") return fallback;
  const upper = value.toUpperCase() as ReportStatus;
  return REPORT_STATUSES.includes(upper) ? upper : LEGACY_STATUS[value] ?? null;
}

export interface ReportRow {
  id: string;
  reporterId: string;
  targetType: TargetType;
  targetId: string;
  reason: ReportReason;
  details: string | null;
  status: ReportStatus;
  resolutionNote: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdAt: string;
}

const SELECT_COLUMNS =
  "id, reporter_id, target_type, target_id, reason, details, status, resolution_note, reviewed_by, reviewed_at, created_at";

function mapRow(row: Row): ReportRow {
  return {
    id: row.id as string,
    reporterId: row.reporter_id as string,
    targetType: row.target_type as TargetType,
    targetId: row.target_id as string,
    reason: row.reason as ReportReason,
    details: (row.details as string | null) ?? null,
    status: row.status as ReportStatus,
    resolutionNote: (row.resolution_note as string | null) ?? null,
    reviewedBy: (row.reviewed_by as string | null) ?? null,
    reviewedAt: (row.reviewed_at as string | null) ?? null,
    createdAt: row.created_at as string,
  };
}

/**
 * Files a report, or returns the reporter's report on the same target that is still open
 * (one open report per reporter and target, so repeats don't flood the queue).
 */
export async function createReport(input: {
  reporterId: string;
  targetType: TargetType;
  targetId: string;
  reason: ReportReason;
  details: string | null;
}): Promise<{ report: ReportRow; created: boolean }> {
  const params = {
    reporter_id: input.reporterId,
    target_type: input.targetType,
    target_id: input.targetId,
    reason: input.reason,
    details: input.details ?? "",
  };
  const row = await queryOne(
    `INSERT INTO reports (reporter_id, target_type, target_id, reason, details)
     VALUES (:'reporter_id', :'target_type', :'target_id', :'reason', ${nullable("details")})
     ON CONFLICT DO NOTHING
     RETURNING ${SELECT_COLUMNS}`,
    params,
  );
  if (row) return { report: mapRow(row), created: true };
  const existing = await queryOne(
    `SELECT ${SELECT_COLUMNS} FROM reports
     WHERE reporter_id = :'reporter_id' AND target_type = :'target_type' AND target_id = :'target_id' AND status IN ('OPEN', 'UNDER_REVIEW')`,
    params,
  );
  if (!existing) throw new Error("Report insert returned no row");
  return { report: mapRow(existing), created: false };
}

export async function findReportById(id: string): Promise<ReportRow | null> {
  const row = await queryOne(`SELECT ${SELECT_COLUMNS} FROM reports WHERE id = :'id'`, { id });
  return row ? mapRow(row) : null;
}

/** Most urgent first, then oldest first within a priority — a fair queue. */
export async function listReports(status: ReportStatus, limit: number, offset: number): Promise<ReportRow[]> {
  const rows = await query(
    `SELECT ${SELECT_COLUMNS} FROM reports
     WHERE status = :'status'
     ORDER BY priority DESC, created_at ASC
     LIMIT :'limit' OFFSET :'offset'`,
    { status, limit, offset },
  );
  return rows.map(mapRow);
}

export async function resolveReport(
  id: string,
  moderatorId: string,
  status: "DISMISSED" | "ACTIONED",
  note: string | null,
): Promise<void> {
  await query(
    `UPDATE reports
     SET status = :'status', resolution_note = ${nullable("note")}, reviewed_by = :'reviewed_by', reviewed_at = now()
     WHERE id = :'id'`,
    { id, status, note: note ?? "", reviewed_by: moderatorId },
  );
}
