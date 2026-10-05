import type {Router} from '../../http/router';
import {sendJson} from '../../http/respond';
import {requireAuth} from '../../http/middleware/auth.middleware';
import {HttpError} from '../../http/errors';
import {RateLimiter,clientIp} from '../../http/rateLimiter';
import {query,queryOne,DatabaseError} from '../../db/psql';
import {body,text,password} from '../admin/policy';
import {findUserById} from '../users/users.repository';
import {verifyPassword} from './password';
import {liveProviders,providerConfig,normalizePhone,type ProviderGateway} from './providers';
import * as identity from './provider.service';
const authLimit=new RateLimiter(15*60000,30);
function available(provider:'GOOGLE'|'PHONE'){if(!(provider==='GOOGLE'?providerConfig.googleEnabled:providerConfig.phoneEnabled))throw new HttpError(404,'Sign-in method unavailable.');}
export function registerProviderAuthRoutes(router:Router,providers:ProviderGateway=liveProviders):void {
 router.get('/api/v1/auth/methods',(_req,res)=>sendJson(res,200,{google:providerConfig.googleEnabled,phone:providerConfig.phoneEnabled,countries:providerConfig.phoneEnabled?providerConfig.countries:[],codeLength:providerConfig.codeLength}));
 router.post('/api/v1/auth/google',async(req,res)=>{
  available('GOOGLE');authLimit.check(clientIp(req));const b=body(req.body);const verified=await providers.google(text(b.idToken,12000));const proof=await identity.googleProof(verified);
  sendJson(res,200,b.proofOnly===true?{proof,expiresIn:300}:await identity.resultFor(proof,{ip:clientIp(req),userAgent:req.headers['user-agent']??null}));
 });
 router.post('/api/v1/auth/provider/complete',async(req,res)=>{authLimit.check(clientIp(req));const b=body(req.body);sendJson(res,200,await identity.complete(text(b.proof,64),b.username,b.displayName,{ip:clientIp(req),userAgent:req.headers['user-agent']??null}));});
 router.post('/api/v1/auth/phone/request',async(req,res)=>{
  available('PHONE');authLimit.check(clientIp(req));const b=body(req.body);const phone=normalizePhone(b.phone,b.country),challenge=identity.opaque();const phoneKey=identity.phoneHash(phone),mask='•••• '+phone.slice(-4);
  let row;
  try{row=await queryOne(`SELECT reserve_phone_challenge(:'token',:'phone',:'ip',:'mask',:'max') AS id`,{token:identity.hash(challenge),phone:phoneKey,ip:identity.phoneHash(clientIp(req)),mask,max:providerConfig.dailyLimit});}catch(e){if(e instanceof DatabaseError&&e.detail.includes('OTP_LIMIT'))throw new HttpError(429,'Please wait before requesting another code.');throw e;}
  try{const sid=await providers.sendPhone(phone);await query(`UPDATE auth_phone_challenges SET provider_sid=:'sid',status='PENDING' WHERE id=:'id'`,{sid,id:row!.id!});}
  catch(e){await query(`UPDATE auth_phone_challenges SET status='FAILED' WHERE id=:'id'`,{id:row!.id!});console.warn(JSON.stringify({event:'otp_request_failed'}));throw e;}
  console.info(JSON.stringify({event:'otp_requested'}));sendJson(res,200,{challenge,maskedDestination:mask,resendAfter:60,expiresIn:600,codeLength:providerConfig.codeLength});
 });
 router.post('/api/v1/auth/phone/verify',async(req,res)=>{
  available('PHONE');authLimit.check(clientIp(req));const b=body(req.body);const challenge=identity.proofToken(b.challenge);
  if(typeof b.code!=='string'||!new RegExp(`^[0-9]{${providerConfig.codeLength}}$`).test(b.code))throw new HttpError(422,'Enter the verification code.');
  const claimed=await queryOne(`UPDATE auth_phone_challenges SET status='CHECKING',attempts=attempts+1 WHERE token_hash=:'hash' AND status='PENDING' AND expires_at>now() AND attempts<5 RETURNING provider_sid,phone_hash`,{hash:challenge});
  if(!claimed)throw new HttpError(401,'Code expired, already used, or temporarily unavailable. Request a new code.');
  let approved=false;
  try{approved=await providers.checkPhone(claimed.provider_sid!,b.code);}catch(e){await query(`UPDATE auth_phone_challenges SET status=CASE WHEN attempts>=5 THEN 'FAILED' ELSE 'PENDING' END WHERE token_hash=:'hash' AND status='CHECKING'`,{hash:challenge});throw e;}
  if(!approved){await query(`UPDATE auth_phone_challenges SET status=CASE WHEN attempts>=5 THEN 'FAILED' ELSE 'PENDING' END WHERE token_hash=:'hash' AND status='CHECKING'`,{hash:challenge});console.info(JSON.stringify({event:'otp_failed'}));throw new HttpError(401,'Incorrect or expired code. Try again or request a new code.');}
  const proof=identity.opaque();const result=await queryOne(`WITH c AS(UPDATE auth_phone_challenges SET status='VERIFIED' WHERE token_hash=:'challenge' AND status='CHECKING' AND expires_at>now() RETURNING phone_hash),p AS(INSERT INTO auth_provider_proofs(token_hash,provider,subject) SELECT :'proof','PHONE',phone_hash FROM c RETURNING token_hash) SELECT token_hash FROM p`,{challenge,proof:identity.hash(proof)});
  if(!result)throw new HttpError(401,'Verification expired.');console.info(JSON.stringify({event:'otp_verified'}));sendJson(res,200,b.proofOnly===true?{proof,expiresIn:300}:await identity.resultFor(proof,{ip:clientIp(req),userAgent:req.headers['user-agent']??null}));
 });
 router.post('/api/v1/auth/reauthenticate',async(req,res)=>{requireAuth(req);authLimit.check(req.userId!);const b=body(req.body);const user=await findUserById(req.userId!);if(!user||!await verifyPassword(password(b.password),user.passwordHash))throw new HttpError(401,'Reauthentication failed.');sendJson(res,200,await identity.reauthTicket(user.id));});
 router.post('/api/v1/auth/provider/reauthenticate',async(req,res)=>{requireAuth(req);authLimit.check(req.userId!);const b=body(req.body);const row=await queryOne(`UPDATE auth_provider_proofs p SET consumed_at=now() WHERE token_hash=:'hash' AND consumed_at IS NULL AND expires_at>now() AND EXISTS(SELECT 1 FROM auth_identities i WHERE i.user_id=:'user' AND i.provider=p.provider AND i.subject=p.subject) RETURNING token_hash`,{hash:identity.proofToken(b.proof),user:req.userId!});if(!row)throw new HttpError(401,'Verify a provider already linked to this account.');sendJson(res,200,await identity.reauthTicket(req.userId!));});
 router.get('/api/v1/auth/identities',async(req,res)=>{requireAuth(req);const items=await query(`SELECT provider,verified_at FROM auth_identities WHERE user_id=:'user' ORDER BY provider`,{user:req.userId!});const u=await findUserById(req.userId!);sendJson(res,200,{items,hasPassword:!!u?.passwordHash});});
 for(const action of ['link','unlink'])router.post('/api/v1/auth/provider/'+action,async(req,res)=>{
  requireAuth(req);authLimit.check(req.userId!);const b=body(req.body);if(b.confirmed!==true)throw new HttpError(422,'Confirm this account change.');
  const unlink=action==='unlink'?text(b.provider,10):'';if(unlink&&!['GOOGLE','PHONE'].includes(unlink))throw new HttpError(422,'Invalid provider.');
  try{await query(`SELECT change_auth_identity(:'user',:'ticket',:'proof',:'unlink')`,{user:req.userId!,ticket:identity.proofToken(b.reauthTicket),proof:action==='link'?identity.proofToken(b.proof):'',unlink});}catch(e){identity.identityError(e);}
  console.info(JSON.stringify({event:action==='link'?'auth_account_linked':'auth_account_unlinked'}));sendJson(res,204,undefined);
 });
 router.post('/api/v1/auth/account/delete',async(req,res)=>{
  requireAuth(req);authLimit.check(req.userId!);const b=body(req.body);if(b.confirmed!==true)throw new HttpError(422,'Confirm account deletion.');
  const result=await queryOne(`WITH ticket AS(UPDATE auth_reauth_tickets SET consumed_at=now() WHERE token_hash=:'ticket' AND user_id=:'user' AND consumed_at IS NULL AND expires_at>now() RETURNING user_id),u AS(UPDATE users SET deleted_at=now(),is_active=false WHERE id IN(SELECT user_id FROM ticket) RETURNING id),tokens AS(UPDATE refresh_tokens SET revoked_at=now() WHERE user_id IN(SELECT id FROM u)),admin AS(DELETE FROM admin_sessions WHERE user_id IN(SELECT id FROM u)) SELECT id FROM u`,{ticket:identity.proofToken(b.reauthTicket),user:req.userId!});
  if(!result)throw new HttpError(401,'Reauthenticate before deleting your account.');sendJson(res,204,undefined);
 });
}
