// Sign in with Apple (src/modules/auth/apple.ts). Identity tokens are signed here with locally
// generated RSA keys and served from a local stand-in for appleid.apple.com, which also checks
// the ES256 client secret on its token and revoke endpoints. Everything else is real: the
// verification code, HTTP routes, SQL, identities, linking, age check and sessions.
import './provider-env';
process.env.TRUSTED_PROXY_IPS='127.0.0.1';
import {before,after,describe,it} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,createPublicKey,generateKeyPairSync,randomUUID,sign,verify,type JsonWebKey,type KeyObject} from 'node:crypto';
import {createServer,type Server} from 'node:http';
import type {AddressInfo} from 'node:net';
import {buildApp} from '../src/app';
import {query,queryOne} from '../src/db/psql';
import {HttpError} from '../src/http/errors';
import {liveProviders,providerConfig} from '../src/modules/auth/providers';
import {appleClientSecret,appleKeyStore,verifyAppleIdentityToken,type AppleKeys} from '../src/modules/auth/apple';

const tag=randomUUID().slice(0,8),BUNDLE='com.katkee.app';
const appleKey=generateKeyPairSync('rsa',{modulusLength:2048}),otherKey=generateKeyPairSync('rsa',{modulusLength:2048});
const jwk:JsonWebKey={...appleKey.publicKey.export({format:'jwk'}),kid:'apple-test-1',alg:'RS256',use:'sig'};
const b64=(v:object)=>Buffer.from(JSON.stringify(v)).toString('base64url');
const sha256=(v:string)=>createHash('sha256').update(v).digest('hex');
/** An identity token as Apple issues it; `claims` and `header` override the defaults. */
function identityToken(claims:Record<string,unknown>={},header:Record<string,unknown>={},key:KeyObject=appleKey.privateKey):string {
 const now=Math.floor(Date.now()/1000);
 const input=b64({alg:'RS256',kid:'apple-test-1',...header})+'.'+b64({iss:'https://appleid.apple.com',aud:BUNDLE,iat:now,exp:now+600,sub:'001234.'+tag,nonce:sha256('n'),email:`relay-${tag}@privaterelay.appleid.com`,email_verified:'true',is_private_email:'true',...claims});
 return input+'.'+sign('sha256',Buffer.from(input),key).toString('base64url');
}
const keys:AppleKeys=async kid=>kid===jwk.kid?jwk:null;

// The stand-in for appleid.apple.com.
const apple={keyFetches:0,issued:[] as string[],revoked:[] as string[]};
const clientSecretKey=createPublicKey(process.env.APPLE_PRIVATE_KEY!);
function secretValid(secret:string,clientId:string):boolean {
 const [h,p,s]=secret.split('.');if(!h||!p||!s)return false;
 const header=JSON.parse(Buffer.from(h,'base64url').toString()),claims=JSON.parse(Buffer.from(p,'base64url').toString());
 return header.alg==='ES256'&&header.kid==='KEY1234567'&&claims.iss==='TEAM123456'&&claims.sub===clientId&&claims.aud==='https://appleid.apple.com'&&claims.exp>Date.now()/1000
  &&verify('sha256',Buffer.from(h+'.'+p),{key:clientSecretKey,dsaEncoding:'ieee-p1363'},Buffer.from(s,'base64url'));
}
const appleServer:Server=createServer((req,res)=>{
 let raw='';req.on('data',c=>raw+=c);req.on('end',()=>{
  const form=new URLSearchParams(raw),reply=(status:number,body:object,headers:Record<string,string>={})=>{res.writeHead(status,{'Content-Type':'application/json',...headers});res.end(JSON.stringify(body));};
  if(req.url==='/auth/keys'){apple.keyFetches++;return reply(200,{keys:[jwk]},{'Cache-Control':'max-age=600'});}
  if(!secretValid(form.get('client_secret')??'',form.get('client_id')??''))return reply(401,{error:'invalid_client'});
  if(req.url==='/auth/token'){
   if(form.get('grant_type')!=='authorization_code'||!form.get('code')?.startsWith('code-'))return reply(400,{error:'invalid_grant'});
   const refresh='refresh-'+form.get('code');apple.issued.push(refresh);return reply(200,{access_token:'a',token_type:'Bearer',expires_in:3600,refresh_token:refresh,id_token:'x'});
  }
  if(req.url==='/auth/revoke'&&form.get('token_type_hint')==='refresh_token'){apple.revoked.push(form.get('token')!);return reply(200,{});}
  reply(404,{});
 });
});
const server=buildApp({async google(token){if(!token.startsWith('verified-'))throw new HttpError(401,'Invalid test assertion');return {subject:token+'-'+tag,email:null,displayName:''};},apple:liveProviders.apple,async sendPhone(){return 'VE'+'3'.repeat(32);},async checkPhone(){return false;}});
let base:string;
before(async()=>{
 await new Promise<void>(r=>appleServer.listen(0,'127.0.0.1',r));providerConfig.appleEndpoint=`http://127.0.0.1:${(appleServer.address() as AddressInfo).port}`;
 await new Promise<void>(r=>server.listen(0,r));base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(()=>Promise.all([new Promise<void>(r=>server.close(()=>r())),new Promise<void>(r=>appleServer.close(()=>r()))]));
// Each test signs in from its own address: sign-in routes allow 30 attempts per address.
let address=0;
async function req(path:string,data?:unknown,token?:string,ip=`198.51.100.${address}`){const r=await fetch(base+'/api/v1/'+path,{method:data===undefined?'GET':'POST',headers:{'Content-Type':'application/json','X-Forwarded-For':ip,...(token?{Authorization:'Bearer '+token}:{})},...(data===undefined?{}:{body:JSON.stringify(data)})});return {status:r.status,body:r.status===204?null:await r.json() as any};}
/** The app's side: a nonce from the API, a token from "Apple" carrying its hash, then sign-in. */
async function signIn(claims:Record<string,unknown>={},extra:Record<string,unknown>={},code='code-'+randomUUID()){
 const nonce=await req('auth/apple/nonce',{});assert.equal(nonce.status,200,JSON.stringify(nonce.body));
 return req('auth/apple',{identityToken:identityToken({nonce:sha256(nonce.body.nonce),...claims}),authorizationCode:code,...extra});
}

describe('identity token verification',()=>{
 it('accepts a token Apple signed for this app, with its verified (relay) email',async()=>{
  const v=await verifyAppleIdentityToken(identityToken(),[BUNDLE],keys);
  assert.deepEqual(v,{subject:'001234.'+tag,email:`relay-${tag}@privaterelay.appleid.com`,privateEmail:true,nonce:sha256('n'),clientId:BUNDLE});
  // Boolean claims as well as Apple's "true" strings; an unverified email is not used.
  assert.equal((await verifyAppleIdentityToken(identityToken({email_verified:true,is_private_email:false}),[BUNDLE],keys)).privateEmail,false);
  assert.equal((await verifyAppleIdentityToken(identityToken({email_verified:'false'}),[BUNDLE],keys)).email,null);
  assert.equal((await verifyAppleIdentityToken(identityToken({email:undefined,email_verified:undefined}),[BUNDLE],keys)).email,null);
 });
 it('refuses a wrong signature, key, algorithm, issuer, audience, expiry, subject or nonce',async()=>{
  const now=Math.floor(Date.now()/1000);
  const bad:Array<[string,string]>=[
   ['signed by another key',identityToken({},{},otherKey.privateKey)],
   ['unknown key ID',identityToken({},{kid:'retired'})],
   ['HS256',identityToken({},{alg:'HS256'})],
   ['unsigned',b64({alg:'none'})+'.'+b64({iss:'https://appleid.apple.com',aud:BUNDLE,sub:'x',exp:now+60,iat:now,nonce:sha256('n')})+'.'],
   ['another issuer',identityToken({iss:'https://accounts.google.com'})],
   ['another app',identityToken({aud:'com.example.other'})],
   ['audience list',identityToken({aud:[BUNDLE]})],
   ['expired',identityToken({exp:now-120,iat:now-720})],
   ['issued in the future',identityToken({iat:now+600,exp:now+1200})],
   ['no subject',identityToken({sub:''})],
   ['no nonce',identityToken({nonce:undefined})],
   ['raw nonce, not its hash',identityToken({nonce:'n'})],
   ['payload changed after signing',(()=>{const [h,,s]=identityToken().split('.');return h+'.'+b64({iss:'https://appleid.apple.com',aud:BUNDLE,sub:'someone-else',exp:now+60,iat:now,nonce:sha256('n')})+'.'+s;})()],
   ['not a JWT','abc.def'],
  ];
  for(const [name,token] of bad)await assert.rejects(verifyAppleIdentityToken(token,[BUNDLE],keys),name);
 });
 it('caches Apple\'s keys and refetches for a new key ID at most once a minute',async()=>{
  const before=apple.keyFetches,store=appleKeyStore(()=>providerConfig.appleEndpoint+'/auth/keys');
  assert.equal((await store('apple-test-1'))?.kid,'apple-test-1');
  assert.equal(await store('apple-test-1')!==null,true);
  assert.equal(await store('rotated-in'),null);assert.equal(await store('rotated-in'),null);
  assert.equal(apple.keyFetches-before,1);
 });
 it('signs the client secret Apple\'s token endpoints expect',()=>{assert.ok(secretValid(appleClientSecret(BUNDLE),BUNDLE));});
});

describe('signing in',()=>{
 it('creates an account with the relay email verified, signs the same person in again, and keeps the grant',async()=>{
  address=1;
  assert.equal((await req('auth/methods')).body.apple,true);
  const pending=await signIn({},{},'code-new');assert.equal(pending.status,200,JSON.stringify(pending.body));assert.equal(pending.body.onboardingRequired,true);
  // Apple sends the name only the first time; the app offers it as the display name.
  const created=await req('auth/provider/complete',{proof:pending.body.proof,username:'apple_'+tag,displayName:'Asha Rao',birthDate:'1995-05-15'});assert.equal(created.status,200,JSON.stringify(created.body));
  assert.equal(created.body.user.email,`relay-${tag}@privaterelay.appleid.com`);assert.equal(created.body.user.emailVerified,true);assert.equal(created.body.user.displayName,'Asha Rao');
  const identity=await queryOne(`SELECT provider_grant->>'refreshToken' AS refresh,provider_grant->>'clientId' AS client FROM auth_identities WHERE user_id=:'id' AND provider='APPLE'`,{id:created.body.user.id});
  assert.deepEqual({...identity},{refresh:'refresh-code-new',client:BUNDLE});
  assert.equal((await queryOne(`SELECT count(*) AS n FROM auth_provider_proofs WHERE provider_grant IS NOT NULL AND subject=:'s'`,{s:'001234.'+tag}))?.n,'0');
  // Returning: no username or date of birth, the same account, the newest grant.
  const again=await signIn({email_verified:undefined,email:undefined},{},'code-again');assert.equal(again.status,200,JSON.stringify(again.body));assert.equal(again.body.user.id,created.body.user.id);
  assert.equal((await queryOne(`SELECT provider_grant->>'refreshToken' AS refresh FROM auth_identities WHERE user_id=:'id'`,{id:created.body.user.id}))?.refresh,'refresh-code-again');
 });
 it('uses each nonce once, only ones the API issued, and refuses a bad code',async()=>{
  address=2;
  const nonce=await req('auth/apple/nonce',{});const token=identityToken({sub:'nonce.'+tag,nonce:sha256(nonce.body.nonce)});
  assert.equal((await req('auth/apple',{identityToken:token,authorizationCode:'code-1'})).status,200);
  assert.equal((await req('auth/apple',{identityToken:token,authorizationCode:'code-2'})).status,401,'replayed token');
  assert.equal((await req('auth/apple',{identityToken:identityToken({sub:'nonce.'+tag,nonce:sha256('never-issued')}),authorizationCode:'code-3'})).status,401);
  assert.equal((await signIn({sub:'nonce.'+tag},{},'not-a-code')).status,401,'Apple refused the code');
  assert.equal((await signIn({sub:'nonce.'+tag},{authorizationCode:undefined})).status,422);
  assert.equal((await req('auth/apple',{identityToken:identityToken({},{},otherKey.privateKey),authorizationCode:'code-4'})).status,401);
 });
 it('never merges into an existing account by email: the person links Apple from that account',async()=>{
  address=3;
  const email=`apple-owner-${tag}@example.com`;
  const owner=await req('auth/signup',{email,username:'owner_'+tag,password:'correcthorsebattery',displayName:'Owner',birthDate:'1995-05-15'});assert.equal(owner.status,201);
  const collision=await signIn({sub:'link.'+tag,email,is_private_email:'false'});
  assert.equal((await req('auth/provider/complete',{proof:collision.body.proof,username:'dupe_'+tag,birthDate:'1995-05-15'})).status,409);
  const token=owner.body.tokens.accessToken;
  const reauth=await req('auth/reauthenticate',{password:'correcthorsebattery'},token);
  const proof=await signIn({sub:'link.'+tag,email,is_private_email:'false'},{proofOnly:true},'code-link');assert.ok(proof.body.proof&&!proof.body.user);
  assert.equal((await req('auth/provider/link',{proof:proof.body.proof,reauthTicket:reauth.body.reauthTicket,confirmed:true},token)).status,204);
  const signedIn=await signIn({sub:'link.'+tag,email,is_private_email:'false'});assert.equal(signedIn.body.user.id,owner.body.user.id);
  // Unlinking ends the authorisation at Apple too.
  const ticket=await req('auth/reauthenticate',{password:'correcthorsebattery'},signedIn.body.tokens.accessToken);
  const latest=(await queryOne(`SELECT provider_grant->>'refreshToken' AS r FROM auth_identities WHERE user_id=:'id' AND provider='APPLE'`,{id:owner.body.user.id}))!.r!;
  assert.equal((await req('auth/provider/unlink',{provider:'APPLE',reauthTicket:ticket.body.reauthTicket,confirmed:true},signedIn.body.tokens.accessToken)).status,204);
  assert.ok(apple.revoked.includes(latest));
  assert.equal((await queryOne(`SELECT count(*) AS n FROM auth_identities WHERE user_id=:'id'`,{id:owner.body.user.id}))?.n,'0');
 });
 it('deleting an Apple-only account revokes it at Apple; someone under 18 is revoked and forgotten',async()=>{
  address=4;
  const pending=await signIn({sub:'delete.'+tag,email:undefined},{},'code-delete');
  const created=await req('auth/provider/complete',{proof:pending.body.proof,username:'appledel_'+tag,birthDate:'1995-05-15'});assert.equal(created.status,200);
  assert.equal(created.body.user.email,null);
  const proof=await signIn({sub:'delete.'+tag,email:undefined},{proofOnly:true},'code-reauth');
  const ticket=await req('auth/provider/reauthenticate',{proof:proof.body.proof},created.body.tokens.accessToken);assert.equal(ticket.status,200);
  assert.equal((await req('auth/account/delete',{reauthTicket:ticket.body.reauthTicket,confirmed:true},created.body.tokens.accessToken)).status,204);
  assert.ok(apple.revoked.includes('refresh-code-reauth'));
  assert.equal((await queryOne(`SELECT provider_grant FROM auth_identities WHERE user_id=:'id'`,{id:created.body.user.id}))?.provider_grant,null);
  // The deleted identity can't make a new account.
  assert.equal((await signIn({sub:'delete.'+tag,email:undefined})).status,403);

  const young=await signIn({sub:'young.'+tag,email:undefined},{},'code-young');
  const year=new Date().getUTCFullYear();
  assert.equal((await req('auth/provider/complete',{proof:young.body.proof,username:'young_'+tag,birthDate:`${year-12}-01-01`})).status,422);
  assert.ok(apple.revoked.includes('refresh-code-young'));
  assert.equal((await queryOne(`SELECT count(*) AS n FROM auth_provider_proofs WHERE subject=:'s'`,{s:'young.'+tag}))?.n,'0');
 });
 it('is unavailable while turned off',async()=>{
  address=5;providerConfig.appleEnabled=false;
  try{
   assert.equal((await req('auth/methods')).body.apple,false);
   assert.equal((await req('auth/apple/nonce',{})).status,404);
   assert.equal((await req('auth/apple',{identityToken:identityToken(),authorizationCode:'code-off'})).status,404);
  }finally{providerConfig.appleEnabled=true;}
 });
});
