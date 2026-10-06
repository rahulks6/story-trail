import { authorize, type Permission, type Principal } from "../admin/policy";
import { moderate } from "../admin/admin.service";
import { queryOne } from "../../db/psql";
import { HttpError } from "../../http/errors";
import * as usersRepo from "../users/users.repository";
import * as storiesRepo from "../stories/stories.repository";
import * as commentsRepo from "../stories/comments.repository";
import * as storiesService from "../stories/stories.service";
import * as engagementService from "../stories/engagement.service";
import * as refreshTokensRepo from "../auth/refresh-tokens.repository";
import * as moderationRepo from "./moderation.repository";
import type { ReportRow, ReportStatus, TargetType } from "./moderation.repository";
import type { CreateReportInput, ResolveReportInput } from "./dto";

/** Callers pass the Admin-session principal from requireAdmin; this re-checks the specific permission. */
function requireModerator(principal: Principal, permission: Permission = "reports.read"): Principal {
 authorize(principal, permission);
 return principal;
}

async function assertReportableAndNotSelf(reporterId: string, targetType: TargetType, targetId: string): Promise<void> {
  if (targetType === "user") {
    if (targetId === reporterId) throw new HttpError(400, "You can't report yourself.");
    const user = await usersRepo.findUserById(targetId);
    if (!user) throw new HttpError(404, "User not found.");
    return;
  }
  if (targetType === "story") {
    const story = await storiesRepo.findStoryById(targetId);
    if (!story || story.deletedAt !== null) throw new HttpError(404, "Story not found.");
    if (story.ownerId === reporterId) throw new HttpError(400, "You can't report your own Story.");
    return;
  }
  const comment = await commentsRepo.findCommentWithStoryOwner(targetId);
  if (!comment) throw new HttpError(404, "Comment not found.");
  if (comment.userId === reporterId) throw new HttpError(400, "You can't report your own comment.");
}

export async function createReport(reporterId: string, input: CreateReportInput): Promise<{ report: ReportRow; created: boolean }> {
  await assertReportableAndNotSelf(reporterId, input.targetType, input.targetId);
  return moderationRepo.createReport({
    reporterId,
    targetType: input.targetType,
    targetId: input.targetId,
    reason: input.reason,
    details: input.details,
  });
}

export type ReportTarget =
  | { type: "user"; username: string; displayName: string; isActive: boolean }
  | { type: "story"; ownerUsername: string; audience: string; deleted: boolean }
  | { type: "comment"; authorUsername: string; body: string; storyId: string; deleted: boolean }
  | { type: "unknown" };

export interface ReportQueueEntry extends ReportRow {
  reporter: { username: string; displayName: string };
  target: ReportTarget;
}

async function denormalizeTarget(report: ReportRow): Promise<ReportTarget> {
  if (report.targetType === "user") {
    const user = await usersRepo.findUserById(report.targetId);
    if (!user) return { type: "unknown" };
    return { type: "user", username: user.username, displayName: user.displayName, isActive: user.isActive };
  }
  if (report.targetType === "story") {
    const story = await storiesRepo.findStoryById(report.targetId);
    if (!story) return { type: "unknown" };
    const owner = await usersRepo.findUserById(story.ownerId);
    return { type: "story", ownerUsername: owner?.username ?? "(unknown)", audience: story.audience, deleted: story.deletedAt !== null };
  }
  const comment = await commentsRepo.findCommentForModeration(report.targetId);
  if (!comment) return { type: "unknown" };
  return {
    type: "comment",
    authorUsername: comment.username,
    body: comment.body,
    storyId: comment.storyId,
    deleted: comment.deletedAt !== null,
  };
}

export async function listReportsQueue(
  moderator: Principal,
  status: ReportStatus,
  limit: number,
  offset: number,
): Promise<ReportQueueEntry[]> {
  requireModerator(moderator);
  const reports = await moderationRepo.listReports(status, limit, offset);
  const entries: ReportQueueEntry[] = [];
  for (const report of reports) {
    const reporter = await usersRepo.findUserById(report.reporterId);
    const target = await denormalizeTarget(report);
    entries.push({
      ...report,
      reporter: { username: reporter?.username ?? "(unknown)", displayName: reporter?.displayName ?? "Unknown" },
      target,
    });
  }
  return entries;
}

export async function resolveReport(moderator: Principal, reportId: string, input: ResolveReportInput): Promise<ReportRow> {
 const p=requireModerator(moderator,"reports.review");
 const row=await queryOne(`SELECT version,target_type FROM reports WHERE id=:'id'`,{id:reportId});
 if(!row)throw new HttpError(404,"Report not found.");
 if(input.action==='remove_content' && row.target_type==='user' || input.action==='suspend_user' && row.target_type!=='user') throw new HttpError(400,"This action does not apply to the report target.");
 await moderate(p,{reportId,version:Number(row.version),action:input.action==="dismiss"?"keep":input.action==="remove_content"?"remove":"suspend",reason:input.note??"Reviewed through moderation API",confirmed:true});
 const result=await moderationRepo.findReportById(reportId);if(!result)throw new HttpError(404,"Report not found.");return result;
}
export async function suspendUserByUsername(moderator:Principal,username:string):Promise<void>{
 const p=requireModerator(moderator,"users.suspend"); const user=await usersRepo.findUserByUsername(username);if(!user)throw new HttpError(404,"User not found.");
 await moderate(p,{targetType:"user",targetId:user.id,action:"suspend",reason:"Suspended through moderation API",confirmed:true});
}
export async function unsuspendUserByUsername(moderator:Principal,username:string):Promise<void>{
 const p=requireModerator(moderator,"users.suspend"); const user=await usersRepo.findUserByUsername(username);if(!user)throw new HttpError(404,"User not found.");
 await moderate(p,{targetType:"user",targetId:user.id,action:"restore_account",reason:"Restored through moderation API",confirmed:true});
}
