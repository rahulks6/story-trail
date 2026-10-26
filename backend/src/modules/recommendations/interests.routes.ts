import type { Router } from "../../http/router";
import { HttpError } from "../../http/errors";
import { requireAuth } from "../../http/middleware/auth.middleware";
import { sendJson } from "../../http/respond";
import { canonicalTopic } from "../../shared/topics";
import * as usersRepo from "../users/users.repository";
import * as topicAffinity from "./topic-affinity.repository";
import { topicStrength } from "./scoring";

/** Settings > Your interests shows this many learned topics at most. */
const LEARNED_SHOWN = 5;

/**
 * Your interests, for you alone (Settings > Your interests): the ones you chose on your
 * profile, and the topics Katkee has learned you like from what you watch, as "high" or
 * "medium" (never the score). Removing a learned topic sets it back to 0 and keeps it there
 * for 30 days. Nothing here is in any other response, or ever shown to anyone else.
 */
export function registerInterestsRoutes(router: Router): void {
  router.get("/api/v1/me/interests", async (req, res) => {
    requireAuth(req);
    const [user, learned] = await Promise.all([usersRepo.findUserById(req.userId!), topicAffinity.learnedScores(req.userId!)]);
    const shown = learned.flatMap(({ topic, score }) => {
      const strength = topicStrength(score);
      return strength ? [{ topic, strength }] : [];
    });
    res.setHeader("Cache-Control", "no-store");
    sendJson(res, 200, { chosen: user?.interests ?? [], learned: shown.slice(0, LEARNED_SHOWN) });
  });

  router.delete("/api/v1/me/interests/learned/:topic", async (req, res) => {
    requireAuth(req);
    const topic = canonicalTopic(req.params.topic);
    if (!topic) throw new HttpError(404, "Topic not found.");
    await topicAffinity.forgetTopic(req.userId!, topic);
    sendJson(res, 204, undefined);
  });
}
