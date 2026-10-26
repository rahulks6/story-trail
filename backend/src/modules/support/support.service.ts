/**
 * What goes wrong in the app, and what testers tell you about it — on Katkee's own server,
 * never a third-party crash SDK (the privacy policy promises none).
 *
 * Crash reports carry the JavaScript error, where it happened and on what phone and app
 * version; never message text or media. They group by fingerprint (error name and the first
 * app frames, with line/column numbers dropped so one crash on two builds still matches) and
 * are deleted after 90 days. Native crashes are in Play Console (Android vitals) and App Store
 * Connect. Feedback is a note with an optional screenshot the person chose to attach.
 */
import { createHash } from "node:crypto";
import { HttpError } from "../../http/errors";
import { ValidationError } from "../auth/dto";
import { query, queryOne } from "../../db/psql";
import * as mediaRepo from "../media/media.repository";

export type CrashKind = "fatal" | "render" | "handled";

export interface CrashInput {
  clientReportId: string;
  kind: CrashKind;
  name: string;
  message: string;
  stack: string;
  componentStack: string;
  screen: string;
  osVersion: string;
  appVersion: string;
  deviceModel: string;
  occurredAt: string;
}

export interface DeviceInfo {
  platform: "android" | "ios";
}

function str(b: Record<string, unknown>, key: string, max: number, errors: Record<string, string>, required = false): string {
  const v = b[key];
  if (v === undefined || v === null || v === "") {
    if (required) errors[key] = `${key} is required.`;
    return "";
  }
  if (typeof v !== "string") {
    errors[key] = `${key} must be text.`;
    return "";
  }
  // Long stacks are cut, not refused: the top is what matters.
  return v.slice(0, max);
}

export function parsePlatform(header: unknown): DeviceInfo["platform"] {
  if (header === "android" || header === "ios") return header;
  throw new HttpError(422, "Unknown platform.", { platform: "Send X-Katkee-Platform: android or ios." });
}

export function parseCrash(body: unknown): CrashInput {
  const b = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  const errors: Record<string, string> = {};
  const clientReportId = str(b, "clientReportId", 64, errors, true);
  if (clientReportId && !/^[A-Za-z0-9_-]{16,64}$/.test(clientReportId)) errors.clientReportId = "clientReportId must be 16-64 letters, digits, '-' or '_'.";
  const kind = b.kind;
  if (kind !== "fatal" && kind !== "render" && kind !== "handled") errors.kind = "kind must be fatal, render or handled.";
  const occurred = typeof b.occurredAt === "string" ? new Date(b.occurredAt) : null;
  // A phone's clock can be off; a report from far in the future or past is dated now.
  const now = Date.now();
  const occurredAt = occurred && Number.isFinite(occurred.getTime()) && Math.abs(occurred.getTime() - now) < 30 * 86_400_000 ? occurred.toISOString() : new Date(now).toISOString();
  const input = {
    clientReportId,
    kind: kind as CrashKind,
    name: str(b, "name", 120, errors) || "Error",
    message: str(b, "message", 500, errors),
    stack: str(b, "stack", 8000, errors),
    componentStack: str(b, "componentStack", 4000, errors),
    screen: str(b, "screen", 80, errors),
    osVersion: str(b, "osVersion", 40, errors),
    appVersion: str(b, "appVersion", 40, errors),
    deviceModel: str(b, "deviceModel", 80, errors),
    occurredAt,
  };
  if (Object.keys(errors).length) throw new ValidationError(errors);
  return input;
}

/** The first few frames of the app's own code, without line/column numbers or bundle paths. */
export function crashFingerprint(name: string, stack: string, message: string): string {
  const frames = stack
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("at ") || /@/.test(line))
    .map((line) => line.replace(/\(?[^\s()]*:\d+:\d+\)?/g, "").replace(/@.*$/, "").replace(/^at\s+/, "").trim())
    .filter(Boolean)
    .slice(0, 5);
  // No frames (some minified errors): group by the message with numbers and ids taken out.
  const basis = frames.length ? frames.join("|") : message.replace(/[0-9a-f]{8}-[0-9a-f-]{27}|\d+/gi, "#");
  return createHash("sha256").update(`${name}\n${basis}`).digest("hex").slice(0, 32);
}

export async function recordCrash(userId: string, device: DeviceInfo, input: CrashInput): Promise<{ id: string; created: boolean }> {
  const fingerprint = crashFingerprint(input.name, input.stack, input.message);
  const row = await queryOne(
    `INSERT INTO crash_reports (user_id, client_report_id, fingerprint, kind, name, message, stack, component_stack, screen,
                                platform, os_version, app_version, device_model, occurred_at)
     VALUES (:'user', :'client', :'fingerprint', :'kind', :'name', :'message', :'stack', :'componentStack', :'screen',
             :'platform', :'osVersion', :'appVersion', :'deviceModel', :'occurredAt')
     ON CONFLICT (user_id, client_report_id) DO NOTHING RETURNING id`,
    { user: userId, client: input.clientReportId, fingerprint, kind: input.kind, name: input.name, message: input.message, stack: input.stack,
      componentStack: input.componentStack, screen: input.screen, platform: device.platform, osVersion: input.osVersion,
      appVersion: input.appVersion, deviceModel: input.deviceModel, occurredAt: input.occurredAt },
  );
  if (row) return { id: row.id as string, created: true };
  const existing = await queryOne(`SELECT id FROM crash_reports WHERE user_id = :'user' AND client_report_id = :'client'`, { user: userId, client: input.clientReportId });
  return { id: existing!.id as string, created: false };
}

export interface FeedbackInput {
  body: string;
  screenshotMediaId: string | null;
  osVersion: string;
  appVersion: string;
  deviceModel: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseFeedback(body: unknown): FeedbackInput {
  const b = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  const errors: Record<string, string> = {};
  const text = typeof b.body === "string" ? b.body.trim() : "";
  if (!text) errors.body = "Tell us what happened.";
  else if (text.length > 2000) errors.body = "Feedback can be at most 2000 characters.";
  let screenshotMediaId: string | null = null;
  if (b.screenshotMediaId !== undefined && b.screenshotMediaId !== null) {
    if (typeof b.screenshotMediaId !== "string" || !UUID_RE.test(b.screenshotMediaId)) errors.screenshotMediaId = "screenshotMediaId must be a valid media id.";
    else screenshotMediaId = b.screenshotMediaId;
  }
  const input = { body: text, screenshotMediaId, osVersion: str(b, "osVersion", 40, errors), appVersion: str(b, "appVersion", 40, errors), deviceModel: str(b, "deviceModel", 80, errors) };
  if (Object.keys(errors).length) throw new ValidationError(errors);
  return input;
}

export async function submitFeedback(userId: string, device: DeviceInfo, input: FeedbackInput): Promise<{ id: string }> {
  if (input.screenshotMediaId) {
    // Only a photo you uploaded yourself.
    const media = await mediaRepo.findMediaById(input.screenshotMediaId, true);
    if (!media || media.ownerId !== userId || media.kind !== "photo" || media.purgedAt || media.verificationDocument || (media.status !== "ready" && media.status !== "processing")) {
      throw new HttpError(422, "That screenshot can't be attached.", { screenshotMediaId: "Upload the screenshot first." });
    }
  }
  const row = await queryOne(
    `INSERT INTO app_feedback (user_id, body, screenshot_media_id, platform, os_version, app_version, device_model)
     VALUES (:'user', :'body', NULLIF(:'media', '')::uuid, :'platform', :'osVersion', :'appVersion', :'deviceModel') RETURNING id`,
    { user: userId, body: input.body, media: input.screenshotMediaId ?? "", platform: device.platform, osVersion: input.osVersion, appVersion: input.appVersion, deviceModel: input.deviceModel },
  );
  return { id: row!.id as string };
}

/** Crashes grouped by fingerprint, most frequent in the window first. */
export async function crashGroups(days: number, limit: number, offset: number): Promise<Record<string, unknown>[]> {
  const result = await query(
    `SELECT jsonb_build_object(
       'fingerprint', g.fingerprint, 'count', g.n, 'people', g.people, 'lastSeen', g.last_seen, 'firstSeen', g.first_seen,
       'kinds', g.kinds, 'platforms', g.platforms, 'appVersions', g.versions,
       'sample', (SELECT jsonb_build_object('id', c.id, 'name', c.name, 'message', c.message, 'stack', c.stack, 'componentStack', c.component_stack,
                                           'screen', c.screen, 'platform', c.platform, 'osVersion', c.os_version, 'appVersion', c.app_version,
                                           'deviceModel', c.device_model, 'occurredAt', c.occurred_at)
                  FROM crash_reports c WHERE c.fingerprint = g.fingerprint ORDER BY c.created_at DESC LIMIT 1)) AS data
     FROM (SELECT fingerprint, count(*) AS n, count(DISTINCT user_id) AS people, max(created_at) AS last_seen, min(created_at) AS first_seen,
                  jsonb_agg(DISTINCT kind) AS kinds, jsonb_agg(DISTINCT platform) AS platforms, jsonb_agg(DISTINCT app_version) AS versions
           FROM crash_reports WHERE created_at > now() - make_interval(days => :'days'::integer)
           GROUP BY fingerprint) g
     ORDER BY g.n DESC, g.last_seen DESC LIMIT :'limit' OFFSET :'offset'`,
    { days, limit, offset },
  );
  return result.map((r) => JSON.parse(r.data as string) as Record<string, unknown>);
}

export async function listFeedback(status: "open" | "resolved" | "all", limit: number, offset: number): Promise<Record<string, unknown>[]> {
  const result = await query(
    `SELECT jsonb_build_object('id', f.id, 'body', f.body, 'status', f.status, 'createdAt', f.created_at, 'resolvedAt', f.resolved_at,
              'platform', f.platform, 'osVersion', f.os_version, 'appVersion', f.app_version, 'deviceModel', f.device_model,
              'hasScreenshot', f.screenshot_media_id IS NOT NULL AND m.purged_at IS NULL,
              'user', jsonb_build_object('id', u.id, 'username', u.username)) AS data
     FROM app_feedback f JOIN users u ON u.id = f.user_id LEFT JOIN media m ON m.id = f.screenshot_media_id
     WHERE (:'status' = 'all' OR f.status = :'status')
     ORDER BY f.created_at DESC LIMIT :'limit' OFFSET :'offset'`,
    { status, limit, offset },
  );
  return result.map((r) => JSON.parse(r.data as string) as Record<string, unknown>);
}

export async function setFeedbackStatus(id: string, adminId: string, status: "open" | "resolved"): Promise<void> {
  const row = await queryOne(
    `WITH f AS (UPDATE app_feedback SET status = :'status', resolved_at = CASE WHEN :'status' = 'resolved' THEN now() END,
                                       resolved_by = CASE WHEN :'status' = 'resolved' THEN :'admin'::uuid END
                WHERE id = :'id' RETURNING id),
          a AS (INSERT INTO admin_audit (actor_id, action, target_id) SELECT :'admin', CASE WHEN :'status' = 'resolved' THEN 'FEEDBACK_RESOLVED' ELSE 'FEEDBACK_REOPENED' END, id FROM f)
     SELECT id FROM f`,
    { id, admin: adminId, status },
  );
  if (!row) throw new HttpError(404, "Feedback not found.");
}

export async function feedbackScreenshot(id: string): Promise<mediaRepo.MediaRecord> {
  const row = await queryOne(`SELECT screenshot_media_id FROM app_feedback WHERE id = :'id'`, { id });
  const media = row?.screenshot_media_id ? await mediaRepo.findMediaById(row.screenshot_media_id as string) : null;
  if (!media || media.purgedAt) throw new HttpError(404, "Screenshot unavailable.");
  return media;
}

/** Crash reports older than 90 days go; resolved feedback after 180 days (retention.ts). */
export const CRASH_RETENTION_DAYS = 90;
export const RESOLVED_FEEDBACK_RETENTION_DAYS = 180;
