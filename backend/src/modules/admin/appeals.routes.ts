import type { Router } from "../../http/router";
import { body, password, text, uuid } from "./policy";
import { findUserByEmail } from "../users/users.repository";
import { verifyPassword } from "../auth/password";
import { HttpError } from "../../http/errors";
import { RateLimiter, clientIp } from "../../http/rateLimiter";
import { sendJson } from "../../http/respond";
import { one, rows } from "./admin.service";
import {queryOne} from '../../db/psql';
import {proofToken,reauthTicket} from '../auth/provider.service';
const limiter = new RateLimiter(15 * 60000, 10);
export function registerAppealRoutes(router: Router): void {
    router.post('/api/v1/moderation/access',async(req,res)=>{
        limiter.check(clientIp(req));const b=body(req.body);let userId:string|undefined;
        if(b.proof){
            const proof=await queryOne(`UPDATE auth_provider_proofs p SET consumed_at=now() FROM auth_identities i JOIN users u ON u.id=i.user_id WHERE p.token_hash=:'hash' AND p.provider=i.provider AND p.subject=i.subject AND p.consumed_at IS NULL AND p.expires_at>now() AND u.deleted_at IS NULL RETURNING i.user_id`,{hash:proofToken(b.proof)});
            userId=proof?.user_id??undefined;
        }else{
            const user=await findUserByEmail(text(b.email,254));
            if(user&&await verifyPassword(password(b.password),user.passwordHash))userId=user.id;
        }
        if(!userId)throw new HttpError(401,'Unable to verify this account.');
        const ticket=await reauthTicket(userId);
        const items=await rows(`SELECT jsonb_build_object('actionId',a.id,'action',a.action,'reason',a.reason,'createdAt',a.created_at,'appealStatus',p.status,'appealable',moderation_action_appealable(a.action) AND p.id IS NULL) AS data FROM moderation_notices n JOIN moderation_actions a ON a.id=n.action_id LEFT JOIN moderation_appeals p ON p.action_id=a.id AND p.user_id=n.user_id WHERE n.user_id=:'user' ORDER BY n.created_at DESC LIMIT 20`,{user:userId});
        res.setHeader('Cache-Control','no-store');sendJson(res,200,{ticket:ticket.reauthTicket,items});
    });
    router.post('/api/v1/moderation/appeal/submit',async(req,res)=>{
        limiter.check(clientIp(req));const b=body(req.body);
        const result=await one(`WITH access AS(UPDATE auth_reauth_tickets t SET consumed_at=now() WHERE token_hash=:'ticket' AND consumed_at IS NULL AND expires_at>now() AND EXISTS(SELECT 1 FROM moderation_notices n JOIN moderation_actions a ON a.id=n.action_id WHERE n.user_id=t.user_id AND n.action_id=:'action' AND moderation_action_appealable(a.action)) RETURNING user_id),appeal AS(INSERT INTO moderation_appeals(action_id,user_id,reason) SELECT :'action',user_id,:'reason' FROM access ON CONFLICT(action_id,user_id) DO NOTHING RETURNING id) SELECT jsonb_build_object('accepted',EXISTS(SELECT 1 FROM access)) AS data`,{ticket:proofToken(b.ticket),action:uuid(b.actionId),reason:text(b.reason,1000)});
        if(!result?.accepted)throw new HttpError(401,'Verify your account again to submit this appeal.');
        sendJson(res,200,result);
    });
    for (const action of ['notices', 'appeal'])
        router.post('/api/v1/moderation/' + action, async (req, res) => {
            limiter.check(clientIp(req));
            const b = body(req.body);
            const user = await findUserByEmail(text(b.email, 254));
            if (!user || !(await verifyPassword(password(b.password), user.passwordHash)))
                throw new HttpError(401, 'Invalid credentials.');
            // Password-confirmed access allows suspended users to appeal without minting a normal access token.
            if (action === 'notices') {
                sendJson(res, 200, { items: await rows(`SELECT jsonb_build_object('actionId',a.id,'action',a.action,'reason',a.reason,'targetType',a.target_type,'targetId',a.target_id,'createdAt',a.created_at) AS data FROM moderation_notices n JOIN moderation_actions a ON a.id=n.action_id WHERE n.user_id=:'user' ORDER BY n.created_at DESC LIMIT 20`, { user: user.id }) });
                return;
            }
            const result = await one(`WITH eligible AS(SELECT n.action_id FROM moderation_notices n JOIN moderation_actions a ON a.id=n.action_id WHERE n.user_id=:'user' AND n.action_id=:'action' AND moderation_action_appealable(a.action)),appeal AS(INSERT INTO moderation_appeals(action_id,user_id,reason) SELECT action_id,:'user',:'reason' FROM eligible ON CONFLICT(action_id,user_id) DO NOTHING RETURNING id) SELECT jsonb_build_object('accepted',EXISTS(SELECT 1 FROM eligible)) AS data`, { user: user.id, action: uuid(b.actionId), reason: text(b.reason, 1000) });
            if (!result?.accepted)
                throw new HttpError(404, 'Action not found.');
            sendJson(res, 200, result);
        });
}
