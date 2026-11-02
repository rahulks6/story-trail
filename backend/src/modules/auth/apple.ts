/**
 * Sign in with Apple, server side. The app sends the identity token Apple gave it; this checks it
 * against Apple's published keys and trades the one-time authorisation code for the refresh token
 * that deleting the account later revokes (App Review 5.1.1(v)).
 * https://developer.apple.com/documentation/sign_in_with_apple/sign_in_with_apple_rest_api
 */
import {createPrivateKey,createPublicKey,sign,verify,type JsonWebKey} from 'node:crypto';
import {HttpError} from '../../http/errors';
import {query} from '../../db/psql';
import {readPem} from '../push/providers';
import {providerConfig} from './providers';
export const APPLE_ISSUER='https://appleid.apple.com';
export interface VerifiedApple {subject:string;email:string|null;privateEmail:boolean;nonce:string;clientId:string}
/** What revoking a Sign in with Apple authorisation needs: the token and the client it was issued to. */
export interface AppleGrant {clientId:string;refreshToken:string}
/** The public key Apple signed with, by key ID (null when Apple has no such key). */
export type AppleKeys=(kid:string)=>Promise<JsonWebKey|null>;
const part=(value:string):Record<string,unknown>|null=>{try{const v:unknown=JSON.parse(Buffer.from(value,'base64url').toString('utf8'));return v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:null;}catch{return null;}};
const yes=(v:unknown)=>v===true||v==='true';
/**
 * Checks an identity token: signed RS256 by one of Apple's keys, issued by Apple to one of
 * `audiences` (the iOS bundle ID), unexpired (a minute's clock skew either way), for a subject,
 * and carrying a nonce (the SHA-256 the app passed to Apple; the caller checks it was issued and
 * is unused). The email counts only when Apple says it is verified, a private relay address
 * included. Throws on anything else.
 */
export async function verifyAppleIdentityToken(token:string,audiences:string[],keys:AppleKeys,now=Date.now()):Promise<VerifiedApple> {
 const [h,p,s,...rest]=token.split('.');if(!h||!p||!s||rest.length)throw Error('Malformed token');
 const header=part(h),claims=part(p);
 if(header?.alg!=='RS256'||typeof header.kid!=='string'||!claims)throw Error('Unsupported token');
 const jwk=await keys(header.kid);if(!jwk||jwk.kty!=='RSA'||(jwk.alg!==undefined&&jwk.alg!=='RS256'))throw Error('Unknown signing key');
 if(!verify('sha256',Buffer.from(h+'.'+p),createPublicKey({key:jwk,format:'jwk'}),Buffer.from(s,'base64url')))throw Error('Bad signature');
 const seconds=now/1000,{iss,aud,exp,iat,sub,nonce}=claims;
 if(iss!==APPLE_ISSUER)throw Error('Wrong issuer');
 if(typeof aud!=='string'||!audiences.includes(aud))throw Error('Wrong audience');
 if(typeof exp!=='number'||exp+60<seconds||typeof iat!=='number'||iat-60>seconds)throw Error('Expired');
 if(typeof sub!=='string'||!sub||sub.length>255)throw Error('No subject');
 if(typeof nonce!=='string'||!/^[a-f0-9]{64}$/.test(nonce))throw Error('No nonce');
 return {subject:sub,email:yes(claims.email_verified)&&typeof claims.email==='string'?claims.email:null,privateEmail:yes(claims.is_private_email),nonce,clientId:aud};
}
/**
 * Apple's signing keys, kept for as long as Apple's response allows (at most a day). Apple rotates
 * them: a key ID not in the list fetches it again, at most once a minute, and a failed fetch keeps
 * using the keys already known.
 */
export function appleKeyStore(url:()=>string):AppleKeys {
 let keys:JsonWebKey[]=[],freshUntil=0,lastFetch=0,pending:Promise<void>|null=null;
 const refresh=()=>pending??=(async()=>{
  try{
   lastFetch=Date.now();const r=await fetch(url(),{signal:AbortSignal.timeout(5000)});if(!r.ok)throw Error('Apple keys unavailable');
   const body=await r.json() as {keys?:unknown};if(!Array.isArray(body.keys))throw Error('Apple keys malformed');
   keys=body.keys as JsonWebKey[];freshUntil=Date.now()+Math.min(Number(/max-age=(\d+)/.exec(r.headers.get('cache-control')??'')?.[1]??3600),86400)*1000;
  }finally{pending=null;}
 })();
 return async kid=>{
  const known=()=>keys.find(k=>k.kid===kid)??null;
  if(pending)await pending.catch(()=>undefined);
  if(Date.now()>=freshUntil||(!known()&&Date.now()-lastFetch>=60000))await refresh().catch(e=>{if(!known())throw e;});
  return known();
 };
}
export const appleKeys=appleKeyStore(()=>providerConfig.appleEndpoint+'/auth/keys');
/** The client secret Apple's token endpoints take: a short-lived ES256 JWT signed with Katkee's Sign in with Apple key. */
export function appleClientSecret(clientId:string,now=Date.now()):string {
 const b64=(v:object)=>Buffer.from(JSON.stringify(v)).toString('base64url');const iat=Math.floor(now/1000);
 const input=b64({alg:'ES256',kid:providerConfig.appleKeyId})+'.'+b64({iss:providerConfig.appleTeamId,iat,exp:iat+300,aud:APPLE_ISSUER,sub:clientId});
 return input+'.'+sign('sha256',Buffer.from(input),{key:createPrivateKey(readPem(providerConfig.applePrivateKey)),dsaEncoding:'ieee-p1363'}).toString('base64url');
}
async function appleForm(path:string,form:Record<string,string>):Promise<Response> {
 try{return await fetch(providerConfig.appleEndpoint+path,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(form),signal:AbortSignal.timeout(7000)});}
 catch{throw new HttpError(503,'Sign in with Apple is unavailable. Try again later.');}
}
/** Trades the one-time authorisation code (valid five minutes) for the refresh token kept for revocation. */
export async function appleGrant(code:string,clientId:string):Promise<AppleGrant> {
 const r=await appleForm('/auth/token',{client_id:clientId,client_secret:appleClientSecret(clientId),code,grant_type:'authorization_code'});
 if(r.status===400)throw new HttpError(401,'Sign in with Apple could not be verified. Try again.');
 const body=r.ok?await r.json().catch(()=>null) as {refresh_token?:unknown}|null:null;
 if(typeof body?.refresh_token!=='string'||!body.refresh_token)throw new HttpError(503,'Sign in with Apple is unavailable. Try again later.');
 return {clientId,refreshToken:body.refresh_token};
}
/** Ends the authorisation at Apple: the person's Apple Account no longer lists Katkee. */
export async function revokeAppleGrant(grant:AppleGrant):Promise<void> {
 const r=await appleForm('/auth/revoke',{client_id:grant.clientId,client_secret:appleClientSecret(grant.clientId),token:grant.refreshToken,token_type_hint:'refresh_token'});
 if(!r.ok)throw Error('Apple revoke failed: '+r.status);
}
/** The grant a row selected with GRANT_COLUMNS holds, if any. */
export const GRANT_COLUMNS=`provider_grant->>'clientId' AS grant_client,provider_grant->>'refreshToken' AS grant_token`;
export const grantOf=(row:{grant_client?:string|null;grant_token?:string|null}|null):AppleGrant|null=>row?.grant_client&&row.grant_token?{clientId:row.grant_client,refreshToken:row.grant_token}:null;
/** Revokes a grant without failing the caller: an account change goes ahead even if Apple is unreachable. */
export async function revokeQuietly(grant:AppleGrant|null):Promise<boolean> {
 if(!grant)return false;
 try{await revokeAppleGrant(grant);return true;}catch(e){console.warn(JSON.stringify({event:'apple_revoke_failed',error:e instanceof Error?e.message:'unknown'}));return false;}
}
/**
 * Revokes every Sign in with Apple authorisation an account holds (deleting it). A grant Apple
 * accepted is cleared; one it didn't is kept for the 30-day account scrub to try again
 * (media/retention.ts).
 */
export async function revokeAppleGrants(userId:string):Promise<void> {
 for(const row of await query(`SELECT id,${GRANT_COLUMNS} FROM auth_identities WHERE user_id=:'user' AND provider='APPLE' AND provider_grant IS NOT NULL`,{user:userId}))
  if(await revokeQuietly(grantOf(row)))await query(`UPDATE auth_identities SET provider_grant=NULL WHERE id=:'id'`,{id:row.id!});
}
