import './provider-env';
import {before,after,it} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type {AddressInfo} from 'node:net';
import {buildApp} from '../src/app';
import {query,queryOne} from '../src/db/psql';
import {HttpError} from '../src/http/errors';
import {liveProviders} from '../src/modules/auth/providers';
let sends=0;const tag=randomUUID().slice(0,8);
// Only the remote gateway is a test double. All HTTP, SQL, uniqueness, and session behavior is real.
const server=buildApp({async google(token){if(!token.startsWith('verified-'))throw new HttpError(401,'Invalid test assertion');return {subject:token+'-'+tag,email:token==='verified-collision'?`collision-${tag}@example.com`:null,displayName:'Provider test'};},async sendPhone(){sends++;return 'VE'+'3'.repeat(32);},async checkPhone(_sid,code){return code==='246810';}});
let base:string;
before(async()=>{await new Promise<void>(r=>server.listen(0,r));base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;});after(()=>new Promise<void>(r=>server.close(()=>r())));
async function req(path:string,data?:unknown,token?:string,method='POST'){const r=await fetch(base+'/api/v1/auth/'+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(data===undefined?{}:{body:JSON.stringify(data)})});return {status:r.status,body:r.status===204?null:await r.json() as any};}
it('Google creates one canonical user, safely rejects collisions/replay, and enforces account state',async()=>{
 assert.equal((await req('google',{idToken:'forged'})).status,401);
 await assert.rejects(liveProviders.google('not-a-token'));
 const pending=await req('google',{idToken:'verified-new'});assert.equal(pending.body.onboardingRequired,true);
 assert.equal((await req('provider/complete',{proof:pending.body.proof,username:'admin'})).status,422);
 const created=await req('provider/complete',{proof:pending.body.proof,username:'provider_'+tag});assert.equal(created.status,200,JSON.stringify(created.body));
 assert.equal(created.body.user.email,null);const id=created.body.user.id;
 assert.equal((await req('provider/complete',{proof:pending.body.proof,username:'another_'+tag})).status,401);
 const returning=await req('google',{idToken:'verified-new'});assert.equal(returning.body.user.id,id);
 await query(`UPDATE users SET is_active=false,moderation_state='SUSPENDED' WHERE id=:'id'`,{id});
 assert.equal((await req('google',{idToken:'verified-new'})).status,403);
 const existing=await req('signup',{email:`collision-${tag}@example.com`,username:'collision_'+tag,password:'correcthorsebattery',displayName:'Existing'});assert.equal(existing.status,201);
 const collision=await req('google',{idToken:'verified-collision'});const complete=await req('provider/complete',{proof:collision.body.proof,username:'collision2_'+tag});assert.equal(complete.status,409);
 const row=await queryOne(`SELECT count(*) AS n FROM users WHERE email=:'email'`,{email:`collision-${tag}@example.com`});assert.equal(row?.n,'1');
});
it('Phone verification enforces cooldown, attempts, single-use challenges, and private identities',async()=>{
 const sent=await req('phone/request',{phone:'2025550123',country:'US'});assert.equal(sent.status,200,JSON.stringify(sent.body));assert.equal(sends,1);assert.equal(sent.body.maskedDestination,'•••• 0123');
 assert.equal((await req('phone/request',{phone:'+12025550123',country:'US'})).status,429);
 assert.equal((await req('phone/verify',{challenge:sent.body.challenge,code:'000000'})).status,401);
 const approved=await req('phone/verify',{challenge:sent.body.challenge,code:'246810'});assert.equal(approved.status,200);
 assert.equal((await req('phone/verify',{challenge:sent.body.challenge,code:'246810'})).status,401);
 const created=await req('provider/complete',{proof:approved.body.proof,username:'phone_'+tag});assert.equal(created.status,200,JSON.stringify(created.body));assert.ok(!JSON.stringify(created.body.user).includes('2025550123'));
 const proof=await queryOne(`SELECT subject FROM auth_identities WHERE user_id=:'id'`,{id:created.body.user.id});assert.match(proof!.subject!,/^[a-f0-9]{64}$/);
});
it('Linking requires recent ownership proof, preserves the user, and cannot remove the last method',async()=>{
 const owner=await req('signup',{email:`link-${tag}@example.com`,username:'link_'+tag,password:'correcthorsebattery',displayName:'Existing'});const token=owner.body.tokens.accessToken;
 const proof=await req('google',{idToken:'verified-link',proofOnly:true});
 assert.equal((await req('provider/link',{proof:proof.body.proof,reauthTicket:'0'.repeat(64),confirmed:true},token)).status,401);
 const reauth=await req('reauthenticate',{password:'correcthorsebattery'},token);
 assert.equal((await req('provider/link',{proof:proof.body.proof,reauthTicket:reauth.body.reauthTicket,confirmed:true},token)).status,204);
 const same=await req('google',{idToken:'verified-link'});assert.equal(same.body.user.id,owner.body.user.id);
 const credential=await req('google',{idToken:'verified-link',proofOnly:true});const ticket=await req('provider/reauthenticate',{proof:credential.body.proof},same.body.tokens.accessToken);assert.equal(ticket.status,200);
 await query(`UPDATE users SET password_hash=NULL WHERE id=:'id'`,{id:owner.body.user.id});
 assert.equal((await req('provider/unlink',{provider:'GOOGLE',reauthTicket:ticket.body.reauthTicket,confirmed:true},same.body.tokens.accessToken)).status,409);
 assert.equal((await req('account/delete',{reauthTicket:ticket.body.reauthTicket,confirmed:true},same.body.tokens.accessToken)).status,204);
 assert.equal((await req('google',{idToken:'verified-link'})).status,403);
});
