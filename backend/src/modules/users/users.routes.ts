import type { Router } from "../../http/router";
import { requireAuth } from "../../http/middleware/auth.middleware";
import { sendJson } from "../../http/respond";
import { parsePagination, parseQueryString } from "../../http/pagination";
import { parseUsernameParam } from "../../shared/validation";
import { parseDeleteAccountInput, parseUpdateProfileInput } from "./dto";
import * as profilesService from "./profiles.service";
import * as usersRepo from "./users.repository";
import * as mediaRepo from "../media/media.repository";
import * as socialRepo from "../social/social.repository";
import { mediaStorage } from "../media/instance";
import { parseVariant, sendMediaFile } from "../media/delivery";
import { HttpError } from "../../http/errors";
import { queryOne } from "../../db/psql";
import { cleanUsername, USERNAME_MESSAGES, usernameProblem } from "./username-policy";

const USER_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function registerUserRoutes(router: Router): void {
  router.get("/api/v1/users/:username/avatar/file", async (req, res) => {
    requireAuth(req);
    const username = parseUsernameParam(req.params.username);
    const user = await usersRepo.findUserByUsername(username);
    if (!user || !user.isActive || !user.avatarMediaId) throw new HttpError(404, "Avatar not found.");
    if (user.id !== req.userId && await socialRepo.anyBlockBetween(req.userId as string, user.id)) {
      throw new HttpError(404, "Avatar not found.");
    }
    const media = await mediaRepo.findMediaById(user.avatarMediaId, true);
    if (!media || media.ownerId !== user.id || media.kind !== "photo" || media.status !== "ready") throw new HttpError(404, "Avatar not found.");
    // Avatars are small on screen: the thumbnail unless a size is asked for.
    const params = new URLSearchParams((req.url ?? "").split("?")[1] ?? "");
    await sendMediaFile(req, res, media, parseVariant(params.get("variant")) ?? "thumbnail", user.id === req.userId, mediaStorage);
  });

  // Live availability while someone types a username, at sign-up (signed out) or in Edit
  // Profile and onboarding. Signed in, a person's current name and the names they released in
  // the last 14 days count as theirs. Saving still re-checks everything: this only informs.
  router.get("/api/v1/usernames/availability", async (req, res) => {
    if (req.headers.authorization) requireAuth(req);
    const username = cleanUsername(parseQueryString(req.url ?? "").username);
    res.setHeader("Cache-Control", "no-store");
    const problem = usernameProblem(username);
    if (problem) {
      sendJson(res, 200, { username, available: false, reason: problem.reason, message: problem.message });
      return;
    }
    const row = await queryOne("SELECT username_availability(:'username', NULLIF(:'user', '')::uuid) AS state", {
      username,
      user: req.userId ?? "",
    });
    const state = (row?.state ?? "taken") as "available" | "yours" | "taken" | "held";
    sendJson(res, 200, {
      username,
      available: state === "available" || state === "yours",
      reason: state,
      message: USERNAME_MESSAGES[state],
    });
  });

  router.get("/api/v1/users/:username", async (req, res) => {
    requireAuth(req);
    // Links can name the account by its permanent ID instead (katkee://user/<name>?id=<id>),
    // which still finds the person after a rename. A username never looks like an ID.
    const param = (req.params.username ?? "").trim().toLowerCase();
    const profile = USER_ID_RE.test(param)
      ? await profilesService.getProfileById(param, req.userId as string)
      : await profilesService.getProfileByUsername(parseUsernameParam(param), req.userId as string);
    sendJson(res, 200, { profile });
  });

  router.patch("/api/v1/users/me", async (req, res) => {
    requireAuth(req);
    const input = parseUpdateProfileInput(req.body);
    const user = await profilesService.updateMyProfile(req.userId as string, input);
    sendJson(res, 200, {
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        displayName: user.displayName,
        bio: user.bio,
        avatarMediaId: user.avatarMediaId,
        interests: user.interests,
        isPrivate: user.isPrivate,
      },
    });
  });

  router.delete("/api/v1/users/me", async (req, res) => {
    requireAuth(req);
    const { password } = parseDeleteAccountInput(req.body);
    await profilesService.deleteMyAccount(req.userId as string, password);
    sendJson(res, 204, undefined);
  });

  router.get("/api/v1/users/:username/followers", async (req, res) => {
    requireAuth(req);
    const username = parseUsernameParam(req.params.username);
    const { limit, offset } = parsePagination(parseQueryString(req.url ?? ""));
    const followers = await profilesService.getFollowers(username, req.userId as string, limit, offset);
    sendJson(res, 200, { followers, limit, offset });
  });

  router.get("/api/v1/users/:username/following", async (req, res) => {
    requireAuth(req);
    const username = parseUsernameParam(req.params.username);
    const { limit, offset } = parsePagination(parseQueryString(req.url ?? ""));
    const following = await profilesService.getFollowing(username, req.userId as string, limit, offset);
    sendJson(res, 200, { following, limit, offset });
  });
}
