import type { Router } from "../../http/router";
import { requireAuth } from "../../http/middleware/auth.middleware";
import { sendJson } from "../../http/respond";
import { parsePagination, parseQueryString } from "../../http/pagination";
import { parseUsernameParam } from "../../shared/validation";
import { parseSendMessageInput } from "./dto";
import { HttpError } from "../../http/errors";
import * as conversationsService from "./conversations.service";

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
    const conversations = await conversationsService.listConversations(req.userId as string, limit, offset, params.q ?? "");
    sendJson(res, 200, { conversations, limit, offset });
  });

  router.get("/api/v1/conversations/unread-count", async (req, res) => {
    requireAuth(req);
    const count = await conversationsService.getUnreadConversationCount(req.userId as string);
    sendJson(res, 200, { count });
  });

  router.get("/api/v1/conversations/:id", async (req, res) => {
    requireAuth(req);
    const conversation = await conversationsService.getConversation(req.userId as string, req.params.id as string);
    sendJson(res, 200, { conversation });
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

  router.post("/api/v1/conversations/:id/messages", async (req, res) => {
    requireAuth(req);
    const input = parseSendMessageInput(req.body);
    const { message, created } = await conversationsService.sendMessage(req.userId as string, req.params.id as string, input);
    sendJson(res, created ? 201 : 200, { message });
  });

  router.post("/api/v1/conversations/:id/read", async (req, res) => {
    requireAuth(req);
    await conversationsService.markConversationRead(req.userId as string, req.params.id as string);
    sendJson(res, 204, undefined);
  });
}
