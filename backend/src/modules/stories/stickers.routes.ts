import type { Router } from "../../http/router";
import { requireAuth } from "../../http/middleware/auth.middleware";
import { sendJson } from "../../http/respond";
import { parsePagination, parseQueryString } from "../../http/pagination";
import { parseAnswerInput, parseVoteInput } from "./dto";
import * as stickersService from "./stickers.service";
import * as collabService from "./collab.service";
import { lookupSong } from "./song-links";
import { enforceAction } from "../safety/limits";

/** Interactive stickers, "Add Yours" chains and Collab Stories (stickers.service.ts, collab.service.ts). */
export function registerStickerRoutes(router: Router): void {
  // Checked while a link sticker is made, so the editor can say why at once.
  router.post("/api/v1/stories/link-check", async (req, res) => {
    requireAuth(req);
    const body = (typeof req.body === "object" && req.body !== null ? req.body : {}) as Record<string, unknown>;
    const url = await stickersService.checkLink(req.userId as string, body.url);
    sendJson(res, 200, { url });
  });

  // The song sticker's preview: title, artist and cover for a Spotify / YouTube Music / YouTube link.
  router.post("/api/v1/stories/song-lookup", async (req, res) => {
    requireAuth(req);
    const body = (typeof req.body === "object" && req.body !== null ? req.body : {}) as Record<string, unknown>;
    await enforceAction(req.userId as string, "song_lookup");
    sendJson(res, 200, { song: await lookupSong(body.url) });
  });

  router.post("/api/v1/stories/:id/stickers/:stickerId/vote", async (req, res) => {
    requireAuth(req);
    const option = parseVoteInput(req.body);
    const outcome = await stickersService.vote(req.userId as string, req.params.id as string, req.params.stickerId as string, option);
    sendJson(res, 200, outcome);
  });

  router.post("/api/v1/stories/:id/stickers/:stickerId/answers", async (req, res) => {
    requireAuth(req);
    const body = parseAnswerInput(req.body);
    const answer = await stickersService.answerQuestion(req.userId as string, req.params.id as string, req.params.stickerId as string, body);
    sendJson(res, 201, { answer });
  });

  router.put("/api/v1/stories/:id/stickers/:stickerId/reminder", async (req, res) => {
    requireAuth(req);
    sendJson(res, 200, await stickersService.setReminder(req.userId as string, req.params.id as string, req.params.stickerId as string, true));
  });

  router.delete("/api/v1/stories/:id/stickers/:stickerId/reminder", async (req, res) => {
    requireAuth(req);
    sendJson(res, 200, await stickersService.setReminder(req.userId as string, req.params.id as string, req.params.stickerId as string, false));
  });

  // Owner-only: who voted and what, or the answers to a question.
  router.get("/api/v1/stories/:id/stickers/:stickerId/responses", async (req, res) => {
    requireAuth(req);
    const { limit, offset } = parsePagination(parseQueryString(req.url ?? ""));
    const responses = await stickersService.listResponses(req.userId as string, req.params.id as string, req.params.stickerId as string, limit, offset);
    sendJson(res, 200, { ...responses, limit, offset });
  });

  router.delete("/api/v1/stories/:id/stickers/:stickerId/responses/:responseId", async (req, res) => {
    requireAuth(req);
    await stickersService.deleteResponse(req.userId as string, req.params.id as string, req.params.stickerId as string, req.params.responseId as string);
    sendJson(res, 204, undefined);
  });

  router.get("/api/v1/add-yours/:chainId", async (req, res) => {
    requireAuth(req);
    const { limit, offset } = parsePagination(parseQueryString(req.url ?? ""));
    const view = await stickersService.getChain(req.userId as string, req.params.chainId as string, limit, offset);
    sendJson(res, 200, { ...view, limit, offset });
  });

  // The Story editor's "Invite collaborator" picker: only people the owner may invite.
  router.get("/api/v1/collab-candidates", async (req, res) => {
    requireAuth(req);
    const people = await collabService.listInvitable(req.userId as string, parseQueryString(req.url ?? "").q ?? "");
    sendJson(res, 200, { people });
  });

  router.post("/api/v1/stories/:id/collab/accept", async (req, res) => {
    requireAuth(req);
    sendJson(res, 200, { collab: await collabService.respond(req.userId as string, req.params.id as string, true) });
  });

  router.post("/api/v1/stories/:id/collab/decline", async (req, res) => {
    requireAuth(req);
    sendJson(res, 200, { collab: await collabService.respond(req.userId as string, req.params.id as string, false) });
  });

  // The owner removes the collaborator, or the collaborator leaves.
  router.delete("/api/v1/stories/:id/collab", async (req, res) => {
    requireAuth(req);
    await collabService.end(req.userId as string, req.params.id as string);
    sendJson(res, 204, undefined);
  });
}
