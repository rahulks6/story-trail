import type { Router } from "../../http/router";
import { requireAuth } from "../../http/middleware/auth.middleware";
import { sendJson } from "../../http/respond";
import { HttpError } from "../../http/errors";
import { RateLimiter, clientIp } from "../../http/rateLimiter";
import { body } from "../admin/policy";
import { matchContacts, parseContactHashes } from "./contacts";
import { inviterForCode, myInvite, parseInviteCode, redeemInvite } from "./invites";

/** Looking up whose invite a code is, signed out: enough for real links, too few to walk codes. */
const inviteLookupLimit = new RateLimiter(15 * 60_000, 60);

/** Contacts on Katkee and Invite friends (see contacts.ts and invites.ts). */
export function registerGrowthRoutes(router: Router): void {
  // One batch of hashed emails and phone numbers in, the accounts behind them out. Nothing in
  // the request is stored or logged.
  router.post("/api/v1/contacts/match", async (req, res) => {
    requireAuth(req);
    const hashes = parseContactHashes(req.body);
    res.setHeader("Cache-Control", "no-store");
    sendJson(res, 200, { matches: await matchContacts(req.userId as string, hashes) });
  });

  // Your own link (made on first use), and how many people have joined from it.
  router.get("/api/v1/invites/me", async (req, res) => {
    requireAuth(req);
    res.setHeader("Cache-Control", "no-store");
    sendJson(res, 200, { invite: await myInvite(req.userId as string) });
  });

  // Opened an invite link in the app: credit this new account to the link's owner.
  router.post("/api/v1/invites/redeem", async (req, res) => {
    requireAuth(req);
    const code = parseInviteCode(body(req.body).code);
    sendJson(res, 200, await redeemInvite(req.userId as string, code));
  });

  // "Invited by …" on the app's sign-up screen, before there's an account. Name only.
  router.get("/api/v1/invites/:code", async (req, res) => {
    inviteLookupLimit.check(clientIp(req));
    const inviter = await inviterForCode(parseInviteCode(req.params.code));
    if (!inviter) throw new HttpError(404, "This invite link isn't valid.");
    res.setHeader("Cache-Control", "no-store");
    sendJson(res, 200, { inviter: { username: inviter.username, displayName: inviter.displayName, verified: inviter.verified } });
  });
}
