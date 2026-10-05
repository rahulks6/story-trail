// Realtime client (mobile/src/realtime/realtimeClient.ts) against a scripted WebSocket and clock.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const ts=require('../backend/node_modules/typescript');
const code=ts.transpileModule(fs.readFileSync(path.join(__dirname,'../mobile/src/realtime/realtimeClient.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const settle=async()=>{for(let i=0;i<10;i++)await new Promise(r=>setImmediate(r));};
const plain=v=>JSON.parse(JSON.stringify(v));

function clock(){
 let t=0,seq=0;const timers=new Map();
 return {setTimeout:(fn,ms)=>{const id=++seq;timers.set(id,{at:t+ms,fn});return id;},clearTimeout:id=>{timers.delete(id);},
  delays:()=>[...timers.values()].map(x=>x.at-t).sort((a,b)=>a-b),
  async advance(ms){const end=t+ms;for(;;){const next=[...timers.entries()].sort((a,b)=>a[1].at-b[1].at)[0];if(!next||next[1].at>end)break;t=next[1].at;timers.delete(next[0]);next[1].fn();await settle();}t=end;await settle();}};
}

function fixture(opts={}){
 const c=clock(),sockets=[],events=[],statuses=[];let tickets=0,signedOut=0;
 const ticketScript=[...(opts.tickets??[])];
 class FakeSocket{constructor(url){this.url=url;this.readyState=0;this.sent=[];this.closedWith=null;sockets.push(this);}
  send(d){this.sent.push(d);}close(code,reason){this.closedWith={code,reason};this.readyState=3;}
  open(){this.readyState=1;this.onopen?.({});}
  hello(){this.receive({type:'hello',userId:'u',serverTime:'',expiresAt:''});}
  receive(e){this.onmessage?.({data:typeof e==='string'?e:JSON.stringify(e)});}
  drop(code=1006){this.readyState=3;this.onclose?.({code});}}
 const module={exports:{}};vm.runInNewContext(code,{module,exports:module.exports,setTimeout,clearTimeout,Math,JSON},{filename:'realtimeClient.ts'});
 const {RealtimeClient,backoffMs,realtimeUrl}=module.exports;
 const client=new RealtimeClient({baseUrl:opts.baseUrl??'https://api.katkee.test/',
  createTicket:async()=>{tickets++;const step=ticketScript.shift();if(step instanceof Error)throw step;return 'a'.repeat(63)+(tickets%10);},
  onEvent:e=>events.push(plain(e)),onStatus:s=>statuses.push(s),onSignedOut:()=>signedOut++,
  connect:url=>new FakeSocket(url),timers:c,random:()=>1});
 return {client,clock:c,sockets,events,statuses,get tickets(){return tickets;},get signedOut(){return signedOut;},backoffMs,realtimeUrl,last:()=>sockets[sockets.length-1]};
}
const authError=()=>Object.assign(new Error('Please sign in again.'),{status:401});

test('connects over wss with a single-use ticket and resyncs on every (re)connect',async()=>{
 const f=fixture();f.client.start();f.client.start();await settle();
 assert.equal(f.sockets.length,1,'one connection however often start() is called');
 assert.equal(f.last().url,'wss://api.katkee.test/api/v1/realtime?ticket='+'a'.repeat(63)+'1');
 f.last().open();f.last().hello();
 assert.deepEqual(f.events,[{type:'resync'}]);assert.equal(f.client.status,'open');
 assert.equal(f.realtimeUrl('http://10.0.2.2:4000','t'),'ws://10.0.2.2:4000/api/v1/realtime?ticket=t');
});

test('forwards known events and ignores unknown or malformed ones',async()=>{
 const f=fixture();f.client.start();await settle();f.last().open();f.last().hello();
 f.last().receive({type:'message',conversationId:'c',messageId:'m',senderId:'s',createdAt:'t'});
 f.last().receive({type:'receipt',conversationId:'c',userId:'o',lastReadAt:'r',lastDeliveredAt:'d'});
 f.last().receive({type:'notification',id:'n',kind:'like'});
 f.last().receive({type:'resync'});f.last().receive({type:'from_the_future'});f.last().receive('not json');f.last().receive({type:'pong'});
 assert.deepEqual(f.events.map(e=>e.type),['resync','message','receipt','notification','resync']);
});

test('reconnects with growing, capped backoff that resets after a good connection',async()=>{
 const f=fixture();f.client.start();await settle();
 const delays=[];
 for(let i=0;i<7;i++){f.last().drop();await settle();delays.push(f.clock.delays()[0]);await f.clock.advance(delays[i]);}
 assert.deepEqual(delays,[1000,2000,4000,8000,16000,30000,30000]);
 assert.equal(f.statuses.includes('waiting'),true);
 f.last().open();f.last().hello();f.last().drop();await settle();
 assert.equal(f.clock.delays()[0],1000,'backoff starts over after a connection that worked');
 assert.ok(f.backoffMs(3,()=>0)>=4000&&f.backoffMs(3,()=>0)<8000,'jitter stays within half to full delay');
});

test('stops when the sign-in ends (4401) or a ticket is refused, without reconnecting',async()=>{
 const f=fixture();f.client.start();await settle();f.last().open();f.last().hello();
 f.last().drop(4401);await settle();
 assert.equal(f.signedOut,1);assert.equal(f.client.status,'stopped');assert.equal(f.clock.delays().length,0);
 const g=fixture({tickets:[authError()]});g.client.start();await settle();
 assert.equal(g.signedOut,1);assert.equal(g.sockets.length,0);assert.equal(g.clock.delays().length,0);
 const h=fixture({tickets:[new Error('offline')]});h.client.start();await settle();
 assert.equal(h.signedOut,0);assert.equal(h.clock.delays()[0],1000,'other ticket failures retry');
 await h.clock.advance(1000);assert.equal(h.sockets.length,1);
});

test('a replaced connection (4409) waits for the next start; an expired token (4001) reconnects with a new ticket',async()=>{
 const f=fixture();f.client.start();await settle();f.last().open();f.last().hello();
 f.last().drop(4409);await settle();
 assert.equal(f.client.status,'stopped');assert.equal(f.clock.delays().length,0);
 f.client.start();await settle();assert.equal(f.sockets.length,2);
 f.last().open();f.last().hello();f.last().drop(4001);await settle();
 await f.clock.advance(f.clock.delays()[0]);
 assert.equal(f.sockets.length,3);assert.equal(f.tickets,3,'every connection uses a fresh ticket');
});

test('detects a dead connection with app-level pings',async()=>{
 const f=fixture();f.client.start();await settle();const s=f.last();s.open();s.hello();
 await f.clock.advance(25000);
 assert.deepEqual(s.sent,['{"type":"ping"}']);
 s.receive({type:'pong'});await f.clock.advance(20000);
 assert.equal(s.closedWith,null,'a pong keeps the connection');
 await f.clock.advance(5000);assert.equal(s.sent.length,2);
 await f.clock.advance(10000);
 assert.deepEqual(s.closedWith,{code:4000,reason:'stale'},'no pong: closed as stale');
 await f.clock.advance(f.clock.delays()[0]);
 assert.equal(f.sockets.length,2,'and replaced');
});

test('gives up on a handshake that never completes',async()=>{
 const f=fixture();f.client.start();await settle();
 await f.clock.advance(15000);
 assert.deepEqual(f.sockets[0].closedWith,{code:4000,reason:'stale'});
 await f.clock.advance(f.clock.delays()[0]);assert.equal(f.sockets.length,2);
});

test('stop() closes cleanly, cancels retries and ignores a ticket that arrives late',async()=>{
 const f=fixture();f.client.start();await settle();const s=f.last();s.open();s.hello();
 f.client.stop();
 assert.deepEqual(s.closedWith,{code:1000,reason:'client_stop'});assert.equal(f.clock.delays().length,0);
 s.drop(1006);await settle();assert.equal(f.clock.delays().length,0,'a late close event is ignored');
 let release;const g=fixture();g.client.options.createTicket=()=>new Promise(r=>{release=r;});
 g.client.start();await settle();g.client.stop();release('b'.repeat(64));await settle();
 assert.equal(g.sockets.length,0,'no socket opened after stop');
});
