import type { Router } from "../../http/router";
import { requireAuth } from "../../http/middleware/auth.middleware";
import { sendJson } from "../../http/respond";
import { parsePagination, parseQueryString } from "../../http/pagination";
import { parseUsernameParam } from "../../shared/validation";
import { parseForwardInput, parseReportMessageInput, parseSendMessageInput, parseStoryReplyInput } from "./dto";
import { reportLimiter } from "../moderation/moderation.routes";
import { HttpError } from "../../http/errors";
import * as conversationsService from "./conversations.service";
import * as groupsService from "./groups.service";

/** An app that shows group chats says so (?groups=1); older apps never see one. */
const wantsGroups = (params: Record<string, string | undefined>) => params.groups === "1";

export function registerConversationsRoutes(router: Router): void {
  router.post("/api/v1/users/:username/conversation", async (req, res) => {
    requireAuth(req);
    const username = parseUsernameParam(req.params.username);
    const conversation = await conversationsService.openConversationWith(req.userId as string, username);
    sendJson(res, 200, { conversation });
  });

  router.get("/api/v1/conversations", async (req, res) => {
    requireAuth(req);
    const params = parseQueryString(req.url ?? "");
    const { limit, offset } = parsePagination(params);
    const conversations = await conversationsService.listConversations(req.userId as string, limit, offset, params.q ?? "", wantsGroups(params));
    sendJson(res, 200, { conversations, limit, offset });
  });

  router.get("/api/v1/conversations/unread-count", async (req, res) => {
    requireAuth(req);
    const count = await conversationsService.getUnreadConversationCount(req.userId as string);
    sendJson(res, 200, { count });
  });

  router.get("/api/v1/conversations/:id", async (req, res) => {
    requireAuth(req);
    const conversation = await conversationsService.getConversation(req.userId as string, req.params.id as string, wantsGroups(parseQueryString(req.url ?? "")));
    sendJson(res, 200, { conversation });
  });

  // Group chats (groups.service.ts).
  router.post("/api/v1/conversations/groups", async (req, res) => {
    requireAuth(req);
    const b = (req.body ?? {}) as { usernames?: unknown; title?: unknown };
    const conversation = await groupsService.createGroup(req.userId as string, groupsService.parseUsernames(b.usernames, groupsService.MAX_GROUP_MEMBERS - 1), groupsService.parseTitle(b.title));
    sendJson(res, 201, { conversation });
  });

  router.patch("/api/v1/conversations/:id", async (req, res) => {
    requireAuth(req);
    const conversation = await groupsService.renameGroup(req.userId as string, req.params.id as string, groupsService.parseTitle((req.body as { title?: unknown } | undefined)?.title));
    sendJson(res, 200, { conversation });
  });

  router.post("/api/v1/conversations/:id/members", async (req, res) => {
    requireAuth(req);
    const conversation = await groupsService.addPeople(req.userId as string, req.params.id as string, groupsService.parseUsernames((req.body as { usernames?: unknown } | undefined)?.usernames));
    sendJson(res, 200, { conversation });
  });

  router.delete("/api/v1/conversations/:id/members/:userId", async (req, res) => {
    requireAuth(req);
    const conversation = await groupsService.removePerson(req.userId as string, req.params.id as string, req.params.userId as string);
    sendJson(res, 200, { conversation });
  });

  router.post("/api/v1/conversations/:id/leave", async (req, res) => {
    requireAuth(req);
    await groupsService.leaveGroup(req.userId as string, req.params.id as string);
    sendJson(res, 204, undefined);
  });

  router.get("/api/v1/conversations/:id/messages", async (req, res) => {
    requireAuth(req);
    const params = parseQueryString(req.url ?? "");
    const { limit, offset } = parsePagination(params);
    // ?before=<messageId> / ?after=<messageId>: stable pages that don't shift as messages arrive.
    const cursorId = params.before ?? params.after;
    if (cursorId !== undefined && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cursorId)) {
      throw new HttpError(400, "Invalid message cursor.");
    }
    const cursor = params.before ? { before: params.before } : params.after ? { after: params.after } : undefined;
    const page = await conversationsService.listMessages(req.userId as string, req.params.id as string, limit, offset, cursor);
    sendJson(res, 200, { messages: page.messages, limit, offset, ...(page.hasMore === null ? {} : { hasMore: page.hasMore }) });
  });

  // A reply or quick reaction to a Story, delivered to its owner's DMs.
  router.post("/api/v1/stories/:id/replies", async (req, res) => {
    requireAuth(req);
    const input = parseStoryReplyInput(req.body);
    const { message, created, conversationId } = await conversationsService.replyToStory(req.userId as string, req.params.id as string, input);
    sendJson(res, created ? 201 : 200, { message, conversationId });
  });
  router.post("/api/v1/conversations/:id/messages", async (req, res) => {
    requireAuth(req);
    const input = parseSendMessageInput(req.body);
    const { message, created } = await conversationsService.sendMessage(req.userId as string, req.params.id as string, input);
    sendJson(res, created ? 201 : 200, { message });
  });

  // The reporter chooses to share the reported message and the nine before it with moderators.
  // Long-press a message to react; the same request with another emoji changes it.
  router.put("/api/v1/conversations/:id/messages/:messageId/reaction", async (req, res) => {
    requireAuth(req);
    const emoji = (req.body as { emoji?: unknown } | undefined)?.emoji;
    if (typeof emoji !== "string") throw new HttpError(422, "Choose one of the reactions.");
    const reactions = await conversationsService.reactToMessage(req.userId as string, req.params.id as string, req.params.messageId as string, emoji);
    sendJson(res, 200, { reactions });
  });

  router.delete("/api/v1/conversations/:id/messages/:messageId/reaction", async (req, res) => {
    requireAuth(req);
    const reactions = await conversationsService.reactToMessage(req.userId as string, req.params.id as string, req.params.messageId as string, null);
    sendJson(res, 200, { reactions });
  });

  // Send a message on to up to ten people and ten chats; each one's outcome comes back.
  router.post("/api/v1/conversations/:id/messages/:messageId/forward", async (req, res) => {
    requireAuth(req);
    const targets = parseForwardInput(req.body);
    const results = await conversationsService.forwardMessage(req.userId as string, req.params.id as string, req.params.messageId as string, targets);
    sendJson(res, 200, { results });
  });

  // Pinned messages: shared by everyone in the chat, up to three.
  router.get("/api/v1/conversations/:id/pins", async (req, res) => {
    requireAuth(req);
    const pins = await conversationsService.listPins(req.userId as string, req.params.id as string);
    sendJson(res, 200, { pins });
  });

  router.put("/api/v1/conversations/:id/pins/:messageId", async (req, res) => {
    requireAuth(req);
    await conversationsService.pinMessage(req.userId as string, req.params.id as string, req.params.messageId as string);
    sendJson(res, 204, undefined);
  });

  router.delete("/api/v1/conversations/:id/pins/:messageId", async (req, res) => {
    requireAuth(req);
    await conversationsService.unpinMessage(req.userId as string, req.params.id as string, req.params.messageId as string);
    sendJson(res, 204, undefined);
  });

  // Unsend your own message (for everyone).
  router.delete("/api/v1/conversations/:id/messages/:messageId", async (req, res) => {
    requireAuth(req);
    await conversationsService.unsendMessage(req.userId as string, req.params.id as string, req.params.messageId as string);
    sendJson(res, 204, undefined);
  });

  // Your own settings for a conversation: mute its pushes; delete it from your inbox.
  router.put("/api/v1/conversations/:id/mute", async (req, res) => {
    requireAuth(req);
    const muted = (req.body as { muted?: unknown } | undefined)?.muted;
    if (typeof muted !== "boolean") throw new HttpError(422, "muted must be true or false.");
    await conversationsService.setMuted(req.userId as string, req.params.id as string, muted);
    sendJson(res, 204, undefined);
  });

  router.post("/api/v1/conversations/:id/hide", async (req, res) => {
    requireAuth(req);
    await conversationsService.hideConversation(req.userId as string, req.params.id as string);
    sendJson(res, 204, undefined);
  });

  router.post("/api/v1/conversations/:id/report", async (req, res) => {
    requireAuth(req);
    reportLimiter.check(req.userId as string);
    const input = parseReportMessageInput(req.body);
    const { report, created } = await conversationsService.reportMessage(req.userId as string, req.params.id as string, input);
    sendJson(res, created ? 201 : 200, { report });
  });

  // "typing…": sent every few seconds while someone types; relayed to the other person's devices.
  router.post("/api/v1/conversations/:id/typing", async (req, res) => {
    requireAuth(req);
    await conversationsService.signalTyping(req.userId as string, req.params.id as string);
    sendJson(res, 204, undefined);
  });

  router.post("/api/v1/conversations/:id/read", async (req, res) => {
    requireAuth(req);
    await conversationsService.markConversationRead(req.userId as string, req.params.id as string);
    sendJson(res, 204, undefined);
  });
}
