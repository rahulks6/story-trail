import type { Router } from "../../http/router";
import { requireAuth } from "../../http/middleware/auth.middleware";
import { sendJson } from "../../http/respond";
import { parsePagination, parseQueryString } from "../../http/pagination";
import { parseCommentInput } from "./dto";
import * as engagementService from "./engagement.service";
import { HttpError } from "../../http/errors";

function toPublicComment(comment: Awaited<ReturnType<typeof engagementService.createComment>>) {
  return {
    id: comment.id,
    storyId: comment.storyId,
    userId: comment.userId,
    username: comment.username,
    displayName: comment.displayName,
    avatarMediaId: comment.avatarMediaId,
    verified: comment.verified,
    body: comment.body,
    createdAt: comment.createdAt,
    parentId: comment.parentId,
    likeCount: comment.likeCount,
    likedByMe: comment.likedByMe,
  };
}

export function registerEngagementRoutes(router: Router): void {
  router.post("/api/v1/stories/:id/like", async (req, res) => {
    requireAuth(req);
    await engagementService.likeStory(req.userId as string, req.params.id as string);
    sendJson(res, 204, undefined);
  });

  router.delete("/api/v1/stories/:id/like", async (req, res) => {
    requireAuth(req);
    await engagementService.unlikeStory(req.userId as string, req.params.id as string);
    sendJson(res, 204, undefined);
  });

  router.post("/api/v1/stories/:id/comments", async (req, res) => {
    requireAuth(req);
    const body = parseCommentInput(req.body);
    // A reply names the comment it answers; anything else is a top-level comment.
    const raw = (req.body as { replyTo?: unknown } | null)?.replyTo;
    const replyTo = typeof raw === "string" && /^[0-9a-f-]{36}$/i.test(raw) ? raw : null;
    if (raw !== undefined && raw !== null && !replyTo) throw new HttpError(422, "That comment isn't here any more.");
    const comment = await engagementService.createComment(req.userId as string, req.params.id as string, body, replyTo);
    sendJson(res, 201, { comment: toPublicComment(comment) });
  });

  router.get("/api/v1/stories/:id/comments", async (req, res) => {
    requireAuth(req);
    const { limit, offset } = parsePagination(parseQueryString(req.url ?? ""));
    const comments = await engagementService.listComments(req.userId as string, req.params.id as string, limit, offset);
    sendJson(res, 200, { comments: comments.map(toPublicComment), limit, offset });
  });

  router.post("/api/v1/comments/:id/like", async (req, res) => {
    requireAuth(req);
    await engagementService.likeComment(req.userId as string, req.params.id as string);
    sendJson(res, 204, undefined);
  });

  router.delete("/api/v1/comments/:id/like", async (req, res) => {
    requireAuth(req);
    await engagementService.unlikeComment(req.userId as string, req.params.id as string);
    sendJson(res, 204, undefined);
  });

  router.delete("/api/v1/comments/:id", async (req, res) => {
    requireAuth(req);
    await engagementService.deleteComment(req.userId as string, req.params.id as string);
    sendJson(res, 204, undefined);
  });

  router.post("/api/v1/stories/:id/share", async (req, res) => {
    requireAuth(req);
    await engagementService.shareStory(req.userId as string, req.params.id as string);
    sendJson(res, 204, undefined);
  });
}
