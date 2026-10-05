import {createHash,createHmac,randomBytes} from 'node:crypto';
import {query,queryOne,DatabaseError,nullable} from '../../db/psql';
import {HttpError} from '../../http/errors';
import {getPublicUserById,issueTokenPair} from './auth.service';
import {providerConfig,type VerifiedGoogle} from './providers';
export const opaque=()=>randomBytes(32).toString('hex');
export const hash=(v:string)=>createHash('sha256').update(v).digest('hex');
export const phoneHash=(v:string)=>createHmac('sha256',providerConfig.phoneSecret).update(v).digest('hex');
export function proofToken(v:unknown):string {if(typeof v!=='string'||! /^[a-f0-9]{64}$/.test(v))throw new HttpError(401,'Verification expired. Please try again.');return hash(v);}
export async function googleProof(identity:VerifiedGoogle):Promise<string> {
 const token=opaque();await query(`INSERT INTO auth_provider_proofs(token_hash,provider,subject,verified_email,display_name) VALUES(:'hash','GOOGLE',:'subject',${nullable('email','citext')},:'name')`,{hash:hash(token),subject:identity.subject,email:identity.email,name:identity.displayName});return token;
}
export function identityError(e:unknown):never {
 if(e instanceof DatabaseError){
  if(e.detail.includes('LINK_REQUIRED'))throw new HttpError(409,'Sign in with your existing method, then link this provider in Account settings.');
  if(e.detail.includes('USERNAME_REQUIRED'))throw new HttpError(422,'Choose a username to finish creating your account.');
  if(e.detail.includes('LAST_METHOD'))throw new HttpError(409,'Keep at least one usable sign-in method.');
  if(/IDENTITY_IN_USE|PROVIDER_ALREADY_LINKED/.test(e.detail))throw new HttpError(409,'This identity cannot be linked. Use the existing sign-in or account recovery.');
  if(/unique constraint|users_username_format/.test(e.detail))throw new HttpError(409,'Choose another username or sign in to your existing account.');
  if(/INVALID_PROOF|REAUTH_REQUIRED/.test(e.detail))throw new HttpError(401,'Verification expired. Please verify again.');
  if(e.detail.includes('ACCOUNT_UNAVAILABLE'))throw new HttpError(403,'Account unavailable.');
 }
 throw e;
}
export async function complete(proof:string,username:unknown,name:unknown,userAgent:string|null){
 if(username!==undefined&&(typeof username!=='string'||!/^[a-z0-9_.]{3,30}$/.test(username)||['admin','katkee','support','moderator','superadmin'].includes(username)))throw new HttpError(422,'Choose a valid available username (3–30 letters, numbers, dots or underscores).');
 if(name!==undefined&&(typeof name!=='string'||name.length>60))throw new HttpError(422,'Display name must be at most 60 characters.');
 try{
  const row=await queryOne(`SELECT complete_provider_proof(:'hash',:'username',:'name') AS id`,{hash:proofToken(proof),username:typeof username==='string'?username:'',name:typeof name==='string'?name:''});
  if(!row?.id)throw new HttpError(401,'Verification expired.');
  const user=await getPublicUserById(row.id);const tokens=await issueTokenPair(row.id,userAgent);console.info(JSON.stringify({event:'provider_login_succeeded'}));return {user,tokens};
 }catch(e){identityError(e);}
}
export async function resultFor(proof:string,userAgent:string|null){
 const row=await queryOne(`SELECT i.user_id FROM auth_provider_proofs p JOIN auth_identities i ON i.provider=p.provider AND i.subject=p.subject WHERE p.token_hash=:'hash'`,{hash:hash(proof)});
 if(row)return complete(proof,undefined,undefined,userAgent);
 return {onboardingRequired:true as const,proof,expiresIn:300};
}
export async function reauthTicket(userId:string){const ticket=opaque();await query(`INSERT INTO auth_reauth_tickets(token_hash,user_id) VALUES(:'hash',:'user')`,{hash:hash(ticket),user:userId});return {reauthTicket:ticket,expiresIn:300};}
