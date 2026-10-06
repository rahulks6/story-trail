import type { Router } from "../../http/router";
import { requireAuth } from "../../http/middleware/auth.middleware";
import { sendJson } from "../../http/respond";
import { parsePagination, parseQueryString } from "../../http/pagination";
import { parseSearchQuery, parseSearchScope, parseSuggestionLimit } from "../users/dto";
import * as usersRepo from "../users/users.repository";

export function registerSearchRoutes(router: Router): void {
  router.get("/api/v1/search/users", async (req, res) => {
    requireAuth(req);
    const parsedQuery = parseQueryString(req.url ?? "");
    const term = parseSearchQuery(parsedQuery.q);
    const { limit, offset } = parsePagination(parsedQuery);
    const followingOnly = parseSearchScope(parsedQuery.scope) === "following";
    const results = await usersRepo.searchUsers(term, req.userId as string, limit, offset, { followingOnly });
    sendJson(res, 200, { results, limit, offset });
  });

  // "Suggested for you", shown in Search before anything is typed (spec section 10).
  router.get("/api/v1/search/suggestions", async (req, res) => {
    requireAuth(req);
    const limit = parseSuggestionLimit(parseQueryString(req.url ?? "").limit);
    const suggestions = await usersRepo.suggestPeople(req.userId as string, limit);
    sendJson(res, 200, { suggestions });
  });
}
